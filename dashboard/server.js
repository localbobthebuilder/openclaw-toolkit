import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 18791;
const toolkitDir = path.resolve(__dirname, '..');
const configPath = path.join(toolkitDir, 'openclaw-bootstrap.config.json');

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
  ]);

  let output = '';
  child.stdout.on('data', (data) => output += data.toString());
  child.stderr.on('data', (data) => output += data.toString());

  child.on('close', (code) => {
    res.json({ output, code });
  });
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

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    if (data.type === 'run-command') {
      // ... existing code ...
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
        child.stdout.on('data', (data) => ws.send(JSON.stringify({ type: 'stdout', data: data.toString() })));
        child.stderr.on('data', (data) => ws.send(JSON.stringify({ type: 'stderr', data: data.toString() })));
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

        child.stdout.on('data', (data) => ws.send(JSON.stringify({ type: 'stdout', data: data.toString() })));
        child.stderr.on('data', (data) => ws.send(JSON.stringify({ type: 'stderr', data: data.toString() })));
        child.on('close', (code) => ws.send(JSON.stringify({ type: 'exit', code })));
      }
    }
  });
});
