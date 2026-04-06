import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 18791;
const toolkitDir = path.resolve(__dirname, '..');
const configPath = path.join(toolkitDir, 'openclaw-bootstrap.config.json');
const defaultWhisperModels = [
  'tiny',
  'tiny.en',
  'base',
  'base.en',
  'small',
  'small.en',
  'medium',
  'medium.en',
  'large',
  'large-v1',
  'large-v2',
  'large-v3',
  'large-v3-turbo',
  'turbo'
];

// Simulate terminal \r handling and strip spinner noise from command output
function cleanOutputChunk(raw) {
  return raw
    .split('\n')
    .map(line => {
      // \r means "overwrite current line" — keep only the last non-empty segment
      const parts = line.split('\r');
      return parts.filter(p => p.trim().length > 0).pop() ?? parts[parts.length - 1] ?? '';
    })
    // Drop pure spinner frame lines: lines that are only - \ | / and whitespace
    .filter(line => !/^\s*[-\\|/]\s*$/.test(line))
    .join('\n')
    // Collapse runs of 3+ blank lines down to 2
    .replace(/\n{3,}/g, '\n\n');
}

function getWhisperModels() {
  const pythonSnippet = 'import json, whisper; print(json.dumps(sorted(list(whisper.available_models()))))';
  const result = spawnSync('docker', [
    'exec',
    'openclaw-openclaw-gateway-1',
    'sh',
    '-lc',
    `python3 -c '${pythonSnippet}'`
  ], {
    cwd: toolkitDir,
    encoding: 'utf8',
    timeout: 8000
  });

  if (result.status === 0) {
    try {
      const models = JSON.parse((result.stdout || '').trim());
      if (Array.isArray(models) && models.every((entry) => typeof entry === 'string' && entry.trim().length > 0)) {
        return {
          models,
          source: 'gateway',
          error: null
        };
      }
    } catch (err) {
      return {
        models: defaultWhisperModels,
        source: 'fallback',
        error: `Failed to parse whisper model list: ${err.message}`
      };
    }
  }

  const stderr = (result.stderr || '').trim();
  const stdout = (result.stdout || '').trim();
  const error = stderr || stdout || (result.error ? result.error.message : 'Whisper model query failed');
  return {
    models: defaultWhisperModels,
    source: 'fallback',
    error
  };
}

app.use(cors());
app.use(express.json());

// Middleware to strip /toolkit from all incoming requests before they hit handlers
app.use((req, res, next) => {
    if (req.url.startsWith('/toolkit')) {
        req.url = req.url.replace('/toolkit', '');
        if (req.url === '') req.url = '/';
    }
    next();
});

// Serve static frontend files from the ui/dist directory
const uiDistPath = path.join(toolkitDir, 'dashboard', 'ui', 'dist');
app.use(express.static(uiDistPath));

app.get('/api/config', (req, res) => {
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read config file', details: err.message });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    
    // Create backup before writing
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, configPath + '.bak');
    }
    
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
    console.log('Configuration updated and backup created.');
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to write config:', err);
    res.status(500).json({ error: 'Failed to write config file', details: err.message });
  }
});

app.get('/api/status', (req, res) => {
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(toolkitDir, 'status-openclaw.ps1')
  ], { cwd: toolkitDir });

  let output = '';
  child.stdout.on('data', (data) => output += data.toString());
  child.stderr.on('data', (data) => output += data.toString());

  child.on('close', (code) => {
    res.json({ output, code });
  });
});

app.get('/api/voice-models', (req, res) => {
  const result = getWhisperModels();
  res.json(result);
});

// Fallback for SPA routing: serve index.html for any other GET requests that weren't matched
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    res.sendFile(path.join(uiDistPath, 'index.html'));
  } else {
    next();
  }
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Toolkit Dashboard Backend running at http://0.0.0.0:${port}`);
});

const serverStartTime = Date.now();
const wss = new WebSocketServer({ server });

// Track the currently running child process so cancel-command can kill it.
let activeChild = null;

wss.on('connection', (ws) => {
  // Tell the client when this server instance started.
  // If the client sees a different start-time than before it will reload the page,
  // picking up any newly built JS (e.g. after "Rebuild Dashboard").
  ws.send(JSON.stringify({ type: 'server-info', startTime: serverStartTime }));

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    if (data.type === 'cancel-command') {
      if (activeChild && !activeChild.killed) {
        console.log('Cancelling active command...');
        // Kill the whole cmd.exe process tree so child processes are also terminated.
        spawn('taskkill', ['/pid', String(activeChild.pid), '/t', '/f']);
        activeChild = null;
        ws.send(JSON.stringify({ type: 'stdout', data: '\n[CANCELLED] Command was cancelled by user.\n' }));
        ws.send(JSON.stringify({ type: 'exit', code: -1 }));
      }
      return;
    }

    if (data.type === 'run-command') {
      const { command, args = [] } = data;
      console.log(`Running command: ${command} ${args.join(' ')}`);

      // Rebuild is handled in-process: build UI, tell client, then process.exit(0)
      // so the run-toolkit-dashboard.cmd restart loop brings the server back up cleanly.
      if (command === 'toolkit-dashboard-rebuild') {
        const uiDir = path.join(toolkitDir, 'dashboard', 'ui');
        ws.send(JSON.stringify({ type: 'stdout', data: '==> Building dashboard UI...\n' }));
        const build = spawn('cmd.exe', ['/c', 'npm run build'], { cwd: uiDir });
        activeChild = build;
        build.stdout.on('data', d => ws.send(JSON.stringify({ type: 'stdout', data: cleanOutputChunk(d.toString()) })));
        build.stderr.on('data', d => ws.send(JSON.stringify({ type: 'stderr', data: cleanOutputChunk(d.toString()) })));
        build.on('close', code => {
          activeChild = null;
          if (code !== 0) {
            ws.send(JSON.stringify({ type: 'stdout', data: `\nBuild failed (exit ${code}).\n` }));
            ws.send(JSON.stringify({ type: 'exit', code }));
            return;
          }
          ws.send(JSON.stringify({ type: 'stdout', data: '\nBuild complete. Server is restarting...\n' }));
          ws.send(JSON.stringify({ type: 'exit', code: 0 }));
          // process.exit(0) signals the run-toolkit-dashboard.cmd restart loop to relaunch
          setTimeout(() => process.exit(0), 400);
        });
        return;
      }

      const child = spawn('cmd.exe', [
        '/c',
        path.join(toolkitDir, 'run-openclaw.cmd'),
        command,
        ...args
      ]);
      activeChild = child;
      child.stdout.on('data', (d) => ws.send(JSON.stringify({ type: 'stdout', data: cleanOutputChunk(d.toString()) })));
      child.stderr.on('data', (d) => ws.send(JSON.stringify({ type: 'stderr', data: cleanOutputChunk(d.toString()) })));
      child.on('close', (code) => {
        activeChild = null;
        ws.send(JSON.stringify({ type: 'exit', code }));
      });
    } else if (data.type === 'reboot-service') {
      const { service } = data;
      console.log(`Rebooting service: ${service}`);
      
      let scriptFile = '';
      if (service === 'docker') {
        scriptFile = 'restart-docker.ps1';
      } else if (service === 'gateway') {
        // Gateway uses the main toolkit wrapper for stop/start
        const command = `& "${path.join(toolkitDir, 'run-openclaw.cmd')}" stop; & "${path.join(toolkitDir, 'run-openclaw.cmd')}" start`;
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]);
        child.stdout.on('data', (data) => ws.send(JSON.stringify({ type: 'stdout', data: cleanOutputChunk(data.toString()) })));
        child.stderr.on('data', (data) => ws.send(JSON.stringify({ type: 'stderr', data: cleanOutputChunk(data.toString()) })));
        child.on('close', (code) => ws.send(JSON.stringify({ type: 'exit', code })));
        return;
      } else if (service === 'tailscale') {
        scriptFile = 'restart-tailscale.ps1';
      } else if (service === 'ollama') {
        scriptFile = 'restart-ollama.ps1';
      }

      if (scriptFile) {
        const child = spawn('powershell.exe', [
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-File', path.join(toolkitDir, scriptFile)
        ]);

        child.stdout.on('data', (data) => ws.send(JSON.stringify({ type: 'stdout', data: cleanOutputChunk(data.toString()) })));
        child.stderr.on('data', (data) => ws.send(JSON.stringify({ type: 'stderr', data: cleanOutputChunk(data.toString()) })));
        child.on('close', (code) => ws.send(JSON.stringify({ type: 'exit', code })));
      }
    }
  });
});
