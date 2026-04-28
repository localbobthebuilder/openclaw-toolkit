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

function getToolkitDashboardPort(config) {
  const parsed = Number(config?.toolkitDashboard?.port);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 18792;
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

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

const port = getToolkitDashboardPort(readToolkitConfig());

function isValidAgentId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value.trim());
}

function isValidSessionKey(value) {
  return typeof value === 'string' && /^agent:[a-z0-9][a-z0-9_-]{0,63}:[a-z0-9:_-]+$/i.test(value.trim());
}

function callOpenClawGateway(method, params = {}) {
  const result = spawnSync('docker', [
    'exec',
    'openclaw-openclaw-gateway-1',
    'openclaw',
    'gateway',
    'call',
    method,
    '--params',
    JSON.stringify(params)
  ], {
    cwd: toolkitDir,
    encoding: 'utf8',
    timeout: 30000
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  if (result.status !== 0) {
    const detail = stderr || stdout || result.error?.message || `OpenClaw gateway call failed with exit code ${result.status}`;
    throw new Error(detail);
  }
  if (!stdout) {
    return {};
  }
  const jsonStart = stdout.indexOf('{');
  const jsonText = jsonStart >= 0 ? stdout.slice(jsonStart).trim() : stdout;
  try {
    return JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Failed to parse OpenClaw gateway response: ${err.message}. Output: ${stdout}`);
  }
}

function expandWindowsEnvVars(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }
  return value.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);
}

function resolveToolkitConfigPath(value, baseDir = toolkitDir) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  const expanded = expandWindowsEnvVars(value.trim());
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(baseDir, expanded);
}

function toPortableRelativeConfigPath(value, baseDir) {
  if (typeof value !== 'string' || !value.trim()) {
    return value;
  }
  const trimmed = value.trim();
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }

  const expanded = expandWindowsEnvVars(trimmed);
  if (!path.isAbsolute(expanded)) {
    return trimmed.replace(/\\/g, '/');
  }

  const relative = path.relative(baseDir, path.resolve(expanded));
  if (!relative || path.isAbsolute(relative)) {
    return path.resolve(expanded);
  }
  return relative.replace(/\\/g, '/');
}

function toPortableUserProfileConfigPath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return value;
  }
  const trimmed = value.trim();
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }

  const expanded = expandWindowsEnvVars(trimmed);
  if (!path.isAbsolute(expanded)) {
    return trimmed.replace(/\\/g, '/');
  }

  const homeDir = path.resolve(process.env.USERPROFILE || os.homedir());
  const targetPath = path.resolve(expanded);
  if (!targetPath.toLowerCase().startsWith(homeDir.toLowerCase())) {
    return trimmed;
  }

  const suffix = targetPath.slice(homeDir.length).replace(/^([\\/]+)/, '');
  if (!suffix) {
    return '%USERPROFILE%';
  }
  return `%USERPROFILE%/${suffix.replace(/\\/g, '/')}`;
}

function compactToolkitConfigPaths(config) {
  if (!config || typeof config !== 'object') {
    return config;
  }

  for (const propertyName of ['repoPath', 'composeFilePath', 'envFilePath', 'envTemplatePath']) {
    if (typeof config[propertyName] === 'string' && config[propertyName].trim()) {
      config[propertyName] = toPortableRelativeConfigPath(config[propertyName], toolkitDir);
    }
  }

  for (const propertyName of ['hostConfigDir', 'hostWorkspaceDir']) {
    if (typeof config[propertyName] === 'string' && config[propertyName].trim()) {
      config[propertyName] = toPortableUserProfileConfigPath(config[propertyName]);
    }
  }

  if (config.verification && typeof config.verification === 'object' && typeof config.verification.reportPath === 'string' && config.verification.reportPath.trim()) {
    config.verification.reportPath = toPortableRelativeConfigPath(config.verification.reportPath, toolkitDir);
  }

  return config;
}

function readJsonFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getToolkitHostConfigDir(config) {
  const configuredPath = typeof config?.hostConfigDir === 'string' ? config.hostConfigDir.trim() : '';
  return configuredPath ? resolveToolkitConfigPath(configuredPath, toolkitDir) : path.join(os.homedir(), '.openclaw');
}

function readEnvFileValue(filePath, name) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }
  const prefix = `${name}=`;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }
  return '';
}

function getGatewayToken() {
  const toolkitConfig = readToolkitConfig();
  const liveConfigPath = path.join(getToolkitHostConfigDir(toolkitConfig), 'openclaw.json');
  const liveConfig = readJsonFileIfExists(liveConfigPath);
  const liveToken = typeof liveConfig?.gateway?.auth?.token === 'string' ? liveConfig.gateway.auth.token.trim() : '';
  if (liveToken) {
    return liveToken;
  }

  const envFilePath = resolveToolkitConfigPath(toolkitConfig?.envFilePath || '', toolkitDir);
  const envToken = readEnvFileValue(envFilePath, 'OPENCLAW_GATEWAY_TOKEN');
  if (envToken) {
    return envToken;
  }

  throw new Error('Gateway auth token not found in openclaw.json or OPENCLAW_GATEWAY_TOKEN.');
}

function getLiveOpenClawConfig() {
  const toolkitConfig = readToolkitConfig();
  const liveConfigPath = path.join(getToolkitHostConfigDir(toolkitConfig), 'openclaw.json');
  return readJsonFileIfExists(liveConfigPath) || toolkitConfig;
}

function normalizeUniqueStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function getLiveAgentConfig(agentId) {
  const liveConfig = getLiveOpenClawConfig();
  const agents = Array.isArray(liveConfig?.agents?.list) ? liveConfig.agents.list : [];
  return agents.find((entry) => String(entry?.id || '').trim() === agentId) || null;
}

function getAgentSessionStorePath(agentId) {
  const toolkitConfig = readToolkitConfig();
  const hostConfigDir = getToolkitHostConfigDir(toolkitConfig);
  return path.join(hostConfigDir, 'agents', agentId, 'sessions', 'sessions.json');
}

function summarizeAgentSessionEntry(sessionKey, entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const updatedAt = Number(entry.updatedAt);
  const startedAt = Number(entry.startedAt);
  const suffix = String(sessionKey).split(':').slice(2).join(':') || sessionKey;
  const originLabel = typeof entry?.origin?.label === 'string' ? entry.origin.label.trim() : '';
  const lastTo = typeof entry?.lastTo === 'string' ? entry.lastTo.trim() : '';
  const label = originLabel || lastTo || suffix;

  return {
    key: sessionKey,
    label,
    suffix,
    status: typeof entry.status === 'string' ? entry.status : '',
    modelProvider: typeof entry.modelProvider === 'string' ? entry.modelProvider : '',
    model: typeof entry.model === 'string' ? entry.model : '',
    thinkingLevel: typeof entry.thinkingLevel === 'string' ? entry.thinkingLevel : '',
    chatType: typeof entry.chatType === 'string' ? entry.chatType : '',
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    startedAt: Number.isFinite(startedAt) ? startedAt : 0
  };
}

function listAgentSessions(agentId) {
  const storePath = getAgentSessionStorePath(agentId);
  const raw = readJsonFileIfExists(storePath);
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  return Object.entries(raw)
    .map(([sessionKey, entry]) => {
      if (!isValidSessionKey(sessionKey) || !sessionKey.startsWith(`agent:${agentId}:`)) {
        return null;
      }
      return summarizeAgentSessionEntry(sessionKey, entry);
    })
    .filter(Boolean)
    .sort((left, right) => {
      const delta = (right.updatedAt || 0) - (left.updatedAt || 0);
      if (delta !== 0) {
        return delta;
      }
      return left.key.localeCompare(right.key);
    });
}

function runToolkitScript(scriptPath, wrapperName, args = [], options = {}) {
  const wrapper = path.join(toolkitDir, 'cmd', 'invoke-toolkit-script.cmd');
  const result = spawnSync('cmd.exe', [
    '/c',
    wrapper,
    scriptPath,
    wrapperName,
    ...args
  ], {
    cwd: toolkitDir,
    encoding: 'utf8',
    timeout: options.timeoutMs || 120000
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  if (result.status !== 0 && !options.allowNonZero) {
    const detail = stderr || stdout || result.error?.message || `Toolkit script failed with exit code ${result.status}`;
    throw new Error(detail);
  }

  return {
    status: result.status ?? 0,
    stdout,
    stderr
  };
}

function summarizeEffectiveToolInventory(inventory) {
  const groups = Array.isArray(inventory?.groups) ? inventory.groups : [];
  const summaryGroups = groups.map((group) => {
    const tools = Array.isArray(group?.tools) ? group.tools : [];
    return {
      id: typeof group?.id === 'string' ? group.id : '',
      label: typeof group?.label === 'string' ? group.label : '',
      source: typeof group?.source === 'string' ? group.source : '',
      tools: tools
        .map((tool) => {
          const id = typeof tool?.id === 'string' ? tool.id.trim() : '';
          if (!id) {
            return null;
          }
          return {
            id,
            label: typeof tool?.label === 'string' ? tool.label : id,
            source: typeof tool?.source === 'string' ? tool.source : '',
            pluginId: typeof tool?.pluginId === 'string' ? tool.pluginId : '',
            description: typeof tool?.description === 'string' ? tool.description : ''
          };
        })
        .filter(Boolean)
    };
  });

  const toolIds = normalizeUniqueStringList(
    summaryGroups.flatMap((group) => group.tools.map((tool) => tool.id))
  );

  return {
    agentId: typeof inventory?.agentId === 'string' ? inventory.agentId : '',
    profile: typeof inventory?.profile === 'string' ? inventory.profile : '',
    toolIds,
    groups: summaryGroups
  };
}

function buildToolRuntimeDiagnostics(liveConfigured, runtimeSummary) {
  const configuredAllow = normalizeUniqueStringList(liveConfigured?.allow);
  const configuredDeny = normalizeUniqueStringList(liveConfigured?.deny);
  const runtimeToolIds = normalizeUniqueStringList(runtimeSummary?.toolIds);
  const runtimeOnlyTools = runtimeToolIds.filter((toolId) => !configuredAllow.includes(toolId));
  const configuredMissingFromRuntime = configuredAllow.filter((toolId) => !runtimeToolIds.includes(toolId));

  return {
    configuredAllow,
    configuredDeny,
    runtimeToolIds,
    configuredMissingFromRuntime,
    runtimeOnlyTools
  };
}

function getAgentThinkingDefault(agentId) {
  const liveConfig = getLiveOpenClawConfig();
  const agents = Array.isArray(liveConfig?.agents?.list) ? liveConfig.agents.list : [];
  const agent = agents.find((entry) => String(entry?.id || '').trim() === agentId);
  const agentThinking = typeof agent?.thinkingDefault === 'string' ? agent.thinkingDefault.trim() : '';
  if (agentThinking) {
    return agentThinking;
  }
  const defaultThinking = typeof liveConfig?.agents?.defaults?.thinkingDefault === 'string'
    ? liveConfig.agents.defaults.thinkingDefault.trim()
    : '';
  return defaultThinking;
}

function hasDirectTelegramCredentials(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return ['botToken', 'tokenFile'].some((key) => typeof value[key] === 'string' && value[key].trim().length > 0);
}

function getDefaultTelegramAccountId(config) {
  const value = typeof config?.telegram?.defaultAccount === 'string' ? config.telegram.defaultAccount.trim() : '';
  return value || 'default';
}

function getTelegramSetupStatus() {
  const toolkitConfig = readToolkitConfig();
  const defaultAccountId = getDefaultTelegramAccountId(toolkitConfig);
  const liveConfigPath = path.join(getToolkitHostConfigDir(toolkitConfig), 'openclaw.json');
  const liveConfig = readJsonFileIfExists(liveConfigPath);
  const liveTelegram = liveConfig?.channels?.telegram && typeof liveConfig.channels.telegram === 'object'
    ? liveConfig.channels.telegram
    : null;
  const liveAccounts = liveTelegram?.accounts && typeof liveTelegram.accounts === 'object'
    ? liveTelegram.accounts
    : {};
  const envHasDefaultToken = typeof process.env.TELEGRAM_BOT_TOKEN === 'string' && process.env.TELEGRAM_BOT_TOKEN.trim().length > 0;
  const toolkitAccounts = Array.isArray(toolkitConfig?.telegram?.accounts) ? toolkitConfig.telegram.accounts : [];

  function buildAccountStatus(accountId, liveAccountConfig, options = {}) {
    const isDefault = options.isDefault === true;
    const hasTopLevelCredentials = isDefault && hasDirectTelegramCredentials(liveTelegram);
    const hasAccountCredentials = hasDirectTelegramCredentials(liveAccountConfig);
    const hasEnvCredentials = isDefault && envHasDefaultToken;

    let credentialSource = null;
    if (hasTopLevelCredentials) {
      credentialSource = 'live-top-level';
    } else if (hasAccountCredentials) {
      credentialSource = 'live-account';
    } else if (hasEnvCredentials) {
      credentialSource = 'env';
    }

    return {
      accountId,
      configured: hasTopLevelCredentials || hasAccountCredentials || hasEnvCredentials,
      credentialSource,
      liveEnabled: isDefault
        ? !!liveTelegram?.enabled
        : !!liveAccountConfig?.enabled,
      accountExists: isDefault
        ? !!liveTelegram
        : !!liveAccountConfig
    };
  }

  const accounts = {};
  for (const account of toolkitAccounts) {
    const accountId = typeof account?.id === 'string' ? account.id.trim() : '';
    if (!accountId) {
      continue;
    }
    const liveAccountConfig = liveAccounts[accountId] && typeof liveAccounts[accountId] === 'object'
      ? liveAccounts[accountId]
      : null;
    accounts[accountId] = buildAccountStatus(accountId, liveAccountConfig);
  }

  const defaultLiveAccountConfig = liveAccounts[defaultAccountId] && typeof liveAccounts[defaultAccountId] === 'object'
    ? liveAccounts[defaultAccountId]
    : null;

  return {
    liveConfigPath,
    channelEnabled: !!liveTelegram?.enabled,
    defaultAccountId,
    defaultAccount: buildAccountStatus(defaultAccountId, defaultLiveAccountConfig, { isDefault: true }),
    accounts
  };
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
    const portableConfig = compactToolkitConfigPaths(JSON.parse(JSON.stringify(newConfig)));
    const templates = payload.templates && typeof payload.templates === 'object' ? payload.templates : null;
    
    // Create backup before writing
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, configPath + '.bak');
    }
    
    fs.writeFileSync(configPath, JSON.stringify(portableConfig, null, 2), 'utf8');
    if (templates) {
      saveToolkitTemplates(portableConfig, templates);
    }
    console.log('Configuration updated and backup created.');
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to write config:', err);
    res.status(500).json({ error: 'Failed to write config file', details: err.message });
  }
});

app.get('/api/status', (req, res) => {
  const statusScript = path.join(toolkitDir, 'scripts', 'status-openclaw.ps1');

  if (!fs.existsSync(statusScript)) {
    res.status(500).json({ output: `Status script not found at ${statusScript}`, code: -1, error: true });
    return;
  }

  // Choose an available PowerShell executable (Windows PowerShell or PowerShell Core)
  let shellExe = 'powershell.exe';
  try {
    const probe = spawnSync('where', [shellExe], { cwd: toolkitDir, encoding: 'utf8', timeout: 2000 });
    if (probe.status !== 0) {
      const probe2 = spawnSync('where', ['pwsh'], { cwd: toolkitDir, encoding: 'utf8', timeout: 2000 });
      if (probe2.status === 0) {
        shellExe = 'pwsh';
      } else {
        res.status(500).json({ output: 'PowerShell not found (powershell.exe or pwsh)', code: -1, error: true });
        return;
      }
    }
  } catch (err) {
    // Fall back to default shellExe
  }

  const child = spawn(shellExe, [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', statusScript
  ], { cwd: toolkitDir });

  let output = '';
  let responded = false;
  const timeoutMs = 25000;
  const timeout = setTimeout(() => {
    if (responded) {
      return;
    }
    output += output ? '\n' : '';
    output += `Status probe timed out after ${timeoutMs / 1000}s while running ${path.basename(statusScript)}.`;
    try {
      child.kill();
    } catch (err) {
      console.warn('Failed to terminate timed-out status probe:', err?.message ?? err);
    }
    responded = true;
    res.json({ output, code: -1, timedOut: true });
  }, timeoutMs);

  child.stdout.on('data', (data) => output += data.toString());
  child.stderr.on('data', (data) => output += data.toString());

  child.on('error', (err) => {
    if (responded) return;
    clearTimeout(timeout);
    responded = true;
    res.status(500).json({ output: String(err?.message || err), code: -1, error: true });
  });

  child.on('close', (code) => {
    if (responded) {
      return;
    }
    clearTimeout(timeout);
    responded = true;
    res.json({ output, code });
  });
});

app.get('/api/telegram-setup-status', (req, res) => {
  try {
    res.json(getTelegramSetupStatus());
  } catch (err) {
    res.status(500).json({ error: 'Failed to read Telegram setup status', details: err.message });
  }
});

app.get('/api/voice-models', (req, res) => {
  const result = getWhisperModels();
  res.json(result);
});

app.get('/api/gateway-auth', (req, res) => {
  try {
    res.json({ token: getGatewayToken() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read OpenClaw gateway auth token', details: err.message });
  }
});

app.get('/api/agents/:agentId/tools-runtime', (req, res) => {
  try {
    const agentId = String(req.params?.agentId || '').trim();
    if (!isValidAgentId(agentId)) {
      res.status(400).json({ error: 'Invalid agent id' });
      return;
    }

    const requestedSessionKey = typeof req.query?.sessionKey === 'string'
      ? req.query.sessionKey.trim()
      : '';
    if (requestedSessionKey && !isValidSessionKey(requestedSessionKey)) {
      res.status(400).json({ error: 'Invalid session key' });
      return;
    }

    const sessions = listAgentSessions(agentId);
    const selectedSession = requestedSessionKey
      ? sessions.find((session) => session.key === requestedSessionKey) || null
      : (sessions[0] || null);
    if (requestedSessionKey && !selectedSession) {
      res.status(404).json({ error: 'Session key not found for agent' });
      return;
    }

    const liveAgentConfig = getLiveAgentConfig(agentId);
    const liveConfigured = {
      allow: normalizeUniqueStringList(liveAgentConfig?.tools?.allow),
      deny: normalizeUniqueStringList(liveAgentConfig?.tools?.deny),
      modelPrimary: typeof liveAgentConfig?.model?.primary === 'string' ? liveAgentConfig.model.primary : '',
      thinkingDefault: typeof liveAgentConfig?.thinkingDefault === 'string' ? liveAgentConfig.thinkingDefault : ''
    };

    let runtime = null;
    let runtimeError = '';
    if (selectedSession) {
      try {
        const runtimeResult = callOpenClawGateway('tools.effective', {
          sessionKey: selectedSession.key,
          agentId
        });
        runtime = summarizeEffectiveToolInventory(runtimeResult);
      } catch (err) {
        runtimeError = String(err?.message || err);
      }
    }

    res.json({
      agentId,
      selectedSessionKey: selectedSession?.key || '',
      sessions,
      liveConfigured,
      runtime,
      runtimeError,
      diagnostics: buildToolRuntimeDiagnostics(liveConfigured, runtime)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to inspect agent runtime tools', details: err.message });
  }
});

app.post('/api/agent-sessions', (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const agentId = String(payload.agentId || '').trim();
    if (!isValidAgentId(agentId)) {
      res.status(400).json({ error: 'Invalid agentId' });
      return;
    }

    const label = typeof payload.label === 'string' && payload.label.trim()
      ? payload.label.trim().slice(0, 120)
      : `Dashboard ${agentId}`;
    const created = callOpenClawGateway('sessions.create', { agentId, label });
    const thinkingLevel = getAgentThinkingDefault(agentId);
    if (created?.key && thinkingLevel) {
      try {
        callOpenClawGateway('sessions.patch', { key: created.key, thinkingLevel });
        res.json({
          ...created,
          thinkingLevel,
          entry: created.entry && typeof created.entry === 'object'
            ? { ...created.entry, thinkingLevel }
            : created.entry
        });
        return;
      } catch (err) {
        console.warn(`Failed to set thinking level for session ${created.key}: ${err.message}`);
      }
    }
    res.json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create OpenClaw agent session', details: err.message });
  }
});

app.delete('/api/agent-sessions', (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const key = String(payload.key || '').trim();
    if (!isValidSessionKey(key)) {
      res.status(400).json({ error: 'Invalid session key' });
      return;
    }

    try {
      callOpenClawGateway('sessions.abort', { key });
    } catch (err) {
      console.warn(`Failed to abort session ${key}: ${err.message}`);
    }
    const deleted = callOpenClawGateway('sessions.delete', { key, deleteTranscript: true });
    res.json(deleted);
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete OpenClaw agent session', details: err.message });
  }
});

app.post('/api/agent-sessions/close', (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const key = String(payload.key || '').trim();
    if (!isValidSessionKey(key)) {
      res.status(400).json({ error: 'Invalid session key' });
      return;
    }

    try {
      callOpenClawGateway('sessions.abort', { key });
    } catch (err) {
      console.warn(`Failed to abort session ${key}: ${err.message}`);
    }
    try {
      callOpenClawGateway('sessions.delete', { key, deleteTranscript: true });
      res.json({ ok: true });
    } catch (err) {
      console.warn(`Failed to delete session ${key}: ${err.message}`);
      res.status(500).json({ error: 'Failed to delete OpenClaw agent session', details: err.message });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to close OpenClaw agent session', details: err.message });
  }
});

app.post('/api/agent-sessions/clear', (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const rawAgentId = typeof payload.agentId === 'string' ? payload.agentId.trim() : '';
    const clearAll = payload.all === true || rawAgentId === 'all';

    if (!clearAll && !isValidAgentId(rawAgentId)) {
      res.status(400).json({ error: 'Invalid agentId' });
      return;
    }

    const scriptPath = path.join(toolkitDir, 'scripts', 'clear-agent-sessions.ps1');
    const scriptArgs = clearAll
      ? ['-All', '-Json']
      : ['-AgentId', rawAgentId, '-Json'];
    const result = runToolkitScript(scriptPath, 'clear-agent-sessions', scriptArgs, { allowNonZero: true, timeoutMs: 180000 });
    const output = result.stdout || result.stderr || '';
    const jsonStart = output.indexOf('{');
    const jsonText = jsonStart >= 0 ? output.slice(jsonStart).trim() : output.trim();
    if (!jsonText) {
      throw new Error('Session cleanup script did not return JSON output.');
    }

    const parsed = JSON.parse(jsonText);
    const hadGatewayErrors = Array.isArray(parsed?.results)
      ? parsed.results.some((entry) => Array.isArray(entry?.gatewayErrors) && entry.gatewayErrors.length > 0)
      : false;

    res.status(hadGatewayErrors || result.status !== 0 ? 207 : 200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear OpenClaw agent sessions', details: err.message });
  }
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

      // Explicit command -> script mapping for safer execution
      const commandMap = {
        'expose-toolkit-dashboard': { type: 'ps1', script: path.join(toolkitDir, 'scripts', 'expose-toolkit-dashboard.ps1') },
        'apply-toolkit-config': { type: 'ps1', script: path.join(toolkitDir, 'scripts', 'apply-toolkit-config.ps1'), restartDashboardOnSuccess: true },
        'toolkit-dashboard-rebuild': { type: 'rebuild' },
        'bootstrap': { type: 'ps1', script: path.join(toolkitDir, 'scripts', 'bootstrap-openclaw.ps1') },
        'start': { type: 'ps1', script: path.join(toolkitDir, 'scripts', 'start-openclaw.ps1') },
        'stop': { type: 'ps1', script: path.join(toolkitDir, 'scripts', 'stop-openclaw.ps1') },
        'verify': { type: 'ps1', script: path.join(toolkitDir, 'scripts', 'verify-openclaw.ps1') },
        'prereqs': { type: 'ps1', script: path.join(toolkitDir, 'scripts', 'ensure-windows-prereqs.ps1') },
        'telegram-setup': { type: 'ps1', script: path.join(toolkitDir, 'scripts', 'telegram-setup.ps1') },
        'agents': { type: 'ps1', script: path.join(toolkitDir, 'scripts', 'configure-agent-layout.ps1') },
        'remove-local-model': { type: 'ps1', script: path.join(toolkitDir, 'scripts', 'remove-local-model.ps1') },
        'add-local-model': { type: 'ps1', script: path.join(toolkitDir, 'scripts', 'add-local-model.ps1') }
      };

      const mapped = commandMap[command];

      if (mapped && mapped.type === 'rebuild') {
        // Keep existing rebuild behavior
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
          // process.exit(0) signals the cmd\\run-toolkit-dashboard.cmd restart loop to relaunch
          setTimeout(() => process.exit(0), 400);
        });
        return;
      }

      if (mapped && mapped.type === 'ps1') {
        // Use the cmd\invoke-toolkit-script.cmd wrapper so it will prefer pwsh and show help when needed
        const wrapper = path.join(toolkitDir, 'cmd', 'invoke-toolkit-script.cmd');
        const spawnArgs = ['/c', wrapper, mapped.script, command, ...args];
        ws.send(JSON.stringify({ type: 'stdout', data: `==> Running: ${mapped.script}\n` }));
        try {
          const child = spawn('cmd.exe', spawnArgs, { cwd: toolkitDir });
          activeChild = child;
          child.stdout.on('data', d => ws.send(JSON.stringify({ type: 'stdout', data: cleanOutputChunk(d.toString()) })));
          child.stderr.on('data', d => ws.send(JSON.stringify({ type: 'stderr', data: cleanOutputChunk(d.toString()) })));
          child.on('close', (code) => {
            activeChild = null;
            if (code === 0 && mapped.restartDashboardOnSuccess) {
              const nextPort = getToolkitDashboardPort(readToolkitConfig());
              if (nextPort !== port) {
                ws.send(JSON.stringify({ type: 'stdout', data: `\n[INFO] Toolkit dashboard port changed to ${nextPort}. Restarting the toolkit dashboard server...\n` }));
                ws.send(JSON.stringify({ type: 'exit', code }));
                setTimeout(() => process.exit(0), 400);
                return;
              }
            }
            ws.send(JSON.stringify({ type: 'exit', code }));
          });
        } catch (err) {
          ws.send(JSON.stringify({ type: 'stderr', data: `Failed to start script: ${err?.message || err}\n` }));
          ws.send(JSON.stringify({ type: 'exit', code: -1 }));
        }
        return;
      }

      // Fallback: legacy run-openclaw.cmd wrapper (keeps backwards compatibility)
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

