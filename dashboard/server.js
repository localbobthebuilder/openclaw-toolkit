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
const validAgentBootstrapMarkdownFiles = [
  'AGENTS.md',
  'TOOLS.md',
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'MEMORY.md'
];
const validWorkspaceMarkdownFiles = [
  ...validAgentBootstrapMarkdownFiles,
  'BOOTSTRAP.md',
  'BOOT.md'
];
const templateLibraryScopes = ['agents', 'workspaces'];
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
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
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

function readToolkitConfig() {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function isSafeIdSegment(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('..') && !path.isAbsolute(value) && !/[\\/]/.test(value);
}

function normalizeTemplateFileName(fileName, validFileNames) {
  if (typeof fileName !== 'string') {
    return '';
  }
  const trimmed = fileName.trim();
  if (!validFileNames.includes(trimmed)) {
    return '';
  }
  return trimmed;
}

function getMarkdownTemplateTypeName(fileName) {
  return normalizeTemplateFileName(fileName, [...validWorkspaceMarkdownFiles]).replace(/\.md$/i, '');
}

function getMarkdownTemplateLibraryDir(scope, fileName) {
  return path.join(toolkitDir, 'markdown-templates', scope, getMarkdownTemplateTypeName(fileName));
}

function loadTemplateFileMap(baseDir, validFileNames) {
  const files = {};
  if (!fs.existsSync(baseDir)) {
    return files;
  }

  for (const fileName of validFileNames) {
    const filePath = path.join(baseDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    files[fileName] = fs.readFileSync(filePath, 'utf8');
  }

  return files;
}

function loadMarkdownTemplateLibrary(scope, validFileNames) {
  const library = {};
  for (const fileName of validFileNames) {
    library[fileName] = {};
    const baseDir = getMarkdownTemplateLibraryDir(scope, fileName);
    if (!fs.existsSync(baseDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') {
        continue;
      }
      const key = path.basename(entry.name, '.md');
      if (!isSafeIdSegment(key)) {
        continue;
      }
      library[fileName][key] = fs.readFileSync(path.join(baseDir, entry.name), 'utf8');
    }
  }
  return library;
}

function writeMarkdownTemplateLibrary(scope, validFileNames, library) {
  const scopeLibrary = library && typeof library === 'object' ? library : {};

  for (const fileName of validFileNames) {
    const normalizedFileName = normalizeTemplateFileName(fileName, validFileNames);
    if (!normalizedFileName) {
      continue;
    }

    const baseDir = getMarkdownTemplateLibraryDir(scope, normalizedFileName);
    fs.mkdirSync(baseDir, { recursive: true });
    const entries = scopeLibrary[normalizedFileName] && typeof scopeLibrary[normalizedFileName] === 'object'
      ? scopeLibrary[normalizedFileName]
      : {};
    const desiredKeys = new Set();

    for (const [key, rawContent] of Object.entries(entries)) {
      if (!isSafeIdSegment(key)) {
        continue;
      }
      const content = typeof rawContent === 'string' ? rawContent.replace(/\r\n/g, '\n').trimEnd() : '';
      const filePath = path.join(baseDir, `${key}.md`);
      desiredKeys.add(key);
      if (content.length > 0) {
        fs.writeFileSync(filePath, content + '\n', 'utf8');
      } else if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') {
        continue;
      }
      const key = path.basename(entry.name, '.md');
      if (!desiredKeys.has(key) && isSafeIdSegment(key)) {
        fs.unlinkSync(path.join(baseDir, entry.name));
      }
    }
  }
}

function applyLegacyRolePolicyTemplates(config, libraries) {
  const rolePolicies = config?.agents?.rolePolicies && typeof config.agents.rolePolicies === 'object'
    ? config.agents.rolePolicies
    : {};
  const agentLibrary = libraries.agents?.['AGENTS.md'] && typeof libraries.agents['AGENTS.md'] === 'object'
    ? libraries.agents['AGENTS.md']
    : (libraries.agents['AGENTS.md'] = {});
  const workspaceLibrary = libraries.workspaces?.['AGENTS.md'] && typeof libraries.workspaces['AGENTS.md'] === 'object'
    ? libraries.workspaces['AGENTS.md']
    : (libraries.workspaces['AGENTS.md'] = {});

  for (const [key, value] of Object.entries(rolePolicies)) {
    if (!isSafeIdSegment(key)) {
      continue;
    }
    const content = Array.isArray(value)
      ? value.map((line) => String(line ?? '')).join('\n').trimEnd()
      : typeof value === 'string'
        ? value.trimEnd()
        : '';
    if (!content) {
      continue;
    }
    if (key !== 'sharedWorkspace' && !agentLibrary[key]) {
      agentLibrary[key] = content;
    }
    if (key === 'sharedWorkspace' && !workspaceLibrary[key]) {
      workspaceLibrary[key] = content;
    }
  }
}

function pruneMisplacedTemplateLibraryEntries(libraries) {
  const agentAgentsLibrary = libraries?.agents?.['AGENTS.md'];
  if (agentAgentsLibrary && typeof agentAgentsLibrary === 'object' && Object.prototype.hasOwnProperty.call(agentAgentsLibrary, 'sharedWorkspace')) {
    delete agentAgentsLibrary.sharedWorkspace;
  }
}

function writeTemplateFileMap(baseDir, fileMap, validFileNames) {
  fs.mkdirSync(baseDir, { recursive: true });
  const entries = fileMap && typeof fileMap === 'object' ? fileMap : {};

  for (const fileName of validFileNames) {
    const normalizedName = normalizeTemplateFileName(fileName, validFileNames);
    const rawContent = normalizedName ? entries[normalizedName] : '';
    const content = typeof rawContent === 'string' ? rawContent.replace(/\r\n/g, '\n').trimEnd() : '';
    const filePath = path.join(baseDir, fileName);

    if (content.length > 0) {
      fs.writeFileSync(filePath, content + '\n', 'utf8');
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

function loadToolkitTemplates(config) {
  const templates = {
    agents: {},
    workspaces: {},
    libraries: {
      agents: loadMarkdownTemplateLibrary('agents', validAgentBootstrapMarkdownFiles),
      workspaces: loadMarkdownTemplateLibrary('workspaces', validWorkspaceMarkdownFiles)
    }
  };
  pruneMisplacedTemplateLibraryEntries(templates.libraries);
  const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const workspaces = Array.isArray(config?.workspaces) ? config.workspaces : [];

  for (const agent of agents) {
    if (!isSafeIdSegment(agent?.id)) {
      continue;
    }
    templates.agents[agent.id] = loadTemplateFileMap(path.join(toolkitDir, 'agents', agent.id, 'bootstrap'), validAgentBootstrapMarkdownFiles);
  }

  for (const workspace of workspaces) {
    if (!isSafeIdSegment(workspace?.id)) {
      continue;
    }
    templates.workspaces[workspace.id] = loadTemplateFileMap(path.join(toolkitDir, 'workspaces', workspace.id, 'markdown'), validWorkspaceMarkdownFiles);
  }

  applyLegacyRolePolicyTemplates(config, templates.libraries);
  pruneMisplacedTemplateLibraryEntries(templates.libraries);
  return templates;
}

function saveToolkitTemplates(config, templates) {
  const agentTemplates = templates?.agents && typeof templates.agents === 'object' ? templates.agents : {};
  const workspaceTemplates = templates?.workspaces && typeof templates.workspaces === 'object' ? templates.workspaces : {};
  const libraries = templates?.libraries && typeof templates.libraries === 'object' ? templates.libraries : {};
  const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const workspaces = Array.isArray(config?.workspaces) ? config.workspaces : [];

  pruneMisplacedTemplateLibraryEntries(libraries);

  for (const agent of agents) {
    if (!isSafeIdSegment(agent?.id)) {
      continue;
    }
    writeTemplateFileMap(path.join(toolkitDir, 'agents', agent.id, 'bootstrap'), agentTemplates[agent.id], validAgentBootstrapMarkdownFiles);
  }

  for (const workspace of workspaces) {
    if (!isSafeIdSegment(workspace?.id)) {
      continue;
    }
    writeTemplateFileMap(path.join(toolkitDir, 'workspaces', workspace.id, 'markdown'), workspaceTemplates[workspace.id], validWorkspaceMarkdownFiles);
  }

  writeMarkdownTemplateLibrary('agents', validAgentBootstrapMarkdownFiles, libraries.agents);
  writeMarkdownTemplateLibrary('workspaces', validWorkspaceMarkdownFiles, libraries.workspaces);
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
    const config = readToolkitConfig();
    res.json({
      config,
      templates: loadToolkitTemplates(config)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read config file', details: err.message });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const newConfig = payload.config && typeof payload.config === 'object' ? payload.config : payload;
    const templates = payload.templates && typeof payload.templates === 'object' ? payload.templates : null;
    
    // Create backup before writing
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, configPath + '.bak');
    }
    
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
    if (templates) {
      saveToolkitTemplates(newConfig, templates);
    }
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
