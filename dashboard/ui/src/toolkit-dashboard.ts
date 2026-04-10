import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

const VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES = [
  'AGENTS.md',
  'TOOLS.md',
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'MEMORY.md'
] as const;

const VALID_WORKSPACE_MARKDOWN_FILES = [
  ...VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES,
  'BOOTSTRAP.md',
  'BOOT.md'
] as const;

type AvailableToolOption = {
  id: string;
  description: string;
  note?: string;
};

type BuiltinToolsetDefinition = {
  key: string;
  name: string;
  allow: string[];
  deny: string[];
};

const AVAILABLE_TOOL_OPTIONS: AvailableToolOption[] = [
  { id: 'read', description: 'Read files and directories' },
  { id: 'write', description: 'Write files' },
  { id: 'edit', description: 'Edit files inline' },
  { id: 'apply_patch', description: 'Patch files in place', note: 'OpenAI exclusive' },
  { id: 'exec', description: 'Run shell commands' },
  { id: 'process', description: 'Inspect running processes' },
  { id: 'code_execution', description: 'Run code snippets' },
  { id: 'web_search', description: 'Search the web' },
  { id: 'web_fetch', description: 'Fetch web pages' },
  { id: 'x_search', description: 'Search X / Twitter' },
  { id: 'memory_search', description: 'Search memory' },
  { id: 'memory_get', description: 'Read memory entries' },
  { id: 'sessions_list', description: 'List sub-agent sessions' },
  { id: 'sessions_history', description: 'Read sub-agent history' },
  { id: 'sessions_send', description: 'Send work to sub-agents' },
  { id: 'sessions_spawn', description: 'Spawn sub-agents' },
  { id: 'sessions_yield', description: 'Yield for sub-agent results' },
  { id: 'subagents', description: 'Manage sub-agents' },
  { id: 'session_status', description: 'Inspect session status' },
  { id: 'browser', description: 'Control a browser' },
  { id: 'canvas', description: 'Control canvases' },
  { id: 'message', description: 'Send messages' },
  { id: 'cron', description: 'Schedule automation' },
  { id: 'gateway', description: 'Gateway control' },
  { id: 'nodes', description: 'Nodes and devices' },
  { id: 'agents_list', description: 'List agents' },
  { id: 'update_plan', description: 'Update shared plan state' },
  { id: 'image', description: 'Understand images' },
  { id: 'image_generate', description: 'Generate images' },
  { id: 'music_generate', description: 'Generate music' },
  { id: 'video_generate', description: 'Generate video' },
  { id: 'tts', description: 'Text to speech' }
];

const BUILTIN_TOOLSET_LIBRARY: BuiltinToolsetDefinition[] = [
  {
    key: 'minimal',
    name: 'Minimal',
    allow: ['read', 'write', 'edit', 'apply_patch', 'exec', 'process', 'sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn', 'sessions_yield', 'subagents', 'session_status', 'memory_search', 'memory_get'],
    deny: ['browser', 'canvas', 'nodes', 'cron', 'gateway']
  },
  {
    key: 'research',
    name: 'Research',
    allow: ['read', 'sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn', 'sessions_yield', 'subagents', 'session_status', 'memory_search', 'memory_get', 'web_search', 'web_fetch'],
    deny: ['exec', 'process', 'write', 'edit', 'browser', 'canvas', 'nodes', 'cron', 'gateway']
  },
  {
    key: 'review',
    name: 'Review',
    allow: ['read', 'sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn', 'session_status'],
    deny: ['exec', 'write', 'edit', 'browser', 'canvas', 'nodes', 'cron']
  },
  {
    key: 'codingDelegate',
    name: 'Coding Delegate',
    allow: ['read', 'write', 'edit', 'exec', 'sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn', 'session_status'],
    deny: ['browser', 'canvas', 'nodes', 'cron']
  }
];

@customElement('toolkit-dashboard')
export class ToolkitDashboard extends LitElement {
  @state() private config: any = null;
  @state() private savedConfig: any = null;
  @state() private templateFiles: any = { agents: {}, workspaces: {} };
  @state() private savedTemplateFiles: any = { agents: {}, workspaces: {} };
  @state() private statusOutput: string = '';
  @state() private statusLoaded: boolean = false;
  @state() private telegramSetupStatus: any = { defaultAccount: null, accounts: {} };
  @state() private voiceWhisperModels: string[] = [];
  @state() private voiceWhisperModelSource: string = 'fallback';
  @state() private voiceWhisperModelError: string = '';
  @state() private logs: string[] = [];
  @state() private isRunning: boolean = false;
  @state() private activeTab: string = 'status';
  @state() private configSection: string = 'general';
  @state() private featureSubsection: string = 'telegram';
  @state() private markdownTemplateScope: 'agents' | 'workspaces' = 'agents';
  @state() private markdownTemplateAgentFile: string = 'AGENTS.md';
  @state() private markdownTemplateWorkspaceFile: string = 'AGENTS.md';
  @state() private editingAgentKey: string | null = null;
  @state() private editingAgentDraft: any = null;
  @state() private editingAgentTemplateDraft: any = null;
  @state() private editingAgentInitialDraft: any = null;
  @state() private editingAgentInitialTemplateDraft: any = null;
  @state() private editingEndpointKey: string | null = null;
  @state() private editingWorkspaceId: string | null = null;
  @state() private topologyLinkSourceAgentId: string | null = null;
  @state() private topologyHoverAgentId: string | null = null;
  @state() private topologyHoverEdgeKey: string | null = null;
  @state() private topologyDraggedAgentKey: string | null = null;
  @state() private topologyHoverEndpointKey: string | null = null;
  @state() private topologyNotice: string = '';
  @state() private topologyBoardWidth: number = 0;
  @state() private topologyBoardHeight: number = 0;
  @state() private topologyEdges: any[] = [];
  @state() private topologyShowAllArrows: boolean = false;
  @state() private showModelSelector: boolean = false;
  @state() private selectorTarget: string | null = null; // 'tune' or 'candidate' or 'endpoint-hosted'
  private ws: WebSocket | null = null;
  private statusAbortController: AbortController | null = null;
  private seenServerStartTime: string | null = null;
  private reconnectTimer: number | null = null;
  private pendingSocketAction: string | null = null;
  private pendingSocketRetryTimer: number | null = null;
  private topologyMeasureFrame: number | null = null;

  // Helper for API URL construction
  private getBaseUrl() {
      // If we are served under /toolkit/, API calls must be prefixed.
      return window.location.pathname.startsWith('/toolkit') ? '/toolkit' : '';
  }

  static styles = css`
    :host { display: block; width: 100%; min-height: 100vh; background-color: #0f0f0f; }
    .layout { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; width: 100vw; }
    aside { background: #1a1a1a; border-right: 1px solid #333; padding: 20px 0; display: flex; flex-direction: column; }
    .nav-item { padding: 12px 24px; cursor: pointer; color: #aaa; transition: all 0.2s; border-left: 3px solid transparent; display: flex; align-items: center; gap: 10px; }
    .nav-item:hover { background: #252525; color: #fff; }
    .nav-item.active { background: #2a2a2a; color: #00bcd4; border-left-color: #00bcd4; }
    main { padding: 30px; overflow-y: auto; max-height: 100vh; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
    h1 { margin: 0; font-size: 1.4rem; color: #fff; display: flex; align-items: center; gap: 10px; }
    .badge { background: #00bcd4; color: #000; font-size: 0.7rem; padding: 2px 6px; border-radius: 10px; font-weight: bold; }
    .card { background: #1e1e1e; border: 1px solid #333; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px; }
    .card-header h3 { margin: 0; font-size: 1.1rem; color: #00bcd4; }
    .form-group { margin-bottom: 15px; }
    .fallback-editor { margin-top: 12px; margin-bottom: 0; width: 100%; min-width: 0; max-width: none; }
    .fallback-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; width: 100%; }
    .fallback-row { width: 100%; box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; padding: 8px 10px; border: 1px solid #444; border-radius: 8px; background: #2a2a2a; }
    .fallback-label { min-width: 0; overflow-wrap: anywhere; line-height: 1.35; }
    .fallback-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .fallback-select { margin-top: 10px; width: 100%; box-sizing: border-box; }
    label { display: block; margin-bottom: 6px; font-size: 0.85rem; color: #888; }
    .help-text { display: block; margin-top: 6px; font-size: 0.85rem; color: #888; }
    input, select, textarea { width: 100%; box-sizing: border-box; background: #2a2a2a; border: 1px solid #444; color: #fff; padding: 10px; border-radius: 4px; font-size: 0.9rem; }
    input:focus, select:focus, textarea:focus { border-color: #00bcd4; outline: none; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .btn { padding: 10px 18px; border-radius: 4px; border: none; cursor: pointer; font-weight: 600; font-size: 0.9rem; transition: opacity 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-primary { background: #00bcd4; color: #000; }
    .btn-secondary { background: #333; color: #fff; }
    .btn-danger { background: #f44336; color: #fff; }
    .btn-ghost { background: transparent; color: #888; border: 1px solid #444; }
    .btn:hover { opacity: 0.8; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .log-container { background: #000; height: 500px; overflow-y: auto; padding: 15px; border-radius: 6px; font-family: monospace; border: 1px solid #333; }
    .log-entry { margin-bottom: 2px; white-space: pre-wrap; word-break: break-all; }
    .item-row { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #252525; border: 1px solid #333; border-radius: 4px; margin-bottom: 8px; }
    .item-info { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
    .item-title { font-weight: bold; color: #fff; }
    .item-sub { font-size: 0.75rem; color: #777; }
    .tabs { display: flex; gap: 10px; margin-bottom: 20px; }
    .tab { padding: 10px 20px; cursor: pointer; border: 1px solid #333; background: #1a1a1a; border-radius: 4px; font-size: 0.9rem; color: #888; transition: all 0.2s; }
    .tab:hover { background: #252525; color: #fff; border-color: #444; }
    .tab.active { background: #00bcd4; color: #000; border-color: #00bcd4; font-weight: 600; }
    .unsaved-banner { background: #ff9800; color: #000; padding: 10px 20px; border-radius: 4px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; font-weight: bold; }
    .toggle-switch { display: flex; align-items: center; gap: 10px; cursor: pointer; }
    .toggle-switch input { width: auto; }
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal { background: #1e1e1e; border: 1px solid #333; border-radius: 8px; width: 500px; max-height: 80vh; display: flex; flex-direction: column; }
    .modal-body { padding: 20px; overflow-y: auto; }
    .selectable-item { padding: 10px; background: #252525; border: 1px solid #333; border-radius: 4px; margin-bottom: 8px; cursor: pointer; }
    .selectable-item:hover { border-color: #00bcd4; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .tag { background: #2a2a2a; border: 1px solid #444; padding: 4px 10px; border-radius: 12px; font-size: 0.8rem; display: flex; align-items: center; gap: 6px; }
    .tag-remove { cursor: pointer; color: #f44336; font-weight: bold; }
    .tool-label { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
    .tool-note-badge { display: inline-flex; align-items: center; border: 1px solid #245b68; border-radius: 999px; padding: 1px 6px; font-size: 0.64rem; line-height: 1.2; font-weight: 700; color: #7fe8ff; background: rgba(0, 188, 212, 0.08); white-space: nowrap; }
    .applied-toolset-list { display: flex; flex-direction: column; gap: 8px; width: 100%; }
    .applied-toolset-card { background: #252525; border: 1px solid #444; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
    .applied-toolset-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .toolset-preview-rows { display: flex; flex-direction: column; gap: 8px; width: 100%; }
    .toolset-preview-row { display: flex; flex-direction: column; gap: 6px; width: 100%; }
    .toolset-preview-label { font-size: 0.72rem; font-weight: 700; color: #9aa7ad; text-transform: uppercase; letter-spacing: 0.04em; }
    .toolset-preview-tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .toolset-preview-empty { font-size: 0.75rem; color: #777; }
    .status-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(450px, 1fr)); gap: 25px; }
    .status-card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s, border-color 0.2s; }
    .status-card:hover { transform: translateY(-2px); border-color: #00bcd4; }
    .status-card-header { background: #252525; padding: 12px 18px; border-bottom: 1px solid #333; display: flex; align-items: center; justify-content: space-between; }
    .status-card-header h4 { margin: 0; color: #fff; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 10px; }
    .status-indicator { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .status-online { background: #4caf50; box-shadow: 0 0 8px rgba(76, 175, 80, 0.5); }
    .status-offline { background: #f44336; box-shadow: 0 0 8px rgba(244, 67, 54, 0.5); }
    .status-content { font-family: 'Cascadia Code', 'Consolas', monospace; font-size: 0.72rem; color: #bbb; white-space: pre; overflow-x: auto; line-height: 1.6; padding: 15px; background: #0f0f0f; flex-grow: 1; }
    .status-content::-webkit-scrollbar { height: 6px; }
    .status-content::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
    .status-not-installed { background: #ff980020; box-shadow: 0 0 8px rgba(255, 152, 0, 0.3); }
    .setup-guide { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border: 1px solid #00bcd4; border-radius: 12px; padding: 28px; margin-bottom: 30px; }
    .setup-guide h2 { margin: 0 0 6px; font-size: 1.4rem; color: #fff; }
    .setup-guide .subtitle { color: #888; font-size: 0.9rem; margin: 0 0 28px; }
    .setup-steps { display: flex; flex-direction: column; gap: 14px; }
    .setup-step { display: flex; align-items: center; gap: 18px; background: #252535; border: 1px solid #333; border-radius: 8px; padding: 16px 20px; }
    .setup-step.done { border-color: #4caf50; background: #1a2a1a; }
    .setup-step.active { border-color: #00bcd4; background: #0d1e2a; }
    .step-num { width: 32px; height: 32px; border-radius: 50%; background: #333; color: #fff; font-weight: bold; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .setup-step.done .step-num { background: #4caf50; }
    .setup-step.active .step-num { background: #00bcd4; color: #000; }
    .step-body { flex: 1; }
    .step-title { font-weight: 600; color: #fff; font-size: 0.95rem; margin-bottom: 3px; }
    .step-desc { font-size: 0.8rem; color: #888; }
    .step-done-badge { color: #4caf50; font-size: 0.75rem; font-weight: bold; }
    .setup-step .btn { white-space: nowrap; flex-shrink: 0; }
    .topology-shell { display: flex; flex-direction: column; gap: 20px; }
    .topology-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
    .topology-toolbar-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: flex-end; }
    .topology-legend { display: flex; flex-wrap: wrap; gap: 10px; color: #888; font-size: 0.8rem; }
    .topology-legend-item { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid #333; border-radius: 999px; background: #181818; }
    .topology-notice { padding: 12px 14px; border-radius: 8px; border: 1px solid #3a3a3a; background: #151515; color: #ddd; }
    .topology-notice strong { color: #fff; }
    .topology-scroll { overflow: auto; padding-bottom: 8px; }
    .topology-board { position: relative; display: inline-block; min-width: 100%; min-height: 480px; overflow: visible; }
    .topology-columns { position: relative; z-index: 0; display: flex; align-items: stretch; gap: 28px; width: max-content; min-width: 100%; }
    .topology-edge-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 4; overflow: visible; }
    .topology-edge-segment { position: absolute; border-radius: 999px; box-shadow: 0 0 0 1px rgba(0,0,0,0.42), 0 0 10px color-mix(in srgb, var(--edge-color) 30%, transparent); opacity: 0.96; }
    .topology-edge-segment.h { background-image: repeating-linear-gradient(90deg, var(--edge-color) 0 10px, transparent 10px 16px); }
    .topology-edge-segment.v { background-image: repeating-linear-gradient(180deg, var(--edge-color) 0 10px, transparent 10px 16px); }
    .topology-edge-hit { position: absolute; background: transparent; border-radius: 999px; pointer-events: auto; }
    .topology-edge-arrowhead { position: absolute; width: 0; height: 0; border-style: solid; border-width: 7px 0 7px 12px; border-color: transparent transparent transparent var(--edge-color); transform-origin: center; filter: drop-shadow(0 0 2px rgba(0,0,0,0.6)); }
    .topology-edge-arrowhead-hit { position: absolute; width: 22px; height: 22px; transform-origin: center; pointer-events: auto; }
    .topology-slot { position: relative; top: auto; border: 1px solid #333; border-radius: 16px; background: linear-gradient(180deg, #191919 0%, #111 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); flex: 0 0 auto; min-height: 100%; }
    .topology-slot.drop-target { border-color: #00bcd4; box-shadow: 0 0 0 2px rgba(0, 188, 212, 0.2); }
    .topology-slot-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 16px 10px; border-bottom: 1px solid #2e2e2e; }
    .topology-slot-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .topology-slot-icon { font-size: 1.35rem; }
    .topology-slot-heading { display: flex; flex-direction: column; min-width: 0; }
    .topology-slot-heading strong { color: #fff; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .topology-slot-heading span { color: #777; font-size: 0.76rem; }
    .topology-slot-badge { color: #00bcd4; font-size: 0.74rem; border: 1px solid #24434a; border-radius: 999px; padding: 4px 8px; background: rgba(0,188,212,0.08); }
    .topology-slot-body { position: relative; display: grid; align-content: start; row-gap: 16px; column-gap: 16px; padding: 16px; }
    .topology-slot-empty { position: static; min-height: 150px; display: flex; align-items: center; justify-content: center; padding: 14px; border: 1px dashed #333; border-radius: 12px; color: #777; font-size: 0.82rem; text-align: center; background: rgba(255,255,255,0.01); }
    .topology-agent { position: relative; left: auto; right: auto; top: auto; min-height: 170px; border: 1px solid #353535; border-radius: 14px; background: #202020; padding: 12px 12px 10px; cursor: pointer; user-select: none; box-shadow: 0 8px 18px rgba(0,0,0,0.2); display: flex; flex-direction: column; z-index: 2; min-width: 0; }
    .topology-agent:hover { border-color: #4a4a4a; }
    .topology-agent.dragging { opacity: 0.55; border-style: dashed; }
    .topology-agent.disabled { opacity: 0.6; }
    .topology-agent.main-agent { border-color: #d4a514; box-shadow: 0 0 0 1px rgba(212,165,20,0.2), 0 8px 18px rgba(0,0,0,0.2); }
    .topology-agent.link-source { border-color: #00bcd4; box-shadow: 0 0 0 2px rgba(0,188,212,0.2), 0 8px 18px rgba(0,0,0,0.2); }
    .topology-agent-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .topology-agent-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .topology-agent-title strong { color: #fff; font-size: 0.92rem; white-space: normal; overflow: visible; text-overflow: unset; overflow-wrap: anywhere; }
    .topology-agent-avatar { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: #2c2c2c; font-size: 0.95rem; flex-shrink: 0; }
    .topology-agent-main { color: #ffc107; font-size: 1rem; }
    .topology-agent-badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .topology-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; border: 1px solid #3a3a3a; color: #bbb; background: #191919; }
    .topology-pill.main { border-color: #7a6210; color: #ffd54f; }
    .topology-pill.disabled { border-color: #6a2a2a; color: #ff8a80; }
    .topology-pill.shared { border-color: #25583d; color: #81c784; }
    .topology-pill.private { border-color: #234f6d; color: #90caf9; }
    .topology-pill.local { border-color: #4b5b24; color: #c5e1a5; }
    .topology-pill.hosted { border-color: #6b4d2c; color: #ffcc80; }
    .topology-agent-meta { color: #8f8f8f; font-size: 0.74rem; line-height: 1.45; min-height: 32px; overflow-wrap: anywhere; }
    .topology-agent-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; padding-top: 10px; }
    .topology-agent-actions .btn { flex: 1 1 120px; padding: 7px 10px; font-size: 0.75rem; min-width: 0; }
    .topology-card-link-hint { margin-top: 8px; color: #00bcd4; font-size: 0.72rem; }
    .topology-hover-preview { border-color: #5b6f79; box-shadow: 0 0 0 1px rgba(110,198,255,0.22), 0 8px 18px rgba(0,0,0,0.2); }
    .topology-help { color: #888; font-size: 0.82rem; line-height: 1.55; }
    .topology-help strong { color: #ddd; }
  `;

  async firstUpdated() {
    window.onerror = (msg) => { this.logs = [...this.logs, `ERR: ${msg}`]; this.requestUpdate(); };
    window.onunhandledrejection = (event) => { this.logs = [...this.logs, `REJ: ${event.reason}`]; this.requestUpdate(); };
    
    // Wait for server to be responsive
    let ready = false;
    for (let i = 0; i < 5; i++) {
        try {
            await fetch(this.getBaseUrl() + '/api/config');
            ready = true;
            break;
        } catch (e) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    if (ready) {
        await this.fetchConfig();
        await this.fetchVoiceModels();
        await this.fetchStatus();
        await this.fetchTelegramSetupStatus();
        this.connectWS();
    } else {
        console.error('Server failed to initialize after multiple attempts');
    }
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('resize', this.handleTopologyResize);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.handleTopologyResize);
    if (this.topologyMeasureFrame !== null) {
      window.cancelAnimationFrame(this.topologyMeasureFrame);
      this.topologyMeasureFrame = null;
    }
  }

  updated() {
    if (this.activeTab === 'topology') {
      this.scheduleTopologyMeasure();
    }
  }

  private handleTopologyResize = () => {
    if (this.activeTab === 'topology') {
      this.scheduleTopologyMeasure();
    }
  };

  private scheduleTopologyMeasure() {
    if (this.topologyMeasureFrame !== null) {
      return;
    }
    this.topologyMeasureFrame = window.requestAnimationFrame(() => {
      this.topologyMeasureFrame = null;
      this.measureTopologyLayout();
    });
  }

  private measureTopologyLayout() {
    if (this.activeTab !== 'topology') {
      return;
    }
    const board = this.shadowRoot?.querySelector('.topology-board') as HTMLElement | null;
    if (!board) {
      return;
    }

    const boardRect = board.getBoundingClientRect();
    const width = Math.ceil(Math.max(board.scrollWidth, boardRect.width));
    const height = Math.ceil(Math.max(board.scrollHeight, boardRect.height));
    const { laneSpacing: protectedLaneSpacing, leftPadding: protectedLeftLanePadding, rightPadding: protectedRightLanePadding } = this.getTopologyProtectedLaneMetrics();
    const agentLayouts = new Map<string, any>();
    const slotColumns = new Map<string, { leftRects: DOMRect[]; rightRects: DOMRect[] }>();
    for (const element of Array.from(board.querySelectorAll<HTMLElement>('[data-topology-agent-id]'))) {
      const agentId = element.dataset.topologyAgentId;
      if (!agentId) {
        continue;
      }
      const slotKey = String(element.dataset.topologySlotKey || '');
      const columnIndex = Number(element.dataset.topologyColumn ?? '0');
      const rect = element.getBoundingClientRect();
      agentLayouts.set(agentId, {
        rect,
        slotKey,
        columnIndex
      });
      if (slotKey) {
        const current = slotColumns.get(slotKey) || { leftRects: [], rightRects: [] };
        if (columnIndex === 0) {
          current.leftRects.push(rect);
        } else if (columnIndex === 1) {
          current.rightRects.push(rect);
        }
        slotColumns.set(slotKey, current);
      }
    }

    const slotLaneAnchors = new Map<string, { leftAnchor: number; rightAnchor: number }>();
    for (const [slotKey, columns] of slotColumns.entries()) {
      if (columns.leftRects.length === 0 || columns.rightRects.length === 0) {
        continue;
      }
      const leftBoundary = Math.max(...columns.leftRects.map((rect: DOMRect) => rect.right - boardRect.left));
      const rightBoundary = Math.min(...columns.rightRects.map((rect: DOMRect) => rect.left - boardRect.left));
      slotLaneAnchors.set(slotKey, {
        leftAnchor: leftBoundary + protectedLeftLanePadding,
        rightAnchor: rightBoundary - protectedRightLanePadding
      });
    }

    const routeSpecs: any[] = [];
    for (const sourceEntry of this.getTopologyAgentEntries()) {
      const sourceLayout = agentLayouts.get(sourceEntry.id);
      if (!sourceLayout) continue;
      const sourceRect = sourceLayout.rect as DOMRect;
      const sourceCenterX = sourceRect.left - boardRect.left + (sourceRect.width / 2);
      const sourceCenterY = sourceRect.top - boardRect.top + (sourceRect.height / 2);
      for (const targetId of this.getAgentDelegationTargets(sourceEntry.agent)) {
        const targetLayout = agentLayouts.get(targetId);
        const targetEntry = this.getTopologyAgentEntryById(targetId);
        if (!targetLayout || !targetEntry) {
          continue;
        }
        const targetRect = targetLayout.rect as DOMRect;
        const targetCenterX = targetRect.left - boardRect.left + (targetRect.width / 2);
        const targetCenterY = targetRect.top - boardRect.top + (targetRect.height / 2);
        const sharedSlotKey = sourceLayout.slotKey && sourceLayout.slotKey === targetLayout.slotKey
          ? sourceLayout.slotKey
          : '';
        if (sharedSlotKey && slotLaneAnchors.has(sharedSlotKey)) {
          routeSpecs.push({
            key: `${sourceEntry.id}->${targetId}`,
            sourceId: sourceEntry.id,
            targetId,
            active: this.topologyLinkSourceAgentId === sourceEntry.id || this.topologyLinkSourceAgentId === targetId,
            main: sourceEntry.isMain,
            fromX: sourceLayout.columnIndex === 0
              ? (sourceRect.right - boardRect.left)
              : (sourceRect.left - boardRect.left),
            fromY: sourceCenterY,
            toX: targetLayout.columnIndex === 0
              ? (targetRect.right - boardRect.left)
              : (targetRect.left - boardRect.left),
            toY: targetCenterY,
            slotKey: sharedSlotKey,
            laneSide: targetLayout.columnIndex === 0 ? 'left' : 'right',
            protectedLaneKey: `${sharedSlotKey}:${targetLayout.columnIndex === 0 ? 'left' : 'right'}`
          });
          continue;
        }

        const deltaX = targetCenterX - sourceCenterX;
        if (Math.abs(deltaX) < 80) {
          const preferRightLane = Math.max(sourceRect.right, targetRect.right) - boardRect.left + 24 <= width;
          const baseLaneX = preferRightLane
            ? Math.max(sourceRect.right, targetRect.right) - boardRect.left + 18
            : Math.min(sourceRect.left, targetRect.left) - boardRect.left - 18;
          const fromX = preferRightLane
            ? (sourceRect.right - boardRect.left)
            : (sourceRect.left - boardRect.left);
          const toX = preferRightLane
            ? (targetRect.right - boardRect.left)
            : (targetRect.left - boardRect.left);
          const fromY = sourceCenterY;
          const toY = targetCenterY;
          routeSpecs.push({
            key: `${sourceEntry.id}->${targetId}`,
            sourceId: sourceEntry.id,
            targetId,
            active: this.topologyLinkSourceAgentId === sourceEntry.id || this.topologyLinkSourceAgentId === targetId,
            main: sourceEntry.isMain,
            fromX,
            fromY,
            toX,
            toY,
            baseLaneX,
            groupKey: `same:${preferRightLane ? 'right' : 'left'}:${Math.round(baseLaneX / 32)}`
          });
        } else {
          const direction = deltaX >= 0 ? 1 : -1;
          const fromX = direction > 0
            ? (sourceRect.right - boardRect.left)
            : (sourceRect.left - boardRect.left);
          const fromY = sourceCenterY;
          const toX = direction > 0
            ? (targetRect.left - boardRect.left)
            : (targetRect.right - boardRect.left);
          const toY = targetCenterY;
          const baseLaneX = fromX + ((toX - fromX) / 2);
          routeSpecs.push({
            key: `${sourceEntry.id}->${targetId}`,
            sourceId: sourceEntry.id,
            targetId,
            active: this.topologyLinkSourceAgentId === sourceEntry.id || this.topologyLinkSourceAgentId === targetId,
            main: sourceEntry.isMain,
            fromX,
            fromY,
            toX,
            toY,
            baseLaneX,
            groupKey: `cross:${direction > 0 ? 'right' : 'left'}:${Math.round(baseLaneX / 40)}`
          });
        }
      }
    }

    const nextEdges: any[] = [];
    const buildEdge = (spec: any, laneX: number) => {
      const debugPoints = [
        { x: spec.fromX, y: spec.fromY, kind: 'start' },
        { x: laneX, y: spec.fromY, kind: 'lane' },
        { x: laneX, y: spec.toY, kind: 'lane' },
        { x: spec.toX, y: spec.toY, kind: 'end' }
      ];

      const renderSegments = debugPoints.slice(0, -1).map((point: any, index: number) => {
        const nextPoint = debugPoints[index + 1];
        const horizontal = Math.abs(point.y - nextPoint.y) < 1;
        return horizontal
          ? {
              left: Math.min(point.x, nextPoint.x),
              top: point.y - 2,
              width: Math.max(2, Math.abs(nextPoint.x - point.x)),
              height: 4,
              orientation: 'h',
              direction: nextPoint.x >= point.x ? 'right' : 'left'
            }
          : {
              left: point.x - 2,
              top: Math.min(point.y, nextPoint.y),
              width: 4,
              height: Math.max(2, Math.abs(nextPoint.y - point.y)),
              orientation: 'v',
              direction: nextPoint.y >= point.y ? 'down' : 'up'
            };
      });

      const finalSegment = renderSegments.length > 0 ? renderSegments[renderSegments.length - 1] : null;
      const arrowHead = finalSegment
        ? {
            x: debugPoints[debugPoints.length - 1].x,
            y: debugPoints[debugPoints.length - 1].y,
            rotation: finalSegment.direction === 'right'
              ? 0
              : finalSegment.direction === 'down'
                ? 90
                : finalSegment.direction === 'left'
                  ? 180
                  : -90
          }
        : null;

      nextEdges.push({
        key: spec.key,
        sourceId: spec.sourceId,
        targetId: spec.targetId,
        active: spec.active,
        main: spec.main,
        debugPoints,
        renderSegments,
        arrowHead
      });
    };

    const protectedLaneGroups = new Map<string, any[]>();
    const laneGroups = new Map<string, any[]>();
    for (const spec of routeSpecs) {
      if (spec.protectedLaneKey) {
        if (!protectedLaneGroups.has(spec.protectedLaneKey)) {
          protectedLaneGroups.set(spec.protectedLaneKey, []);
        }
        protectedLaneGroups.get(spec.protectedLaneKey)?.push(spec);
        continue;
      }
      if (!laneGroups.has(spec.groupKey)) {
        laneGroups.set(spec.groupKey, []);
      }
      laneGroups.get(spec.groupKey)?.push(spec);
    }

    for (const groupSpecs of protectedLaneGroups.values()) {
      groupSpecs.sort((left: any, right: any) => {
        const topDelta = Math.min(left.fromY, left.toY) - Math.min(right.fromY, right.toY);
        if (Math.abs(topDelta) > 0.5) {
          return topDelta;
        }
        const bottomDelta = Math.max(left.fromY, left.toY) - Math.max(right.fromY, right.toY);
        if (Math.abs(bottomDelta) > 0.5) {
          return bottomDelta;
        }
        return String(left.key).localeCompare(String(right.key));
      });

      const groupSlotKey = String(groupSpecs[0]?.slotKey || '');
      const groupSide = String(groupSpecs[0]?.laneSide || 'left');
      const anchors = slotLaneAnchors.get(groupSlotKey);
      if (!anchors) {
        continue;
      }

      groupSpecs.forEach((spec: any, index: number) => {
        const laneX = groupSide === 'left'
          ? anchors.leftAnchor + (index * protectedLaneSpacing)
          : anchors.rightAnchor - (index * protectedLaneSpacing);
        buildEdge(spec, laneX);
      });
    }

    for (const groupSpecs of laneGroups.values()) {
      groupSpecs.sort((left: any, right: any) => {
        const topDelta = Math.min(left.fromY, left.toY) - Math.min(right.fromY, right.toY);
        if (Math.abs(topDelta) > 0.5) {
          return topDelta;
        }
        const bottomDelta = Math.max(left.fromY, left.toY) - Math.max(right.fromY, right.toY);
        if (Math.abs(bottomDelta) > 0.5) {
          return bottomDelta;
        }
        return String(left.key).localeCompare(String(right.key));
      });

      const middleIndex = (groupSpecs.length - 1) / 2;
      groupSpecs.forEach((spec: any, index: number) => {
        const laneOffset = (index - middleIndex) * 12;
        const laneX = Math.max(12, Math.min(width - 12, spec.baseLaneX + laneOffset));
        buildEdge(spec, laneX);
      });
    }

    const nextSignature = JSON.stringify({
      width,
      height,
      edges: nextEdges.map((edge: any) => ({
        key: edge.key,
        active: edge.active,
        main: edge.main,
        renderSegments: edge.renderSegments,
        arrowHead: edge.arrowHead
      }))
    });
    const currentSignature = JSON.stringify({
      width: this.topologyBoardWidth,
      height: this.topologyBoardHeight,
      edges: this.topologyEdges.map((edge: any) => ({
        key: edge.key,
        active: edge.active,
        main: edge.main,
        renderSegments: edge.renderSegments,
        arrowHead: edge.arrowHead
      }))
    });

    if (nextSignature !== currentSignature) {
      this.topologyBoardWidth = width;
      this.topologyBoardHeight = height;
      this.topologyEdges = nextEdges;
    }
  }

  async fetchConfig() {
    try {
      const res = await fetch(this.getBaseUrl() + '/api/config');
      const data = await res.json();
      this.config = this.sanitizeConfigModelNames(data?.config ?? data);
      this.templateFiles = this.cloneTemplateState(data?.templates);
      this.ensureAllTemplateFiles(this.config);
      this.savedConfig = JSON.parse(JSON.stringify(this.config));
      this.savedTemplateFiles = this.cloneTemplateState(this.templateFiles);
    } catch (err) {
      console.error('Failed to fetch config', err);
    }
  }

  async fetchStatus() {
    const previousController = this.statusAbortController;
    if (previousController) {
      previousController.abort();
    }
    const controller = new AbortController();
    this.statusAbortController = controller;
    this.statusLoaded = false;

    try {
      const res = await fetch(this.getBaseUrl() + '/api/status', {
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      if (this.statusAbortController !== controller) return;
      this.statusOutput = data.output;
      this.statusLoaded = true;
    } catch (err: any) {
      if (this.statusAbortController === controller && err.name !== 'AbortError') {
        console.error('Failed to fetch status', err);
      }
    } finally {
      if (this.statusAbortController === controller) {
        this.statusAbortController = null;
      }
    }
  }

  async fetchTelegramSetupStatus() {
    try {
      const res = await fetch(this.getBaseUrl() + '/api/telegram-setup-status');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      this.telegramSetupStatus = data && typeof data === 'object'
        ? data
        : { defaultAccount: null, accounts: {} };
    } catch (err) {
      console.error('Failed to fetch Telegram setup status', err);
      this.telegramSetupStatus = { defaultAccount: null, accounts: {} };
    }
  }

  async fetchVoiceModels() {
    try {
      const res = await fetch(this.getBaseUrl() + '/api/voice-models');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.models)) {
        const models = data.models.filter((entry: any): entry is string => typeof entry === 'string' && entry.trim().length > 0) as string[];
        this.voiceWhisperModels = Array.from(new Set<string>(models));
      } else {
        this.voiceWhisperModels = [];
      }
      this.voiceWhisperModelSource = typeof data.source === 'string' ? data.source : 'fallback';
      this.voiceWhisperModelError = typeof data.error === 'string' ? data.error : '';
    } catch (err) {
      console.error('Failed to fetch voice models', err);
      this.voiceWhisperModels = [];
      this.voiceWhisperModelSource = 'fallback';
      this.voiceWhisperModelError = String(err);
    }
  }

  get hasUnsavedChanges() {
    if (!this.config || !this.savedConfig) return false;
    return JSON.stringify(this.config) !== JSON.stringify(this.savedConfig) ||
      JSON.stringify(this.templateFiles) !== JSON.stringify(this.savedTemplateFiles) ||
      this.isEditingAgentDirty();
  }

  normalizeAgentId(agentId: any) {
    return typeof agentId === 'string' ? agentId.trim() : '';
  }

  getAgentIdConflict(agentId: any, excludingKey?: string, sourceConfig: any = this.config) {
    const normalizedAgentId = this.normalizeAgentId(agentId);
    if (!normalizedAgentId) {
      return null;
    }

    const agents = Array.isArray(sourceConfig?.agents?.list) ? sourceConfig.agents.list : [];
    for (let idx = 0; idx < agents.length; idx++) {
      const agent = agents[idx];
      const key = typeof agent?.key === 'string' && agent.key.trim().length > 0 ? agent.key : `agent:${idx}`;
      if (excludingKey && key === excludingKey) {
        continue;
      }
      if (this.normalizeAgentId(agent?.id) === normalizedAgentId) {
        return { key, agent };
      }
    }

    return null;
  }

  getDuplicateAgentIds(sourceConfig: any = this.config) {
    const counts = new Map<string, number>();
    const agents = Array.isArray(sourceConfig?.agents?.list) ? sourceConfig.agents.list : [];
    for (const agent of agents) {
      const normalizedAgentId = this.normalizeAgentId(agent?.id);
      if (!normalizedAgentId) {
        continue;
      }
      counts.set(normalizedAgentId, (counts.get(normalizedAgentId) || 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([agentId]) => agentId);
  }

  getConfigValidationErrors(sourceConfig: any = this.config) {
    const errors: string[] = [];
    const duplicateAgentIds = this.getDuplicateAgentIds(sourceConfig);
    for (const agentId of duplicateAgentIds) {
      errors.push(`Agent ID "${agentId}" is used more than once. Agent IDs must be unique.`);
    }
    return errors;
  }

  getEditingAgentValidationError() {
    if (!this.editingAgentDraft) {
      return '';
    }

    const normalizedAgentId = this.normalizeAgentId(this.editingAgentDraft.id);
    if (!normalizedAgentId) {
      return 'Agent ID cannot be empty.';
    }

    const conflict = this.getAgentIdConflict(normalizedAgentId, this.editingAgentKey || undefined);
    if (conflict) {
      const conflictLabel = conflict.agent?.name ? `${conflict.agent.name} (${conflict.agent.id})` : conflict.agent?.id;
      return `Agent ID "${normalizedAgentId}" is already used by ${conflictLabel}. Agent IDs must be unique.`;
    }

    return '';
  }

  getValidationErrors() {
    const errors = this.getConfigValidationErrors();
    const editingError = this.getEditingAgentValidationError();
    if (editingError) {
      errors.unshift(editingError);
    }
    return errors;
  }

  get hasConfigValidationErrors() {
    return this.getValidationErrors().length > 0;
  }

  connectWS() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.pendingSocketAction) {
        this.schedulePendingSocketRetry();
      }
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.port === '18791' ? '127.0.0.1:18791' : window.location.host;
    this.ws = new WebSocket(`${protocol}//${host}`);
    this.ws.onopen = () => {
      if (this.reconnectTimer !== null) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.clearPendingSocketRetry();
      if (this.pendingSocketAction) {
        const pendingAction = this.pendingSocketAction;
        this.pendingSocketAction = null;
        try {
          this.ws?.send(pendingAction);
          this.logs = [...this.logs, '\n[RESUME] Dashboard connection restored. Starting queued action...\n'];
          return;
        } catch (err) {
          console.error('Failed to send queued WebSocket message', err);
          this.pendingSocketAction = pendingAction;
          this.logs = [...this.logs, '\n[WAIT] Dashboard connection is still not ready. Retrying queued action...\n'];
          this.resetWebSocketConnection();
          this.connectWS();
          return;
        }
      }
      // If a command was running when the connection dropped (e.g. dashboard rebuild
      // killed the server), mark it finished so the UI is no longer locked.
      if (this.isRunning) {
        this.isRunning = false;
        this.logs = [...this.logs, '\n[RECONNECTED] Dashboard server restarted. ✅'];
        this.fetchConfig();
        this.fetchStatus();
        this.fetchTelegramSetupStatus();
      }
    };
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'server-info') {
        const currentStartTime = String(msg.startTime);
        // On a freshly opened tab, the first server-info just establishes the
        // current backend instance. Only reload if this same tab later sees the
        // backend restart underneath it (for example after a rebuild).
        if (this.seenServerStartTime && this.seenServerStartTime !== currentStartTime) {
          window.location.reload();
          return;
        }
        this.seenServerStartTime = currentStartTime;
        return;
      }
      if (msg.type === 'stdout' || msg.type === 'stderr') {
        this.logs = [...this.logs, msg.data];
        this.requestUpdate();
        setTimeout(() => {
          const container = this.shadowRoot?.querySelector('.log-container');
          if (container) container.scrollTop = container.scrollHeight;
        }, 0);
      } else if (msg.type === 'exit') {
        this.isRunning = false;
        const label = msg.code === 0 ? '✅ Completed successfully'
                    : msg.code === 2 ? '⚠️ Manual steps needed — see above'
                    : `❌ Exited with code ${msg.code}`;
        this.logs = [...this.logs, `\n[FINISH] ${label}`];
        this.fetchConfig(); 
        this.fetchStatus();
        this.fetchTelegramSetupStatus();
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      if (this.pendingSocketAction) {
        this.schedulePendingSocketRetry();
      }
      // Auto-reconnect after 3s (handles server restart / dashboard rebuild)
      if (this.reconnectTimer === null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connectWS();
        }, 3000);
      }
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private clearPendingSocketRetry() {
    if (this.pendingSocketRetryTimer !== null) {
      window.clearTimeout(this.pendingSocketRetryTimer);
      this.pendingSocketRetryTimer = null;
    }
  }

  private resetWebSocketConnection() {
    const staleSocket = this.ws;
    this.ws = null;
    if (!staleSocket) return;
    staleSocket.onopen = null;
    staleSocket.onmessage = null;
    staleSocket.onclose = null;
    staleSocket.onerror = null;
    try {
      staleSocket.close();
    } catch (err) {
      console.error('Failed to close stale WebSocket', err);
    }
  }

  private schedulePendingSocketRetry() {
    if (!this.pendingSocketAction || this.pendingSocketRetryTimer !== null) {
      return;
    }
    this.pendingSocketRetryTimer = window.setTimeout(() => {
      this.pendingSocketRetryTimer = null;
      if (!this.pendingSocketAction) {
        return;
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        return;
      }
      this.resetWebSocketConnection();
      this.connectWS();
    }, 1500);
  }

  private trySendWebSocketMessage(payload: any, reconnectMessage: string) {
    const serialized = JSON.stringify(payload);
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(serialized);
        return true;
      }
    } catch (err) {
      console.error('Failed to send WebSocket message', err);
      this.resetWebSocketConnection();
    }

    this.pendingSocketAction = serialized;
    this.connectWS();
    this.schedulePendingSocketRetry();
    this.logs = [...this.logs, `\n[WAIT] ${reconnectMessage}`];
    this.requestUpdate();
    return false;
  }

  runCommand(command: string, args: string[] = []) {
    if (this.isRunning) return;
    this.activeTab = 'logs';
    this.isRunning = true;
    this.logs = [`[START] Running: ${command} ${args.join(' ')}...\n`];
    if (!this.trySendWebSocketMessage(
      { type: 'run-command', command, args },
      'Dashboard connection is reconnecting. The action is queued and will start automatically.'
    )) {
      return;
    }
  }

  cancelCommand() {
    if (!this.isRunning) return;
    if (this.pendingSocketAction) {
      this.pendingSocketAction = null;
      this.clearPendingSocketRetry();
      this.isRunning = false;
      this.logs = [...this.logs, '\n[CANCELLED] Queued action was cancelled before it started.\n'];
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'cancel-command' }));
      } catch (err) {
        console.error('Failed to send cancel command', err);
        this.logs = [...this.logs, '\n[WAIT] Dashboard connection is reconnecting, so cancel could not be sent yet.\n'];
      }
      return;
    }
    this.logs = [...this.logs, '\n[WAIT] Dashboard connection is reconnecting, so cancel could not be sent yet.\n'];
  }

  rebootService(service: string) {
    if (this.isRunning) return;
    if (!confirm(`Are you sure you want to reboot ${service}?`)) return;
    this.activeTab = 'logs';
    this.isRunning = true;
    this.logs = [`[REBOOT] Restarting ${service}...\n`];
    if (!this.trySendWebSocketMessage(
      { type: 'reboot-service', service },
      'Dashboard connection is reconnecting. The reboot is queued and will start automatically.'
    )) {
      return;
    }
  }

  async saveConfig() {
    const originalConfig = this.cloneValue(this.config);
    const originalTemplateFiles = this.cloneTemplateState(this.templateFiles);
    try {
      const validationErrors = this.getValidationErrors();
      if (validationErrors.length > 0) {
        alert(validationErrors[0]);
        return false;
      }
      const currentEditingAgentId = this.applyEditingAgentDraftToState();
      this.syncAllAgentModelSources();
      const persistedConfig = this.buildPersistedConfig(this.config);
      this.ensureAllTemplateFiles(persistedConfig);
      const res = await fetch(this.getBaseUrl() + '/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: persistedConfig,
          templates: this.templateFiles
        })
      });
      if (res.ok) {
        this.config = this.sanitizeConfigModelNames(persistedConfig);
        this.savedConfig = this.cloneValue(this.config);
        this.templateFiles = this.cloneTemplateState(this.templateFiles);
        if (currentEditingAgentId) {
          const updatedEntry = this.getManagedAgentEntries().find(({ agent }: any) => String(agent?.id || '') === currentEditingAgentId);
          if (updatedEntry) {
            this.setEditingAgentDraft(updatedEntry.key, updatedEntry.agent, this.ensureAgentTemplateFiles(updatedEntry.agent));
          } else {
            this.clearEditingAgentDraft();
          }
        }
        this.savedTemplateFiles = this.cloneTemplateState(this.templateFiles);
        this.fetchTelegramSetupStatus();
        alert('Configuration saved successfully.');
        return true;
      } else throw new Error('Failed to save');
    } catch (err) {
      this.config = originalConfig;
      this.templateFiles = originalTemplateFiles;
      alert('Error saving configuration.');
      return false;
    }
  }

  discardChanges() {
    if (confirm('Discard all unsaved changes?')) {
      this.config = this.cloneValue(this.savedConfig);
      this.templateFiles = this.cloneTemplateState(this.savedTemplateFiles);
      if (this.editingAgentKey) {
        if (this.editingAgentKey.startsWith('draft:')) {
          this.clearEditingAgentDraft();
        } else {
          this.startEditingAgent(this.editingAgentKey);
        }
      }
    }
  }

  async applyAndRestart() {
    const saved = await this.saveConfig();
    if (!saved) {
      return;
    }
    this.runCommand('agents');
  }

  render() {
    return html`
      <div class="layout">
        <aside>
          <div style="padding: 0 24px 20px;">
            <h1>OpenClaw <span class="badge">Toolkit</span></h1>
          </div>
          
          <div class="nav-item ${this.activeTab === 'status' ? 'active' : ''}" @click=${() => this.activeTab = 'status'}>Status</div>
          <div class="nav-item ${this.activeTab === 'topology' ? 'active' : ''}" @click=${() => this.activeTab = 'topology'}>Topology</div>
          <div class="nav-item ${this.activeTab === 'config' ? 'active' : ''}" @click=${() => this.activeTab = 'config'}>Configuration</div>
          <div class="nav-item ${this.activeTab === 'ops' ? 'active' : ''}" @click=${() => this.activeTab = 'ops'}>Operations</div>
          <div class="nav-item ${this.activeTab === 'logs' ? 'active' : ''}" @click=${() => this.activeTab = 'logs'}>
            Terminal Logs ${this.isRunning ? html`<span style="color: #00bcd4;">●</span>` : ''}
          </div>
          ${this.isRunning ? html`
            <div style="padding: 12px 24px; margin-top: auto;">
              <button class="btn btn-danger" style="width: 100%;" @click=${() => this.cancelCommand()}>⏹ Cancel</button>
            </div>
          ` : ''}
        </aside>

        <main>
          ${this.hasUnsavedChanges ? html`
            <div class="unsaved-banner">
              <span>You have unsaved changes!</span>
              <div>
                <button class="btn btn-secondary" style="background: rgba(0,0,0,0.2); color: #000;" @click=${this.discardChanges}>Discard</button>
                <button class="btn btn-primary" style="background: #000; color: #ff9800;" ?disabled=${this.hasConfigValidationErrors} @click=${this.saveConfig}>Save</button>
              </div>
            </div>
          ` : ''}
          ${this.renderContent()}
        </main>
      </div>
      ${this.showModelSelector ? this.renderModelSelector() : ''}
    `;
  }

  renderContent() {
    switch (this.activeTab) {
      case 'status': return this.renderStatus();
      case 'topology': return this.renderTopology();
      case 'config': return this.renderConfig();
      case 'ops': return this.renderOps();
      case 'logs': return this.renderLogs();
      default: return html`Select a tab`;
    }
  }

  parseStatusOutput(output: string) {
      if (!output) return [];
      const sections: { title: string, content: string, status: 'online'|'offline'|'not-installed' }[] = [];
      const parts = output.split(/\[(.*?)\]/g);
      
      for (let i = 1; i < parts.length; i += 2) {
          const title = parts[i];
          let content = parts[i+1]?.trim() || '';
          let status: 'online'|'offline'|'not-installed' = 'online';
          
          try {
              const json = JSON.parse(content);
              if (json && typeof json === 'object') {
                  if (json.ok === false || json.status === 'error') status = 'offline';
                  content = Object.entries(json)
                      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`)
                      .join('\n');
              }
          } catch (e) {
               if (content.toLowerCase().includes('not installed') ||
                    content.toLowerCase().includes('not enabled') ||
                    content.toLowerCase().includes('not initialized') ||
                    content.toLowerCase().includes('setup incomplete') ||
                    content.toLowerCase().includes('missing bot token') ||
                    content.toLowerCase().includes('timed out') ||
                    content.toLowerCase().includes('not configured yet') ||
                    content.toLowerCase().includes('not authenticated') ||
                    content.toLowerCase().includes('not verified yet') ||
                    content.toLowerCase().includes('sign in required') ||
                    content.toLowerCase().includes('not cloned yet') ||
                    content.toLowerCase().includes('bootstrap not run yet')) {
                   status = 'not-installed';
                } else if (content.toLowerCase().includes('not ready') || 
                    content.toLowerCase().includes('not running') ||
                   content.toLowerCase().includes('failed') || 
                   content.toLowerCase().includes('not responding') ||
                   content.toLowerCase().includes('error')) {
                  status = 'offline';
              }
          }
          
          sections.push({ title, content, status });
      }
      return sections;
  }

  ensureTelegramConfig() {
      if (!this.config.telegram || typeof this.config.telegram !== 'object') {
          this.config.telegram = {};
      }
      if (typeof this.config.telegram.enabled !== 'boolean') {
          this.config.telegram.enabled = true;
      }
      if (typeof this.config.telegram.defaultAccount !== 'string' || !this.config.telegram.defaultAccount.trim()) {
          this.config.telegram.defaultAccount = 'default';
      } else {
          this.config.telegram.defaultAccount = this.config.telegram.defaultAccount.trim();
      }
      if (!Array.isArray(this.config.telegram.allowFrom)) {
          this.config.telegram.allowFrom = [];
      }
      if (!Array.isArray(this.config.telegram.groupAllowFrom)) {
          this.config.telegram.groupAllowFrom = [];
      }
      if (!Array.isArray(this.config.telegram.groups)) {
          this.config.telegram.groups = [];
      }
      if (!Array.isArray(this.config.telegram.accounts)) {
          this.config.telegram.accounts = [];
      }
      this.config.telegram.groups = this.config.telegram.groups.map((group: any) => this.normalizeTelegramGroupRecord(group));
      this.config.telegram.accounts = this.config.telegram.accounts.map((account: any) => this.normalizeTelegramAccountRecord(account));
      return this.config.telegram;
  }

  ensureVoiceNotesConfig() {
      if (!this.config.voiceNotes || typeof this.config.voiceNotes !== 'object') {
          this.config.voiceNotes = {};
      }
      if (typeof this.config.voiceNotes.enabled !== 'boolean') {
          this.config.voiceNotes.enabled = true;
      }
      if (!this.config.voiceNotes.mode) {
          this.config.voiceNotes.mode = 'local-whisper';
      }
      if (!this.config.voiceNotes.gatewayImageTag) {
          this.config.voiceNotes.gatewayImageTag = 'openclaw:local-voice';
      }
      if (typeof this.config.voiceNotes.whisperModel !== 'string' || !this.config.voiceNotes.whisperModel.trim()) {
          this.config.voiceNotes.whisperModel = 'base';
      }
      return this.config.voiceNotes;
  }

  getVoiceWhisperModelOptions() {
      return Array.from(new Set(this.voiceWhisperModels)).sort((a, b) => a.localeCompare(b));
  }

  ensureTelegramExecApprovalsConfig(target?: any) {
      const telegramTarget = target && typeof target === 'object' ? target : this.ensureTelegramConfig();
      if (!telegramTarget.execApprovals || typeof telegramTarget.execApprovals !== 'object') {
          telegramTarget.execApprovals = {};
      }
      telegramTarget.execApprovals = this.normalizeTelegramExecApprovalsRecord(telegramTarget.execApprovals);
      return telegramTarget.execApprovals;
  }

  parseCommaSeparatedList(value: string) {
      return value.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  }

  getDefaultTelegramAccountId() {
      const telegram = this.ensureTelegramConfig();
      const value = typeof telegram.defaultAccount === 'string' ? telegram.defaultAccount.trim() : '';
      return value || 'default';
  }

  setDefaultTelegramAccountId(nextValue: string) {
      const telegram = this.ensureTelegramConfig();
      const previousValue = this.getDefaultTelegramAccountId();
      const normalizedValue = typeof nextValue === 'string' && nextValue.trim() ? nextValue.trim() : 'default';
      telegram.defaultAccount = normalizedValue;
      this.renameTelegramRouteAccountId(previousValue, normalizedValue);
      this.ensureTelegramRoutingConfig();
      this.requestUpdate();
  }

  normalizeTelegramExecApprovalsRecord(execApprovals: any) {
      const normalized = JSON.parse(JSON.stringify(execApprovals || {}));
      normalized.enabled = this.normalizeBoolean(normalized.enabled, false);
      if (!Array.isArray(normalized.approvers)) {
          normalized.approvers = [];
      }
      if (!normalized.target) {
          normalized.target = 'dm';
      }
      return normalized;
  }

  normalizeSingleTelegramRouteRule(route: any, defaultAccountId: string) {
      const normalized = JSON.parse(JSON.stringify(route || {}));
      normalized.accountId = typeof normalized.accountId === 'string' && normalized.accountId.trim()
        ? normalized.accountId.trim()
        : defaultAccountId;
      normalized.targetAgentId = typeof normalized.targetAgentId === 'string' ? normalized.targetAgentId.trim() : '';
      normalized.matchType = typeof normalized.matchType === 'string' ? normalized.matchType.trim().toLowerCase() : '';
      normalized.peerId = typeof normalized.peerId === 'string' ? normalized.peerId.trim() : '';
      if (!['trusted-dms', 'trusted-groups', 'direct', 'group'].includes(normalized.matchType)) {
        return null;
      }
      if (['direct', 'group'].includes(normalized.matchType) && !normalized.peerId) {
        return null;
      }
      if (!normalized.targetAgentId) {
        return null;
      }
      return normalized;
  }

  expandTelegramRouteEntries(route: any, defaultAccountId: string) {
      const source = JSON.parse(JSON.stringify(route || {}));
      const accountId = typeof source.accountId === 'string' && source.accountId.trim()
        ? source.accountId.trim()
        : defaultAccountId;
      const targetAgentId = typeof source.targetAgentId === 'string' ? source.targetAgentId.trim() : '';
      const matchType = typeof source.matchType === 'string' ? source.matchType.trim().toLowerCase() : '';
      const peerId = typeof source.peerId === 'string' ? source.peerId.trim() : '';

      if (matchType) {
        const normalized = this.normalizeSingleTelegramRouteRule({
          accountId,
          targetAgentId,
          matchType,
          peerId
        }, defaultAccountId);
        return normalized ? [normalized] : [];
      }
      return [];
  }

  getTelegramRouteKey(route: any) {
      const accountId = typeof route?.accountId === 'string' ? route.accountId.trim() : '';
      const matchType = typeof route?.matchType === 'string' ? route.matchType.trim().toLowerCase() : '';
      const peerId = typeof route?.peerId === 'string' ? route.peerId.trim() : '';
      return `${accountId}|${matchType}|${peerId}`;
  }

  normalizeTelegramRouteList(routes: any[], defaultAccountId: string) {
      const normalizedRoutes = new Map<string, any>();
      for (const route of Array.isArray(routes) ? routes : []) {
          for (const normalizedRoute of this.expandTelegramRouteEntries(route, defaultAccountId)) {
              if (!normalizedRoute?.accountId || !normalizedRoute?.matchType || !normalizedRoute?.targetAgentId) continue;
              normalizedRoutes.set(this.getTelegramRouteKey(normalizedRoute), normalizedRoute);
          }
      }
      return Array.from(normalizedRoutes.values());
  }

  ensureTelegramRoutingConfig() {
      const telegramRouting = this.getTelegramRoutingRoot();
      const defaultAccountId = this.getDefaultTelegramAccountId();
      telegramRouting.routes = this.normalizeTelegramRouteList(Array.isArray(telegramRouting.routes) ? telegramRouting.routes : [], defaultAccountId);
      return telegramRouting;
  }

  getTelegramRouteList() {
      return this.ensureTelegramRoutingConfig().routes;
  }

  getTelegramRouteRecord(accountId: string, matchType: string, peerId = '') {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : this.getDefaultTelegramAccountId();
      const normalizedMatchType = typeof matchType === 'string' ? matchType.trim().toLowerCase() : '';
      const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';
      return this.getTelegramRouteList().find((route: any) =>
        String(route?.accountId || '') === normalizedAccountId
        && String(route?.matchType || '').toLowerCase() === normalizedMatchType
        && String(route?.peerId || '') === normalizedPeerId
      ) || null;
  }

  getTelegramRoutesForAgent(agentId: string) {
      const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
      if (!normalizedAgentId) return [];
      return this.getTelegramRouteList().filter((route: any) => String(route?.targetAgentId || '') === normalizedAgentId);
  }

  getTelegramRouteListForAccount(accountId: string) {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : this.getDefaultTelegramAccountId();
      return this.getTelegramRouteList().filter((route: any) => String(route?.accountId || '') === normalizedAccountId);
  }

  upsertTelegramRouteRecord(route: any) {
      const normalized = this.normalizeSingleTelegramRouteRule(route, this.getDefaultTelegramAccountId());
      if (!normalized) return null;
      const routeKey = this.getTelegramRouteKey(normalized);
      const telegramRouting = this.ensureTelegramRoutingConfig();
      const nextRoutes = this.getTelegramRouteList()
        .filter((candidate: any) => this.getTelegramRouteKey(candidate) !== routeKey);
      nextRoutes.push(normalized);
      telegramRouting.routes = this.normalizeTelegramRouteList(nextRoutes, this.getDefaultTelegramAccountId());
      return normalized;
  }

  setTelegramManagedRouteTarget(accountId: string, matchType: string, targetAgentId: string, peerId = '') {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : this.getDefaultTelegramAccountId();
      const normalizedMatchType = typeof matchType === 'string' ? matchType.trim().toLowerCase() : '';
      const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';
      const normalizedTargetAgentId = typeof targetAgentId === 'string' ? targetAgentId.trim() : '';
      if (!normalizedTargetAgentId) {
        this.removeTelegramRouteRule(normalizedAccountId, normalizedMatchType, normalizedPeerId);
        return null;
      }

      return this.upsertTelegramRouteRecord({
        accountId: normalizedAccountId,
        targetAgentId: normalizedTargetAgentId,
        matchType: normalizedMatchType,
        peerId: normalizedPeerId
      });
  }

  addTelegramSpecificRoute(accountId: string) {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : this.getDefaultTelegramAccountId();
      const defaultTargetAgentId = String(this.getDefaultRoutingAgentEntry()?.agent?.id || '').trim();
      if (!defaultTargetAgentId) return;
      let route = {
        accountId: normalizedAccountId,
        targetAgentId: defaultTargetAgentId,
        matchType: 'group',
        peerId: ''
      };
      let suffix = 1;
      let candidatePeerId = '-1000000000000';
      while (this.getTelegramRouteRecord(normalizedAccountId, 'group', candidatePeerId)) {
        suffix += 1;
        candidatePeerId = `-100000000000${suffix}`;
      }
      route.peerId = candidatePeerId;
      this.upsertTelegramRouteRecord(route);
      this.requestUpdate();
  }

  removeTelegramRouteRule(accountId: string, matchType: string, peerId = '') {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : '';
      const normalizedMatchType = typeof matchType === 'string' ? matchType.trim().toLowerCase() : '';
      const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';
      if (!normalizedAccountId || !normalizedMatchType) return;
      const telegramRouting = this.ensureTelegramRoutingConfig();
      telegramRouting.routes = this.getTelegramRouteList().filter((route: any) =>
        !(String(route?.accountId || '') === normalizedAccountId
          && String(route?.matchType || '').toLowerCase() === normalizedMatchType
          && String(route?.peerId || '') === normalizedPeerId));
  }

  removeTelegramRouteRecord(accountId: string) {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : '';
      if (!normalizedAccountId) return;
      const telegramRouting = this.ensureTelegramRoutingConfig();
      telegramRouting.routes = this.getTelegramRouteList().filter((route: any) => String(route?.accountId || '') !== normalizedAccountId);
  }

  renameTelegramRouteAccountId(oldId: string, newId: string) {
      const normalizedOldId = typeof oldId === 'string' ? oldId.trim() : '';
      const normalizedNewId = typeof newId === 'string' ? newId.trim() : '';
      if (!normalizedOldId || !normalizedNewId || normalizedOldId === normalizedNewId) return;

      const telegramRouting = this.ensureTelegramRoutingConfig();
      telegramRouting.routes = this.getTelegramRouteList()
        .filter((route: any) => {
          if (String(route?.accountId || '') !== normalizedOldId) return true;
          route.accountId = normalizedNewId;
          return true;
        })
        .map((route: any) => this.normalizeSingleTelegramRouteRule(route, this.getDefaultTelegramAccountId()))
        .filter(Boolean);
      telegramRouting.routes = this.normalizeTelegramRouteList(telegramRouting.routes, this.getDefaultTelegramAccountId());
  }

  normalizeTelegramAccountRecord(account: any) {
      const normalized = JSON.parse(JSON.stringify(account || {}));
      normalized.id = typeof normalized.id === 'string' ? normalized.id.trim() : '';
      normalized.enabled = this.normalizeBoolean(normalized.enabled, true);
      if (!normalized.dmPolicy) {
          normalized.dmPolicy = 'pairing';
      }
      if (!normalized.groupPolicy) {
          normalized.groupPolicy = 'allowlist';
      }
      if (!Array.isArray(normalized.allowFrom)) {
          normalized.allowFrom = [];
      }
      if (!Array.isArray(normalized.groupAllowFrom)) {
          normalized.groupAllowFrom = [];
      }
      if (Array.isArray(normalized.groups)) {
          normalized.groups = normalized.groups.map((group: any) => this.normalizeTelegramGroupRecord(group));
      } else {
          normalized.groups = [];
      }
      normalized.execApprovals = this.normalizeTelegramExecApprovalsRecord(normalized.execApprovals);
      return normalized;
  }

  addTelegramAccount() {
      const telegram = this.ensureTelegramConfig();
      const existingIds = new Set((Array.isArray(telegram.accounts) ? telegram.accounts : []).map((account: any) => String(account?.id || '')));
      let suffix = (Array.isArray(telegram.accounts) ? telegram.accounts.length : 0) + 1;
      let suggestedId = `telegram-bot-${suffix}`;
      while (existingIds.has(suggestedId) || suggestedId === this.getDefaultTelegramAccountId()) {
          suffix += 1;
          suggestedId = `telegram-bot-${suffix}`;
      }
      telegram.accounts.push(this.normalizeTelegramAccountRecord({
          id: suggestedId,
          enabled: true,
          dmPolicy: 'pairing',
          allowFrom: [],
          groupPolicy: 'allowlist',
          groupAllowFrom: [],
          groups: [],
          execApprovals: {
              enabled: false,
              approvers: [],
              target: 'dm'
          }
      }));
      this.requestUpdate();
  }

  removeTelegramAccount(index: number) {
      const telegram = this.ensureTelegramConfig();
      const account = Array.isArray(telegram.accounts) ? telegram.accounts[index] : null;
      const accountId = typeof account?.id === 'string' ? account.id.trim() : '';
      if (Array.isArray(telegram.accounts)) {
          telegram.accounts.splice(index, 1);
      }
      if (accountId) {
          this.removeTelegramRouteRecord(accountId);
      }
      this.requestUpdate();
  }

  addTelegramGroup(target?: any) {
      const telegramTarget = target && typeof target === 'object' ? target : this.ensureTelegramConfig();
      if (!Array.isArray(telegramTarget.groups)) {
          telegramTarget.groups = [];
      }
      telegramTarget.groups.push({
          id: '',
          enabled: true,
          requireMention: true,
          allowFrom: []
      });
      this.requestUpdate();
  }

  removeTelegramGroup(index: number, target?: any) {
      const telegramTarget = target && typeof target === 'object' ? target : this.ensureTelegramConfig();
      if (Array.isArray(telegramTarget.groups)) {
          telegramTarget.groups.splice(index, 1);
      }
      this.requestUpdate();
  }

  getTelegramDmPolicyDescription(policy: string) {
      switch ((policy || '').trim()) {
        case 'allowlist':
          return 'Only numeric Telegram user IDs listed in Allowed User IDs can start DMs with this bot. An empty allowlist effectively blocks all DMs.';
        case 'open':
          return 'Any Telegram user can DM this bot. Use this only when you intentionally want a public-facing bot.';
        case 'disabled':
          return 'Block all Telegram direct messages for this account.';
        case 'pairing':
        default:
          return 'First-time DM senders must pair or be approved before this bot accepts their direct messages. This is the safest default for owner-operated bots.';
      }
  }

  getTelegramGroupPolicyDescription(policy: string) {
      switch ((policy || '').trim()) {
        case 'open':
          return 'Anyone inside an allowed Telegram group can talk to this bot. Group IDs still need to be listed under Allowed Groups unless you intentionally open that surface.';
        case 'disabled':
          return 'Disable Telegram group interaction for this account even if groups are configured below.';
        case 'allowlist':
        default:
          return 'Only approved senders inside allowed Telegram groups can trigger this bot. If Allowed Group Sender IDs is empty, OpenClaw falls back to the DM allowlist.';
      }
  }

  getTelegramExecApprovalTargetDescription(target: string) {
      switch ((target || '').trim()) {
        case 'channel':
          return 'Post exec approval prompts back into the originating Telegram chat or topic instead of approver DMs.';
        case 'both':
          return 'Send exec approval prompts to both approver DMs and the originating Telegram chat or topic.';
        case 'dm':
        default:
          return 'Send exec approval prompts only to the approver DMs. This is the quietest and safest default.';
      }
  }

  renderVoiceFeaturesConfig() {
      const voiceNotes = this.ensureVoiceNotesConfig();
      const whisperModelOptions = this.getVoiceWhisperModelOptions();
      const selectedWhisperModel = whisperModelOptions.includes(voiceNotes.whisperModel) ? voiceNotes.whisperModel : '__custom__';

      return html`
        <div class="card">
          <div class="card-header">
            <h3>Voice</h3>
            <button class="btn btn-ghost" @click=${() => this.fetchVoiceModels()}>Refresh Models</button>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
                <input type="checkbox" ?checked=${voiceNotes.enabled} @change=${(e: any) => { this.ensureVoiceNotesConfig().enabled = e.target.checked; this.requestUpdate(); }}>
                Enable Voice Transcription
            </label>
          </div>
          <div class="form-group">
            <label>Whisper Model</label>
            <select .value=${selectedWhisperModel} @change=${(e: any) => {
              const value = e.target.value;
              if (value !== '__custom__') {
                this.ensureVoiceNotesConfig().whisperModel = value;
              }
              this.requestUpdate();
            }}>
              ${whisperModelOptions.map((model) => html`<option value=${model}>${model}</option>`)}
              <option value="__custom__">Custom model...</option>
            </select>
            ${selectedWhisperModel === '__custom__' ? html`
              <input
                type="text"
                .value=${voiceNotes.whisperModel}
                placeholder="Enter a custom whisper model"
                @input=${(e: any) => { this.ensureVoiceNotesConfig().whisperModel = e.target.value; this.requestUpdate(); }}>
            ` : ''}
            <span class="help-text">
              ${this.voiceWhisperModelSource === 'gateway'
                ? 'Fetched from the whisper package inside the gateway image.'
                : 'Using the built-in whisper model list because the gateway model query is unavailable right now.'}
            </span>
            ${this.voiceWhisperModelError ? html`
              <span class="help-text">Model query detail: ${this.voiceWhisperModelError}</span>
            ` : ''}
          </div>
        </div>
      `;
  }

  renderTelegramAccountCard(accountTarget: any, options: {
      accountId: string;
      title: string;
      telegramRouteAgentChoices: Array<{ id: string; label: string; }>;
      isDefault?: boolean;
      removableIndex?: number;
      subtitle?: string;
  }) {
      const isDefault = options.isDefault === true;
      const accountId = typeof options.accountId === 'string' ? options.accountId.trim() : '';
      const trustedDmRoute = accountId ? this.getTelegramRouteRecord(accountId, 'trusted-dms') : null;
      const trustedGroupRoute = accountId ? this.getTelegramRouteRecord(accountId, 'trusted-groups') : null;
      const specificRoutes = accountId
        ? this.getTelegramRouteListForAccount(accountId).filter((route: any) => ['group', 'direct'].includes(String(route?.matchType || '').toLowerCase()))
        : [];
      const accountExecApprovals = this.ensureTelegramExecApprovalsConfig(isDefault ? undefined : accountTarget);
      const accountExecApprovers = Array.isArray(accountExecApprovals.approvers) ? accountExecApprovals.approvers : [];
      const accountGroups = Array.isArray(accountTarget.groups) ? accountTarget.groups : [];
      const defaultRoutingAgentLabel = this.getAgentDisplayLabel(this.getDefaultRoutingAgentEntry()?.agent);
      const trustedDmTargetLabel = trustedDmRoute?.targetAgentId
        ? (options.telegramRouteAgentChoices.find((choice: any) => choice.id === trustedDmRoute.targetAgentId)?.label || trustedDmRoute.targetAgentId)
        : '';
      const trustedGroupTargetLabel = trustedGroupRoute?.targetAgentId
        ? (options.telegramRouteAgentChoices.find((choice: any) => choice.id === trustedGroupRoute.targetAgentId)?.label || trustedGroupRoute.targetAgentId)
        : '';
      const setupStatus = this.getTelegramSetupStatusRecord(accountId, isDefault);
      const setupComplete = !!setupStatus?.configured;
      const setupBadgeStyle = setupComplete
        ? 'background: #4caf50; color: #000;'
        : 'background: #ff9800; color: #000;';
      const setupButtonLabel = setupComplete ? 'Re-run Setup' : 'Setup Account';
      const setupStatusText = setupComplete
        ? (setupStatus?.credentialSource === 'env'
          ? 'Live Telegram credentials were detected from TELEGRAM_BOT_TOKEN for this default account.'
          : 'Live Telegram credentials were detected for this account. You do not need to run setup again unless you want to reconnect or replace the bot.')
        : 'Live Telegram credentials were not detected for this account yet. Save & Apply first, then run Setup Account to connect the real bot.';

      return html`
        <div class="card" style="padding: 14px; margin-bottom: 12px; border-color: ${isDefault ? '#5c6bc0' : '#333'};">
          <div class="card-header" style="margin-bottom: 12px;">
            <h3>
              ${options.title}
              ${isDefault ? html`<span class="badge" style="background: #ffc107;">Default</span>` : ''}
              <span class="badge" style=${setupBadgeStyle}>${setupComplete ? 'Setup Complete' : 'Setup Needed'}</span>
            </h3>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn btn-ghost" ?disabled=${this.isRunning || !accountId} @click=${() => this.runCommand('telegram-setup', ['-AccountId', accountId])}>${setupButtonLabel}</button>
              ${typeof options.removableIndex === 'number'
                ? html`<button class="btn btn-danger" @click=${() => this.removeTelegramAccount(options.removableIndex!)}>Remove Account</button>`
                : ''}
            </div>
          </div>
          ${options.subtitle ? html`<div class="help-text" style="margin-top: 0; margin-bottom: 12px;">${options.subtitle}</div>` : ''}
          <div class="help-text" style="margin-top: 0; margin-bottom: 12px; color: ${setupComplete ? '#81c784' : '#ff9800'};">${setupStatusText}</div>
          <div class="form-group">
            <label>Account ID</label>
            <input
              type="text"
              .value=${accountId}
              @input=${(e: any) => {
                if (isDefault) {
                  this.setDefaultTelegramAccountId(e.target.value);
                  return;
                }

                const previousAccountId = typeof accountTarget?.id === 'string' ? accountTarget.id.trim() : '';
                accountTarget.id = e.target.value;
                const nextAccountId = typeof accountTarget?.id === 'string' ? accountTarget.id.trim() : '';
                if (previousAccountId && nextAccountId && previousAccountId !== nextAccountId) {
                  this.renameTelegramRouteAccountId(previousAccountId, nextAccountId);
                }
                this.requestUpdate();
              }}>
            <span class="help-text">${isDefault
              ? 'This is the primary Telegram account used whenever a binding does not specify an explicit account ID.'
              : 'Stable account key used for routing and for the live OpenClaw account entry under channels.telegram.accounts.<id>. Rename it only when you really want to change the account identity.'}</span>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${!!accountTarget.enabled} @change=${(e: any) => { accountTarget.enabled = e.target.checked; this.requestUpdate(); }}>
              Enable this account
            </label>
            <span class="help-text">${isDefault
              ? 'Master switch for Telegram in this toolkit config. Turning it off prevents the managed Telegram channel settings from being applied.'
              : 'Disable just this Telegram bot account while keeping the rest of the Telegram integration active.'}</span>
          </div>
          ${!isDefault ? html`
            <div class="form-group">
              <label>Display Name (optional)</label>
              <input type="text" .value=${accountTarget.name || ''} @input=${(e: any) => { accountTarget.name = e.target.value; this.requestUpdate(); }}>
              <span class="help-text">Optional human-friendly label stored in live OpenClaw config. It does not control routing; it just makes the account easier to identify.</span>
            </div>
          ` : ''}
          <div class="form-group">
            <label>DM Policy</label>
            <select .value=${accountTarget.dmPolicy || 'pairing'} @change=${(e: any) => { accountTarget.dmPolicy = e.target.value; this.requestUpdate(); }}>
              <option value="pairing">pairing</option>
              <option value="allowlist">allowlist</option>
              <option value="open">open</option>
              <option value="disabled">disabled</option>
            </select>
            <span class="help-text">${this.getTelegramDmPolicyDescription(accountTarget.dmPolicy || 'pairing')}</span>
          </div>
          <div class="form-group">
            <label>Allowed User IDs (comma separated)</label>
            <input type="text" .value=${Array.isArray(accountTarget.allowFrom) ? accountTarget.allowFrom.join(',') : ''} @input=${(e: any) => { accountTarget.allowFrom = this.parseCommaSeparatedList(e.target.value); this.requestUpdate(); }}>
            <span class="help-text">Numeric Telegram user IDs that are trusted for DMs on this account. For one-owner bots, put your own Telegram user ID here.</span>
          </div>
          <div class="form-group">
            <label>Group Policy</label>
            <select .value=${accountTarget.groupPolicy || 'allowlist'} @change=${(e: any) => { accountTarget.groupPolicy = e.target.value; this.requestUpdate(); }}>
              <option value="allowlist">allowlist</option>
              <option value="open">open</option>
              <option value="disabled">disabled</option>
            </select>
            <span class="help-text">${this.getTelegramGroupPolicyDescription(accountTarget.groupPolicy || 'allowlist')}</span>
          </div>
          <div class="form-group">
            <label>Allowed Group Sender IDs (comma separated)</label>
            <input type="text" .value=${Array.isArray(accountTarget.groupAllowFrom) ? accountTarget.groupAllowFrom.join(',') : ''} @input=${(e: any) => { accountTarget.groupAllowFrom = this.parseCommaSeparatedList(e.target.value); this.requestUpdate(); }}>
            <span class="help-text">Numeric Telegram user IDs allowed to speak inside allowed groups. Leave empty to fall back to the DM allowlist. Put negative Telegram group chat IDs under Allowed Groups below, not here.</span>
          </div>
          <div class="card" style="padding: 14px; margin-bottom: 16px;">
            <div class="card-header" style="margin-bottom: 12px;">
              <h3>Managed Routing</h3>
            </div>
            <div class="form-group">
              <label>Trusted DM Target Agent</label>
              <select ?disabled=${!accountId} .value=${trustedDmRoute?.targetAgentId || ''} @change=${(e: any) => { if (!accountId) return; this.setTelegramManagedRouteTarget(accountId, 'trusted-dms', e.target.value); this.requestUpdate(); }}>
                <option value="">Use default agent</option>
                ${options.telegramRouteAgentChoices.map((choice: any) => html`<option value=${choice.id} ?selected=${trustedDmRoute?.targetAgentId === choice.id}>${choice.label}</option>`)}
              </select>
              <span class="help-text">Choosing an agent enables a managed trusted-DM route for this account, and leaving it empty disables that managed route so Telegram falls back to <code>${defaultRoutingAgentLabel}</code>.</span>
              ${trustedDmRoute?.targetAgentId ? html`
                <span class="help-text">Trusted Telegram direct messages are currently sent to <strong>${trustedDmTargetLabel}</strong>.</span>
              ` : html`
                <span class="help-text" style="color: #ff9800; font-weight: 600;">No managed DM target is set, so trusted Telegram direct messages for this account currently fall back to <strong>${defaultRoutingAgentLabel}</strong>.</span>
              `}
            </div>
            <div class="form-group">
              <label>Allowed Groups Default Target Agent</label>
              <select ?disabled=${!accountId} .value=${trustedGroupRoute?.targetAgentId || ''} @change=${(e: any) => { if (!accountId) return; this.setTelegramManagedRouteTarget(accountId, 'trusted-groups', e.target.value); this.requestUpdate(); }}>
                <option value="">Use default agent</option>
                ${options.telegramRouteAgentChoices.map((choice: any) => html`<option value=${choice.id} ?selected=${trustedGroupRoute?.targetAgentId === choice.id}>${choice.label}</option>`)}
              </select>
              <span class="help-text">Choosing an agent enables the managed default route for allowed groups on this account, and leaving it empty disables that managed group route. Individual groups below can still override it.</span>
              ${trustedGroupRoute?.targetAgentId ? html`
                <span class="help-text">Allowed Telegram groups without a group-specific override are currently sent to <strong>${trustedGroupTargetLabel}</strong>.</span>
              ` : html`
                <span class="help-text" style="color: #ff9800; font-weight: 600;">No managed default group target is set, so allowed Telegram groups currently fall back to <strong>${defaultRoutingAgentLabel}</strong> unless a group-specific override is set below.</span>
              `}
            </div>
            <div class="card" style="padding: 14px; margin-top: 16px;">
              <div class="card-header" style="margin-bottom: 12px;">
                <h3>Specific Telegram Routes</h3>
                <button class="btn btn-ghost" ?disabled=${!accountId} @click=${() => this.addTelegramSpecificRoute(accountId)}>+ Add Specific Route</button>
              </div>
              <span class="help-text" style="margin-top: 0; margin-bottom: 12px;">Use specific routes when the same Telegram bot should send one group to one agent and another group or DM source to a different agent.</span>
              ${specificRoutes.length === 0 ? html`
                <span class="help-text">No specific Telegram routes configured for this account yet.</span>
              ` : specificRoutes.map((route: any) => html`
                <div class="card" style="padding: 14px; margin-bottom: 12px;">
                  <div class="grid-2">
                    <div class="form-group">
                      <label>Route Type</label>
                      <select .value=${route.matchType || 'group'} @change=${(e: any) => {
                        const nextMatchType = e.target.value;
                        this.removeTelegramRouteRule(accountId, route.matchType, route.peerId || '');
                        const defaultPeerId = nextMatchType === 'direct' ? '123456789' : '-1000000000000';
                        this.upsertTelegramRouteRecord({
                          accountId,
                          matchType: nextMatchType,
                          peerId: defaultPeerId,
                          targetAgentId: route.targetAgentId || String(this.getDefaultRoutingAgentEntry()?.agent?.id || '')
                        });
                        this.requestUpdate();
                      }}>
                        <option value="group">Specific group</option>
                        <option value="direct">Specific DM sender</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label>Target Agent</label>
                      <select .value=${route.targetAgentId || ''} @change=${(e: any) => { this.setTelegramManagedRouteTarget(accountId, route.matchType, e.target.value, route.peerId || ''); this.requestUpdate(); }}>
                        <option value="">Remove specific route</option>
                        ${options.telegramRouteAgentChoices.map((choice: any) => html`<option value=${choice.id} ?selected=${route.targetAgentId === choice.id}>${choice.label}</option>`)}
                      </select>
                    </div>
                  </div>
                  <div class="form-group">
                    <label>${route.matchType === 'direct' ? 'Telegram User ID' : 'Telegram Group ID'}</label>
                    <input
                      type="text"
                      .value=${route.peerId || ''}
                      @input=${(e: any) => {
                        const nextPeerId = e.target.value;
                        this.removeTelegramRouteRule(accountId, route.matchType, route.peerId || '');
                        this.upsertTelegramRouteRecord({
                          accountId,
                          matchType: route.matchType,
                          peerId: nextPeerId,
                          targetAgentId: route.targetAgentId || String(this.getDefaultRoutingAgentEntry()?.agent?.id || '')
                        });
                        this.requestUpdate();
                      }}>
                    <span class="help-text">${route.matchType === 'direct'
                      ? 'Numeric Telegram user ID that should always route to the selected agent on this account.'
                      : 'Negative Telegram group or supergroup chat ID that should always route to the selected agent on this account.'}</span>
                  </div>
                  <button class="btn btn-danger" @click=${() => { this.removeTelegramRouteRule(accountId, route.matchType, route.peerId || ''); this.requestUpdate(); }}>Remove Route</button>
                </div>
              `)}
            </div>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <div class="card-header" style="margin-bottom: 12px;">
              <h3>Allowed Groups</h3>
              <button class="btn btn-ghost" @click=${() => this.addTelegramGroup(accountTarget)}>+ Add Group</button>
            </div>
            ${accountGroups.length > 0 ? accountGroups.map((group: any, groupIndex: number) => html`
              <div class="card" style="padding: 14px; margin-bottom: 12px;">
                <div class="form-group">
                  <label>Group ID</label>
                  <input type="text" .value=${group.id || ''} @input=${(e: any) => { group.id = e.target.value; this.requestUpdate(); }}>
                  <span class="help-text">Negative Telegram group or supergroup chat ID that this bot should trust. This is the chat identifier, not a user ID.</span>
                </div>
                <div class="form-group">
                  <label class="toggle-switch">
                    <input type="checkbox" ?checked=${!!group.requireMention} @change=${(e: any) => { group.requireMention = e.target.checked; this.requestUpdate(); }}>
                    Require mention
                  </label>
                  <span class="help-text">When enabled, the bot only responds in this group when explicitly mentioned. Turn it off for always-on group behavior.</span>
                </div>
                <div class="form-group">
                  <label>Allowed Sender IDs (comma separated)</label>
                  <input type="text" .value=${Array.isArray(group.allowFrom) ? group.allowFrom.join(',') : ''} @input=${(e: any) => { group.allowFrom = this.parseCommaSeparatedList(e.target.value); this.requestUpdate(); }}>
                  <span class="help-text">Optional per-group Telegram user ID allowlist. Use this when one group should be stricter than the account-wide group sender policy.</span>
                </div>
                <div class="form-group">
                  <label>Group Policy Override</label>
                  <select @change=${(e: any) => { group.groupPolicy = e.target.value; this.requestUpdate(); }}>
                    <option value="" ?selected=${!group.groupPolicy}>${isDefault ? 'Use top-level policy' : 'Use account policy'}</option>
                    <option value="allowlist" ?selected=${group.groupPolicy === 'allowlist'}>allowlist</option>
                    <option value="open" ?selected=${group.groupPolicy === 'open'}>open</option>
                    <option value="disabled" ?selected=${group.groupPolicy === 'disabled'}>disabled</option>
                  </select>
                  <span class="help-text">Optional override for this specific group. Leave it blank to inherit the account-wide Group Policy.</span>
                </div>
                <button class="btn btn-danger" @click=${() => this.removeTelegramGroup(groupIndex, accountTarget)}>Remove Group</button>
              </div>
            `) : html`<span class="help-text">${isDefault ? 'No groups configured yet for the default account. Add a negative Telegram group ID here to enable trusted group routing.' : 'No groups configured yet for this account.'}</span>`}
          </div>
          <div class="card" style="padding: 14px; margin-top: 16px;">
            <div class="card-header" style="margin-bottom: 12px;">
              <h3>Exec Approvals</h3>
            </div>
            <div class="form-group">
              <label class="toggle-switch">
                <input type="checkbox" ?checked=${!!accountExecApprovals.enabled} @change=${(e: any) => { this.ensureTelegramExecApprovalsConfig(isDefault ? undefined : accountTarget).enabled = e.target.checked; this.requestUpdate(); }}>
                Enable Telegram exec approvals
              </label>
              <span class="help-text">Allow exec approval prompts to be delivered through Telegram for this account instead of relying only on other approval surfaces.</span>
            </div>
            <div class="form-group">
              <label>Exec Approver IDs (comma separated)</label>
              <input type="text" .value=${accountExecApprovers.join(',')} @input=${(e: any) => { this.ensureTelegramExecApprovalsConfig(isDefault ? undefined : accountTarget).approvers = this.parseCommaSeparatedList(e.target.value); this.requestUpdate(); }}>
              <span class="help-text">Numeric Telegram user IDs that are allowed to approve or deny exec requests coming from this account.</span>
            </div>
            <div class="form-group">
              <label>Exec Approval Target</label>
              <select .value=${accountExecApprovals.target || 'dm'} @change=${(e: any) => { this.ensureTelegramExecApprovalsConfig(isDefault ? undefined : accountTarget).target = e.target.value; this.requestUpdate(); }}>
                <option value="dm">dm</option>
                <option value="channel">channel</option>
                <option value="both">both</option>
              </select>
              <span class="help-text">${this.getTelegramExecApprovalTargetDescription(accountExecApprovals.target || 'dm')}</span>
            </div>
          </div>
        </div>
      `;
  }

  renderTelegramFeaturesConfig() {
      const telegram = this.ensureTelegramConfig();
      const defaultTelegramAccountId = this.getDefaultTelegramAccountId();
      const telegramAccounts = Array.isArray(telegram.accounts) ? telegram.accounts : [];
      const telegramRouteAgentChoices = this.getManagedAgentEntries().map(({ agent }: any) => ({
        id: String(agent?.id || ''),
        label: agent?.name ? `${agent.name} (${agent.id})` : String(agent?.id || '')
      }));

      return html`
        <div class="card">
          <div class="card-header">
            <h3>Telegram Accounts</h3>
            <button class="btn btn-ghost" @click=${() => this.addTelegramAccount()}>+ Add Account</button>
          </div>
          <span class="help-text">Manage the default Telegram bot and any extra Telegram bots in one place. Every account can keep its own trusted chats and target a different agent.</span>
          <span class="help-text">Use the Telegram Setup action here, on Status, or on Ops to authenticate the live channel. The dashboard does not store Telegram bot token fields in toolkit config.</span>
        </div>
        ${this.renderTelegramAccountCard(telegram, {
          accountId: defaultTelegramAccountId,
          title: defaultTelegramAccountId || 'default',
          subtitle: 'Primary account used when bindings do not specify an explicit Telegram account.',
          isDefault: true,
          telegramRouteAgentChoices
        })}
        ${telegramAccounts.length === 0 ? html`
          <div class="card">
            <span class="help-text">No additional Telegram accounts configured yet.</span>
          </div>
        ` : telegramAccounts.map((account: any, index: number) => {
          const accountId = typeof account?.id === 'string' ? account.id.trim() : '';
          const title = account?.name
            ? `${account.name} (${accountId || `telegram-bot-${index + 1}`})`
            : (accountId || `Telegram Account ${index + 1}`);

          return this.renderTelegramAccountCard(account, {
            accountId,
            title,
            removableIndex: index,
            telegramRouteAgentChoices
          });
        })}
      `;
  }

  normalizeBoolean(value: any, defaultValue: boolean) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
      if (!normalized.length) return defaultValue;
    }
    if (value == null) {
      return defaultValue;
    }
    return Boolean(value);
  }

  ensureSubagentsConfig(agent: any) {
    if (!agent.subagents || typeof agent.subagents !== 'object') {
      agent.subagents = {};
    }
    agent.subagents.enabled = this.normalizeBoolean(agent.subagents.enabled, true);
    agent.subagents.requireAgentId = this.normalizeBoolean(agent.subagents.requireAgentId, true);
    if (!Array.isArray(agent.subagents.allowAgents)) {
      agent.subagents.allowAgents = [];
    }
    return agent.subagents;
  }

  normalizeToolNameList(toolNames: any) {
    const values = Array.isArray(toolNames) ? toolNames : [];
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const rawToolName of values) {
      const toolName = String(rawToolName || '').trim();
      if (!toolName || seen.has(toolName)) {
        continue;
      }
      seen.add(toolName);
      normalized.push(toolName);
    }
    return normalized;
  }

  normalizeToolsetKey(value: any) {
    return typeof value === 'string' ? value.trim() : '';
  }

  mapLegacyToolProfileKey(profile: any) {
    const normalized = typeof profile === 'string' ? profile.trim().toLowerCase() : '';
    switch (normalized) {
      case 'research':
        return 'research';
      case 'review':
        return 'review';
      case 'codingdelegate':
        return 'codingDelegate';
      default:
        return '';
    }
  }

  getBuiltinToolsetDefinition(key: string) {
    return BUILTIN_TOOLSET_LIBRARY.find((toolset) => toolset.key === key) || null;
  }

  createToolsetRecord(toolset: any) {
    const key = this.normalizeToolsetKey(toolset?.key);
    return {
      key,
      name: typeof toolset?.name === 'string' && toolset.name.trim().length > 0 ? toolset.name.trim() : key,
      allow: this.normalizeToolNameList(toolset?.allow),
      deny: this.normalizeToolNameList(toolset?.deny)
    };
  }

  ensureAgentToolsetKeys(agent: any) {
    if (!agent || typeof agent !== 'object') {
      return [];
    }

    const toolsetKeys = this.normalizeToolNameList(agent.toolsetKeys).filter((key) => key !== 'minimal');
    if (toolsetKeys.length === 0) {
      const mappedKey = this.mapLegacyToolProfileKey(agent.toolProfile);
      if (mappedKey) {
        toolsetKeys.push(mappedKey);
      }
    }

    agent.toolsetKeys = toolsetKeys;
    delete agent.toolProfile;
    return agent.toolsetKeys;
  }

  normalizeAgentToolOverrides(agent: any) {
    const source = agent?.toolOverrides && typeof agent.toolOverrides === 'object' ? agent.toolOverrides : null;
    if (!source) {
      return null;
    }

    const normalized = {
      allow: this.normalizeToolNameList(source.allow),
      deny: this.normalizeToolNameList(source.deny)
    };
    if (normalized.allow.length === 0 && normalized.deny.length === 0) {
      return null;
    }
    return normalized;
  }

  ensureAgentToolOverrides(agent: any) {
    const normalized = this.normalizeAgentToolOverrides(agent);
    if (normalized) {
      agent.toolOverrides = normalized;
      return agent.toolOverrides;
    }

    agent.toolOverrides = {
      allow: [],
      deny: []
    };
    return agent.toolOverrides;
  }

  pruneAgentToolOverrides(agent: any) {
    const normalized = this.normalizeAgentToolOverrides(agent);
    if (normalized) {
      agent.toolOverrides = normalized;
      return normalized;
    }

    delete agent.toolOverrides;
    return null;
  }

  ensureToolsetsConfig(config: any = this.config) {
    if (!config || typeof config !== 'object') {
      return { list: [] };
    }

    if (!config.toolsets || typeof config.toolsets !== 'object') {
      config.toolsets = { list: [] };
    }
    if (!Array.isArray(config.toolsets.list)) {
      config.toolsets.list = [];
    }

    const normalizedToolsets: any[] = [];
    const seenKeys = new Set<string>();
    for (const toolset of config.toolsets.list) {
      const normalized = this.createToolsetRecord(toolset);
      if (!normalized.key || seenKeys.has(normalized.key)) {
        continue;
      }
      seenKeys.add(normalized.key);
      normalizedToolsets.push(normalized);
    }

    const legacyGlobalAllow = this.normalizeToolNameList(config?.toolPolicy?.globalAlsoAllow ?? config?.toolPolicy?.globalAllow);
    const legacyGlobalDeny = this.normalizeToolNameList(config?.toolPolicy?.globalDeny);
    if (!seenKeys.has('minimal')) {
      const builtin = this.getBuiltinToolsetDefinition('minimal');
      normalizedToolsets.unshift(this.createToolsetRecord({
        key: 'minimal',
        name: 'Minimal',
        allow: legacyGlobalAllow.length > 0 ? legacyGlobalAllow : builtin?.allow,
        deny: legacyGlobalDeny.length > 0 ? legacyGlobalDeny : builtin?.deny
      }));
      seenKeys.add('minimal');
    }

    const legacyResearchAllow = this.normalizeToolNameList(config?.toolPolicy?.researchAlsoAllow ?? config?.toolPolicy?.researchAllow);
    const legacyResearchDeny = this.normalizeToolNameList(config?.toolPolicy?.researchDeny);
    if ((legacyResearchAllow.length > 0 || legacyResearchDeny.length > 0) && !seenKeys.has('research')) {
      normalizedToolsets.push(this.createToolsetRecord({
        key: 'research',
        name: 'Research',
        allow: legacyResearchAllow,
        deny: legacyResearchDeny
      }));
      seenKeys.add('research');
    }

    if (Array.isArray(config?.agents?.list)) {
      for (const agent of config.agents.list) {
        const mappedKey = this.mapLegacyToolProfileKey(agent?.toolProfile);
        if (!mappedKey || seenKeys.has(mappedKey)) {
          continue;
        }
        const builtin = this.getBuiltinToolsetDefinition(mappedKey);
        if (!builtin) {
          continue;
        }
        normalizedToolsets.push(this.createToolsetRecord(builtin));
        seenKeys.add(mappedKey);
      }
    }

    config.toolsets.list = normalizedToolsets;
    if (Array.isArray(config?.agents?.list)) {
      config.agents.list.forEach((agent: any) => this.ensureAgentToolsetKeys(agent));
    }
    return config.toolsets;
  }

  getToolsetsList(config: any = this.config) {
    this.ensureToolsetsConfig(config);
    return Array.isArray(config?.toolsets?.list) ? config.toolsets.list : [];
  }

  getToolsetByKey(key: string, config: any = this.config) {
    const normalizedKey = this.normalizeToolsetKey(key);
    if (!normalizedKey) {
      return null;
    }
    return this.getToolsetsList(config).find((toolset: any) => toolset.key === normalizedKey) || null;
  }

  getToolOption(toolId: string) {
    return AVAILABLE_TOOL_OPTIONS.find((tool) => tool.id === toolId) || null;
  }

  getToolDisplayLabel(toolId: string) {
    const tool = this.getToolOption(toolId);
    if (!tool) {
      return toolId;
    }
    return tool.note ? `${tool.id} (${tool.note})` : tool.id;
  }

  renderToolLabel(toolId: string) {
    const tool = this.getToolOption(toolId);
    if (!tool) {
      return html`${toolId}`;
    }

    return html`
      <span class="tool-label">
        <span>${tool.id}</span>
        ${tool.note ? html`<span class="tool-note-badge">${tool.note}</span>` : ''}
      </span>
    `;
  }

  formatToolIdList(toolIds: string[], emptyLabel = 'none') {
    if (!toolIds.length) {
      return emptyLabel;
    }
    return toolIds.map((toolId) => this.getToolDisplayLabel(toolId)).join(', ');
  }

  getToolsetPreviewText(toolset: any) {
    const allow = this.normalizeToolNameList(toolset?.allow);
    const deny = this.normalizeToolNameList(toolset?.deny);
    if (allow.length === 0 && deny.length === 0) {
      return 'Allow: none | Deny: none';
    }
    return `Allow: ${this.formatToolIdList(allow)} | Deny: ${this.formatToolIdList(deny)}`;
  }

  getAgentAppliedToolsets(agent: any, config: any = this.config) {
    const applied: any[] = [];
    const seenKeys = new Set<string>();
    const minimal = this.getToolsetByKey('minimal', config);
    if (minimal) {
      applied.push(minimal);
      seenKeys.add('minimal');
    }

    for (const toolsetKey of this.ensureAgentToolsetKeys(agent)) {
      const toolset = this.getToolsetByKey(toolsetKey, config);
      if (!toolset || seenKeys.has(toolset.key)) {
        continue;
      }
      applied.push(toolset);
      seenKeys.add(toolset.key);
    }

    return applied;
  }

  getEffectiveAgentToolState(agent: any, config: any = this.config) {
    const appliedToolsets = this.getAgentAppliedToolsets(agent, config);
    const toolStates = new Map<string, 'allow' | 'deny'>();
    for (const toolset of appliedToolsets) {
      for (const toolId of this.normalizeToolNameList(toolset?.allow)) {
        toolStates.set(toolId, 'allow');
      }
      for (const toolId of this.normalizeToolNameList(toolset?.deny)) {
        toolStates.set(toolId, 'deny');
      }
    }

    const toolOverrides = this.normalizeAgentToolOverrides(agent);
    if (toolOverrides) {
      for (const toolId of this.normalizeToolNameList(toolOverrides.allow)) {
        toolStates.set(toolId, 'allow');
      }
      for (const toolId of this.normalizeToolNameList(toolOverrides.deny)) {
        toolStates.set(toolId, 'deny');
      }
    }

    const explicitTools = agent?.tools && typeof agent.tools === 'object' ? agent.tools : null;

    const knownToolIds = new Set<string>(AVAILABLE_TOOL_OPTIONS.map((tool) => tool.id));
    const allowedTools: string[] = [];
    const deniedTools: string[] = [];
    for (const tool of AVAILABLE_TOOL_OPTIONS) {
      const state = toolStates.get(tool.id);
      if (state === 'allow') {
        allowedTools.push(tool.id);
      } else if (state === 'deny') {
        deniedTools.push(tool.id);
      }
    }
    for (const [toolId, state] of toolStates.entries()) {
      if (knownToolIds.has(toolId)) {
        continue;
      }
      if (state === 'allow') {
        allowedTools.push(toolId);
      } else if (state === 'deny') {
        deniedTools.push(toolId);
      }
    }

    return { appliedToolsets, toolOverrides, allowedTools, deniedTools, explicitTools };
  }

  addToolToToolset(toolset: any, listName: 'allow' | 'deny', toolId: string) {
    const normalizedToolId = this.normalizeToolsetKey(toolId);
    if (!normalizedToolId) {
      return;
    }
    toolset.allow = this.normalizeToolNameList(toolset.allow);
    toolset.deny = this.normalizeToolNameList(toolset.deny);
    toolset.allow = toolset.allow.filter((candidate: string) => candidate !== normalizedToolId);
    toolset.deny = toolset.deny.filter((candidate: string) => candidate !== normalizedToolId);
    toolset[listName].push(normalizedToolId);
    this.requestUpdate();
  }

  removeToolFromToolset(toolset: any, listName: 'allow' | 'deny', toolId: string) {
    toolset[listName] = this.normalizeToolNameList(toolset[listName]).filter((candidate: string) => candidate !== toolId);
    this.requestUpdate();
  }

  addAgentToolset(agent: any, toolsetKey: string) {
    const normalizedKey = this.normalizeToolsetKey(toolsetKey);
    if (!normalizedKey || normalizedKey === 'minimal') {
      return;
    }
    const toolsetKeys = this.ensureAgentToolsetKeys(agent);
    if (!toolsetKeys.includes(normalizedKey)) {
      toolsetKeys.push(normalizedKey);
      this.requestUpdate();
    }
  }

  moveAgentToolset(agent: any, index: number, delta: number) {
    const toolsetKeys = this.ensureAgentToolsetKeys(agent);
    const nextIndex = index + delta;
    if (index < 0 || index >= toolsetKeys.length || nextIndex < 0 || nextIndex >= toolsetKeys.length) {
      return;
    }
    const [movedKey] = toolsetKeys.splice(index, 1);
    toolsetKeys.splice(nextIndex, 0, movedKey);
    this.requestUpdate();
  }

  addAgentToolOverride(agent: any, listName: 'allow' | 'deny', toolId: string) {
    const normalizedToolId = this.normalizeToolsetKey(toolId);
    if (!normalizedToolId) {
      return;
    }
    const toolOverrides = this.ensureAgentToolOverrides(agent);
    toolOverrides.allow = this.normalizeToolNameList(toolOverrides.allow).filter((candidate: string) => candidate !== normalizedToolId);
    toolOverrides.deny = this.normalizeToolNameList(toolOverrides.deny).filter((candidate: string) => candidate !== normalizedToolId);
    toolOverrides[listName].push(normalizedToolId);
    this.requestUpdate();
  }

  removeAgentToolOverride(agent: any, listName: 'allow' | 'deny', toolId: string) {
    const toolOverrides = this.ensureAgentToolOverrides(agent);
    toolOverrides[listName] = this.normalizeToolNameList(toolOverrides[listName]).filter((candidate: string) => candidate !== toolId);
    this.pruneAgentToolOverrides(agent);
    this.requestUpdate();
  }

  renameToolsetKey(toolset: any, rawNextKey: any) {
    const currentKey = this.normalizeToolsetKey(toolset?.key);
    const nextKey = this.normalizeToolsetKey(rawNextKey);
    if (!currentKey || !nextKey || currentKey === 'minimal') {
      return;
    }
    if (currentKey === nextKey) {
      toolset.key = nextKey;
      return;
    }
    const existing = this.getToolsetByKey(nextKey);
    if (existing && existing !== toolset) {
      alert(`Toolset key "${nextKey}" is already in use.`);
      return;
    }

    toolset.key = nextKey;
    for (const agent of Array.isArray(this.config?.agents?.list) ? this.config.agents.list : []) {
      const toolsetKeys = this.ensureAgentToolsetKeys(agent);
      const index = toolsetKeys.indexOf(currentKey);
      if (index >= 0) {
        toolsetKeys[index] = nextKey;
      }
      agent.toolsetKeys = this.normalizeToolNameList(toolsetKeys);
    }
    this.requestUpdate();
  }

  removeToolset(toolsetKey: string) {
    const normalizedKey = this.normalizeToolsetKey(toolsetKey);
    if (!normalizedKey || normalizedKey === 'minimal') {
      return;
    }
    const toolsets = this.getToolsetsList();
    this.config.toolsets.list = toolsets.filter((toolset: any) => toolset.key !== normalizedKey);
    for (const agent of Array.isArray(this.config?.agents?.list) ? this.config.agents.list : []) {
      agent.toolsetKeys = this.ensureAgentToolsetKeys(agent).filter((candidate: string) => candidate !== normalizedKey);
    }
    this.requestUpdate();
  }

  normalizeTelegramGroupRecord(group: any) {
    const normalized = JSON.parse(JSON.stringify(group || {}));
    normalized.enabled = this.normalizeBoolean(normalized.enabled, true);
    normalized.requireMention = this.normalizeBoolean(normalized.requireMention, true);
    if (!Array.isArray(normalized.allowFrom)) {
      normalized.allowFrom = [];
    }
    return normalized;
  }

  normalizeWorkspaceRecord(workspace: any) {
    const normalized = JSON.parse(JSON.stringify(workspace || {}));
    normalized.mode = normalized.mode === 'private' ? 'private' : 'shared';
    normalized.enableAgentToAgent = this.normalizeBoolean(normalized.enableAgentToAgent, false);
    normalized.manageWorkspaceAgentsMd = this.normalizeBoolean(normalized.manageWorkspaceAgentsMd, false);
    normalized.markdownTemplateKeys = this.normalizeMarkdownTemplateSelections(normalized, VALID_WORKSPACE_MARKDOWN_FILES);
    if (!Array.isArray(normalized.agents)) {
      normalized.agents = [];
    }
    normalized.agents = normalized.agents
      .map((agentId: any) => String(agentId || '').trim())
      .filter((agentId: string) => agentId.length > 0);
    if (normalized.mode === 'private') {
      if (!Array.isArray(normalized.sharedWorkspaceIds)) {
        normalized.sharedWorkspaceIds = [];
      }
      normalized.sharedWorkspaceIds = normalized.sharedWorkspaceIds
        .map((workspaceId: any) => String(workspaceId || '').trim())
        .filter((workspaceId: string) => workspaceId.length > 0);
    } else {
      normalized.sharedWorkspaceIds = [];
    }
    delete normalized.rolePolicyKey;
    delete normalized.allowSharedWorkspaceAccess;
    return normalized;
  }

  normalizeEndpointRecord(endpoint: any) {
    const normalized = JSON.parse(JSON.stringify(endpoint || {}));
    normalized.default = this.normalizeBoolean(normalized.default, false);
    if (!Array.isArray(normalized.hostedModels)) {
      normalized.hostedModels = [];
    }
    if (!Array.isArray(normalized.agents)) {
      normalized.agents = [];
    }
    normalized.agents = normalized.agents
      .map((agentId: any) => String(agentId || '').trim())
      .filter((agentId: string) => agentId.length > 0);
    return normalized;
  }

  getConfigEndpointsFrom(config: any) {
    if (Array.isArray(config?.endpoints)) {
      return config.endpoints;
    }
    return [];
  }

  getEndpointAgentIds(endpoint: any) {
    if (!endpoint || typeof endpoint !== 'object') {
      return [];
    }
    if (!Array.isArray(endpoint.agents)) {
      endpoint.agents = [];
    }
    endpoint.agents = endpoint.agents
      .map((agentId: any) => String(agentId || '').trim())
      .filter((agentId: string) => agentId.length > 0);
    return endpoint.agents;
  }

  normalizeEndpointAgentAssignments(config: any) {
    const endpoints = this.getConfigEndpointsFrom(config).map((endpoint: any) => this.normalizeEndpointRecord(endpoint));
    if (Array.isArray(config?.endpoints)) {
      config.endpoints = endpoints;
    }

    const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
    const validAgentIds = new Set(
      agents
        .map((agent: any) => String(agent?.id || '').trim())
        .filter((agentId: string) => agentId.length > 0)
    );

    const assignedAgentIds = new Set<string>();
    for (const endpoint of endpoints) {
      const cleanedAgentIds: string[] = [];
      for (const agentId of this.getEndpointAgentIds(endpoint)) {
        if (!validAgentIds.has(agentId) || assignedAgentIds.has(agentId)) {
          continue;
        }
        cleanedAgentIds.push(agentId);
        assignedAgentIds.add(agentId);
      }
      endpoint.agents = cleanedAgentIds;
    }

    for (const agent of agents) {
      delete agent.endpointKey;
    }

    return config;
  }

  getEmptyTemplateState() {
    return {
      agents: {},
      workspaces: {},
      libraries: {
        agents: {},
        workspaces: {}
      }
    };
  }

  cloneTemplateState(templates: any) {
    const base = templates && typeof templates === 'object' ? templates : this.getEmptyTemplateState();
    const clone = JSON.parse(JSON.stringify(base));
    if (!clone.agents || typeof clone.agents !== 'object') clone.agents = {};
    if (!clone.workspaces || typeof clone.workspaces !== 'object') clone.workspaces = {};
    if (!clone.libraries || typeof clone.libraries !== 'object') {
      clone.libraries = { agents: {}, workspaces: {} };
    }
    if (!clone.libraries.agents || typeof clone.libraries.agents !== 'object') clone.libraries.agents = {};
    if (!clone.libraries.workspaces || typeof clone.libraries.workspaces !== 'object') clone.libraries.workspaces = {};
    return clone;
  }

  normalizeMarkdownTemplateSelections(record: any, validFileNames: readonly string[]) {
    if (!record || typeof record !== 'object') {
      return {};
    }
    if (!record.markdownTemplateKeys || typeof record.markdownTemplateKeys !== 'object') {
      record.markdownTemplateKeys = {};
    }
    const normalized: Record<string, string> = {};
    for (const fileName of validFileNames) {
      const key = typeof record.markdownTemplateKeys[fileName] === 'string'
        ? record.markdownTemplateKeys[fileName].trim()
        : '';
      if (key) {
        normalized[fileName] = key;
      }
    }
    record.markdownTemplateKeys = normalized;
    return normalized;
  }

  getMarkdownTemplateSelection(record: any, fileName: string, validFileNames: readonly string[]) {
    const selections = this.normalizeMarkdownTemplateSelections(record, validFileNames);
    return typeof selections[fileName] === 'string' ? selections[fileName] : '';
  }

  setMarkdownTemplateSelection(record: any, fileName: string, templateKey: string | null, validFileNames: readonly string[]) {
    const selections = this.normalizeMarkdownTemplateSelections(record, validFileNames);
    const normalizedKey = typeof templateKey === 'string' ? templateKey.trim() : '';
    if (normalizedKey) {
      selections[fileName] = normalizedKey;
    } else {
      delete selections[fileName];
    }
    record.markdownTemplateKeys = selections;
  }

  ensureTemplateLibrariesRoot() {
    if (!this.templateFiles?.libraries || typeof this.templateFiles.libraries !== 'object') {
      this.templateFiles = this.cloneTemplateState(this.templateFiles);
    }
    if (!this.templateFiles.libraries.agents || typeof this.templateFiles.libraries.agents !== 'object') {
      this.templateFiles.libraries.agents = {};
    }
    if (!this.templateFiles.libraries.workspaces || typeof this.templateFiles.libraries.workspaces !== 'object') {
      this.templateFiles.libraries.workspaces = {};
    }
    return this.templateFiles.libraries;
  }

  ensureMarkdownTemplateLibrary(scope: 'agents' | 'workspaces', fileName: string) {
    const libraries = this.ensureTemplateLibrariesRoot();
    if (!libraries[scope][fileName] || typeof libraries[scope][fileName] !== 'object') {
      libraries[scope][fileName] = {};
    }
    return libraries[scope][fileName];
  }

  getMarkdownTemplateKeys(scope: 'agents' | 'workspaces', fileName: string) {
    return Object.keys(this.ensureMarkdownTemplateLibrary(scope, fileName)).sort((left, right) => left.localeCompare(right));
  }

  getMarkdownTemplateContent(scope: 'agents' | 'workspaces', fileName: string, templateKey: string | null | undefined) {
    const normalizedKey = typeof templateKey === 'string' ? templateKey.trim() : '';
    if (!normalizedKey) {
      return '';
    }
    const library = this.ensureMarkdownTemplateLibrary(scope, fileName);
    return typeof library[normalizedKey] === 'string' ? library[normalizedKey] : '';
  }

  getSelectedTemplateMarkdownFile() {
    return this.markdownTemplateScope === 'agents'
      ? this.markdownTemplateAgentFile
      : this.markdownTemplateWorkspaceFile;
  }

  setSelectedTemplateMarkdownFile(fileName: string) {
    if (this.markdownTemplateScope === 'agents') {
      this.markdownTemplateAgentFile = fileName;
    } else {
      this.markdownTemplateWorkspaceFile = fileName;
    }
  }

  getMarkdownTemplateFileOptions(scope: 'agents' | 'workspaces') {
    return scope === 'agents' ? [...VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES] : [...VALID_WORKSPACE_MARKDOWN_FILES];
  }

  clearMarkdownTemplateSelectionMatches(scope: 'agents' | 'workspaces', fileName: string, templateKey: string) {
    const validFileNames = scope === 'agents' ? VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES : VALID_WORKSPACE_MARKDOWN_FILES;
    const collection = scope === 'agents'
      ? (Array.isArray(this.config?.agents?.list) ? this.config.agents.list : [])
      : (Array.isArray(this.config?.workspaces) ? this.config.workspaces : []);

    for (const record of collection) {
      if (this.getMarkdownTemplateSelection(record, fileName, validFileNames) === templateKey) {
        this.setMarkdownTemplateSelection(record, fileName, null, validFileNames);
      }
    }

    if (scope === 'agents' && this.editingAgentDraft && this.getMarkdownTemplateSelection(this.editingAgentDraft, fileName, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES) === templateKey) {
      this.setMarkdownTemplateSelection(this.editingAgentDraft, fileName, null, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
    }
  }

  addMarkdownTemplate(scope: 'agents' | 'workspaces', fileName: string) {
    const key = prompt(`New ${scope === 'agents' ? 'agent' : 'workspace'} ${fileName} template key:`);
    const normalizedKey = typeof key === 'string' ? key.trim() : '';
    if (!normalizedKey) {
      return;
    }
    const library = this.ensureMarkdownTemplateLibrary(scope, fileName);
    if (library[normalizedKey]) {
      alert(`Template "${normalizedKey}" already exists for ${fileName}.`);
      return;
    }
    library[normalizedKey] = '';
    this.requestUpdate();
  }

  removeMarkdownTemplate(scope: 'agents' | 'workspaces', fileName: string, templateKey: string) {
    if (!confirm(`Delete template "${templateKey}" from ${fileName}?`)) {
      return;
    }
    const library = this.ensureMarkdownTemplateLibrary(scope, fileName);
    delete library[templateKey];
    this.clearMarkdownTemplateSelectionMatches(scope, fileName, templateKey);
    this.requestUpdate();
  }

  getTelegramRoutingRoot() {
    if (!this.config?.agents || typeof this.config.agents !== 'object') {
      this.config.agents = { telegramRouting: {}, list: [] };
    }
    if (!this.config.agents.telegramRouting || typeof this.config.agents.telegramRouting !== 'object') {
      this.config.agents.telegramRouting = {};
    }
    return this.config.agents.telegramRouting;
  }

  buildTemplateGuidance(lines: string[]) {
    return lines.join('\n').trimEnd();
  }

  buildDefaultAgentBootstrapFile(_agent: any, fileName: string) {
    switch (fileName) {
      case 'AGENTS.md':
        return '';
      case 'TOOLS.md':
        return '';
      case 'SOUL.md':
        return '';
      case 'IDENTITY.md':
        return '';
      case 'USER.md':
        return '';
      case 'HEARTBEAT.md':
        return '';
      case 'MEMORY.md':
        return '';
      default:
        return '';
    }
  }

  buildAgentBootstrapPlaceholder(agent: any, fileName: string) {
    const agentName = agent?.name || agent?.id || 'Agent';
    const agentId = agent?.id || 'agent';
    switch (fileName) {
      case 'AGENTS.md':
        return this.buildTemplateGuidance([
          `# AGENTS.md - ${agentName}`,
          '',
          '## Role',
          `- Add runtime instructions for ${agentName} (${agentId}) here.`
        ]);
      case 'TOOLS.md':
        return this.buildTemplateGuidance([
          `# TOOLS.md - ${agentName}`,
          '',
          `Add tool-use guidance for ${agentName} here.`
        ]);
      case 'SOUL.md':
        return this.buildTemplateGuidance([
          `# SOUL.md - ${agentName}`,
          '',
          `Add style, tone, and operating principles for ${agentName} here.`
        ]);
      case 'IDENTITY.md':
        return this.buildTemplateGuidance([
          `# IDENTITY.md - ${agentName}`,
          '',
          `Describe ${agentName}'s identity, scope, and responsibilities here.`
        ]);
      case 'USER.md':
        return this.buildTemplateGuidance([
          `# USER.md - ${agentName}`,
          '',
          `Add user-specific reminders or preferences for ${agentName} here.`
        ]);
      case 'HEARTBEAT.md':
        return this.buildTemplateGuidance([
          `# HEARTBEAT.md - ${agentName}`,
          '',
          '- Add a tiny checklist for heartbeat runs.',
          '- Keep it short so recurring checks do not burn unnecessary tokens.'
        ]);
      case 'MEMORY.md':
        return this.buildTemplateGuidance([
          `# MEMORY.md - ${agentName}`,
          '',
          `Add curated long-term memory that should stay available for ${agentName}'s normal sessions.`
        ]);
      default:
        return '';
    }
  }

  buildDefaultWorkspaceAgentsFile() {
    return '';
  }

  buildDefaultWorkspaceBootstrapFile(_workspace: any, fileName: string) {
    switch (fileName) {
      case 'AGENTS.md':
        return this.buildDefaultWorkspaceAgentsFile();
      case 'TOOLS.md':
        return '';
      case 'SOUL.md':
        return '';
      case 'IDENTITY.md':
        return '';
      case 'USER.md':
        return '';
      case 'HEARTBEAT.md':
        return '';
      case 'MEMORY.md':
        return '';
      case 'BOOTSTRAP.md':
        return '';
      case 'BOOT.md':
        return '';
      default:
        return '';
    }
  }

  buildWorkspaceBootstrapPlaceholder(workspace: any, fileName: string) {
    const workspaceName = workspace?.name || workspace?.id || 'Workspace';
    const workspaceAgents = Array.isArray(workspace?.agents) ? workspace.agents.join(', ') : '';
    switch (fileName) {
      case 'AGENTS.md':
        if (workspace?.mode === 'shared') {
          return this.buildTemplateGuidance([
            `# AGENTS.md - ${workspaceName}`,
            '',
            '## Workspace Role',
            '- This is the shared collaboration workspace.',
            '- Keep collaborative repos, durable notes, and handoff artifacts here.',
            '- Agent-specific bootstrap files are injected separately from each agent bootstrap folder.'
          ]);
        }
        return this.buildTemplateGuidance([
          `# AGENTS.md - ${workspaceName}`,
          '',
          '## Workspace Role',
          `- This is a private workspace for ${workspaceAgents || 'one agent'}.`,
          '- Keep drafts, scratch work, and agent-specific notes here.',
          '- Agent-specific bootstrap files are injected separately from each agent bootstrap folder.'
        ]);
      case 'TOOLS.md':
        return this.buildTemplateGuidance([
          `# TOOLS.md - ${workspaceName}`,
          '',
          `Add workspace-level tool guidance for ${workspaceName} here.`
        ]);
      case 'SOUL.md':
        return this.buildTemplateGuidance([
          `# SOUL.md - ${workspaceName}`,
          '',
          `Add shared tone, culture, and collaboration principles for ${workspaceName} here.`
        ]);
      case 'IDENTITY.md':
        return this.buildTemplateGuidance([
          `# IDENTITY.md - ${workspaceName}`,
          '',
          'Describe what this workspace is for and how it should be used.'
        ]);
      case 'USER.md':
        return this.buildTemplateGuidance([
          `# USER.md - ${workspaceName}`,
          '',
          'Add workspace-specific user reminders, conventions, or handoff notes here.'
        ]);
      case 'HEARTBEAT.md':
        return this.buildTemplateGuidance([
          `# HEARTBEAT.md - ${workspaceName}`,
          '',
          '- Add a tiny recurring checklist for heartbeat runs in this workspace.',
          '- Keep it short and focused.'
        ]);
      case 'MEMORY.md':
        return this.buildTemplateGuidance([
          `# MEMORY.md - ${workspaceName}`,
          '',
          'Add curated long-term memory that should be available in normal sessions for this workspace.'
        ]);
      case 'BOOTSTRAP.md':
        return this.buildTemplateGuidance([
          `# BOOTSTRAP.md - ${workspaceName}`,
          '',
          '## First Run Ritual',
          '- Use this only for a brand-new workspace.',
          '- Capture one-time setup steps, identity questions, or initial conventions here.',
          '- Delete it from the live workspace after the ritual is complete.'
        ]);
      case 'BOOT.md':
        return this.buildTemplateGuidance([
          `# BOOT.md - ${workspaceName}`,
          '',
          '## Startup Checklist',
          '- Add short, explicit instructions that should run when the gateway starts.',
          '- Keep it brief.',
          '- If a task needs to send a message, the boot-md hook should send it and then exit silently.'
        ]);
      default:
        return '';
    }
  }

  getMarkdownFileHelpText(fileName: string, scope: 'agent' | 'workspace') {
    switch (fileName) {
      case 'AGENTS.md':
        return scope === 'agent'
          ? 'Always-loaded operating instructions for this agent overlay.'
          : 'Always-loaded operating instructions for this workspace.';
      case 'TOOLS.md':
        return 'Guidance about tool use and local conventions. This does not grant capabilities by itself.';
      case 'SOUL.md':
        return 'Persona, tone, and operating style loaded into normal sessions.';
      case 'IDENTITY.md':
        return 'Identity, role, and self-description for the agent or workspace.';
      case 'USER.md':
        return 'User preferences, reminders, and relationship context.';
      case 'HEARTBEAT.md':
        return 'Optional tiny checklist for heartbeat runs. Keep it short to avoid token burn.';
      case 'MEMORY.md':
        return 'Optional curated long-term memory for normal sessions.';
      case 'BOOTSTRAP.md':
        return 'One-time first-run ritual for a brand-new workspace. The toolkit seeds it once and does not recreate it after the live file is deleted.';
      case 'BOOT.md':
        return 'Optional startup checklist run by the boot-md hook when the gateway starts.';
      default:
        return '';
    }
  }

  getMarkdownEditorRows(fileName: string) {
    switch (fileName) {
      case 'AGENTS.md':
        return 10;
      case 'BOOTSTRAP.md':
      case 'BOOT.md':
      case 'MEMORY.md':
        return 8;
      default:
        return 6;
    }
  }

  ensureAgentTemplateFiles(agent: any) {
    const agentId = typeof agent?.id === 'string' ? agent.id.trim() : '';
    if (!agentId) {
      return {};
    }
    if (!this.templateFiles?.agents || typeof this.templateFiles.agents !== 'object') {
      this.templateFiles = this.cloneTemplateState(this.templateFiles);
    }
    if (!this.templateFiles.agents[agentId] || typeof this.templateFiles.agents[agentId] !== 'object') {
      this.templateFiles.agents[agentId] = {};
    }
    for (const fileName of VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES) {
      if (typeof this.templateFiles.agents[agentId][fileName] !== 'string') {
        this.templateFiles.agents[agentId][fileName] = this.buildDefaultAgentBootstrapFile(agent, fileName);
      }
    }
    return this.templateFiles.agents[agentId];
  }

  ensureWorkspaceTemplateFiles(workspace: any) {
    const workspaceId = typeof workspace?.id === 'string' ? workspace.id.trim() : '';
    if (!workspaceId) {
      return {};
    }
    if (!this.templateFiles?.workspaces || typeof this.templateFiles.workspaces !== 'object') {
      this.templateFiles = this.cloneTemplateState(this.templateFiles);
    }
    if (!this.templateFiles.workspaces[workspaceId] || typeof this.templateFiles.workspaces[workspaceId] !== 'object') {
      this.templateFiles.workspaces[workspaceId] = {};
    }
    for (const fileName of VALID_WORKSPACE_MARKDOWN_FILES) {
      if (typeof this.templateFiles.workspaces[workspaceId][fileName] !== 'string') {
        this.templateFiles.workspaces[workspaceId][fileName] = this.buildDefaultWorkspaceBootstrapFile(workspace, fileName);
      }
    }
    return this.templateFiles.workspaces[workspaceId];
  }

  ensureAllTemplateFiles(sourceConfig: any = this.config) {
    for (const { agent } of this.getManagedAgentEntries()) {
      this.ensureAgentTemplateFiles(agent);
    }
    for (const workspace of Array.isArray(sourceConfig?.workspaces) ? sourceConfig.workspaces : []) {
      this.ensureWorkspaceTemplateFiles(workspace);
    }
  }

  cloneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  buildAgentTemplateDraft(agent: any, existingTemplates?: any) {
    const templates = existingTemplates && typeof existingTemplates === 'object'
      ? this.cloneValue(existingTemplates)
      : {};
    for (const fileName of VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES) {
      if (typeof templates[fileName] !== 'string') {
        templates[fileName] = this.buildDefaultAgentBootstrapFile(agent, fileName);
      }
    }
    return templates;
  }

  ensureEditingAgentTemplateFiles() {
    if (!this.editingAgentDraft) {
      return {};
    }
    if (!this.editingAgentTemplateDraft || typeof this.editingAgentTemplateDraft !== 'object') {
      this.editingAgentTemplateDraft = this.buildAgentTemplateDraft(this.editingAgentDraft);
    }
    for (const fileName of VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES) {
      if (typeof this.editingAgentTemplateDraft[fileName] !== 'string') {
        this.editingAgentTemplateDraft[fileName] = this.buildDefaultAgentBootstrapFile(this.editingAgentDraft, fileName);
      }
    }
    return this.editingAgentTemplateDraft;
  }

  setEditingAgentDraft(key: string, agent: any, templateFiles?: any) {
    this.editingAgentKey = key;
    this.editingAgentDraft = this.cloneValue(agent);
    this.editingAgentTemplateDraft = this.buildAgentTemplateDraft(this.editingAgentDraft, templateFiles);
    this.editingAgentInitialDraft = this.cloneValue(this.editingAgentDraft);
    this.editingAgentInitialTemplateDraft = this.cloneValue(this.editingAgentTemplateDraft);
  }

  clearEditingAgentDraft() {
    this.editingAgentKey = null;
    this.editingAgentDraft = null;
    this.editingAgentTemplateDraft = null;
    this.editingAgentInitialDraft = null;
    this.editingAgentInitialTemplateDraft = null;
  }

  startEditingAgent(key: string) {
    const entry = this.getManagedAgentEntries().find((candidate: any) => candidate.key === key);
    if (!entry?.agent) {
      return;
    }
    this.setEditingAgentDraft(key, entry.agent, this.ensureAgentTemplateFiles(entry.agent));
  }

  startNewAgentDraft() {
    const draftKey = `draft:agent:${Date.now()}`;
    const newAgent = {
      enabled: true,
      id: 'new-agent-' + Date.now(),
      name: 'New Agent',
      toolsetKeys: ['codingDelegate'],
      markdownTemplateKeys: this.getMarkdownTemplateContent('agents', 'AGENTS.md', 'codingDelegate') ? { 'AGENTS.md': 'codingDelegate' } : {},
      sandboxMode: 'off',
      modelRef: 'ollama/qwen2.5-coder:3b',
      candidateModelRefs: [],
      subagents: {
        enabled: true,
        requireAgentId: true,
        allowAgents: []
      }
    };
    this.setEditingAgentDraft(draftKey, newAgent);
  }

  isEditingAgentDirty() {
    if (!this.editingAgentDraft) {
      return false;
    }
    return JSON.stringify(this.editingAgentDraft) !== JSON.stringify(this.editingAgentInitialDraft) ||
      JSON.stringify(this.ensureEditingAgentTemplateFiles()) !== JSON.stringify(this.editingAgentInitialTemplateDraft);
  }

  closeEditingAgentEditor() {
    if (this.isEditingAgentDirty() && !confirm('Discard unsaved changes for this agent?')) {
      return;
    }
    this.clearEditingAgentDraft();
  }

  applyEditingAgentDraftToState() {
    if (!this.editingAgentDraft || !this.editingAgentKey) {
      return '';
    }

    if (!this.config.agents || typeof this.config.agents !== 'object') {
      this.config.agents = { telegramRouting: {}, list: [] };
    }
    if (!Array.isArray(this.config.agents.list)) {
      this.config.agents.list = [];
    }

    const draftAgent = this.cloneValue(this.editingAgentDraft);
    const draftTemplates = this.cloneValue(this.ensureEditingAgentTemplateFiles());
    const existingIndex = this.config.agents.list.findIndex((candidate: any, idx: number) => {
      const candidateKey = typeof candidate?.key === 'string' && candidate.key.trim().length > 0 ? candidate.key : `agent:${idx}`;
      return candidateKey === this.editingAgentKey;
    });

    if (existingIndex >= 0) {
      const existingAgent = this.config.agents.list[existingIndex];
      const previousAgentId = this.normalizeAgentId(existingAgent?.id);
      const nextAgentId = this.normalizeAgentId(draftAgent.id);
      if (previousAgentId && nextAgentId && previousAgentId !== nextAgentId) {
        this.renameAgentIdEverywhere(previousAgentId, nextAgentId);
      }
      if (typeof existingAgent?.key === 'string' && existingAgent.key.trim().length > 0) {
        draftAgent.key = existingAgent.key;
      }
      this.config.agents.list[existingIndex] = draftAgent;
    } else {
      delete draftAgent.key;
      this.config.agents.list.push(draftAgent);
    }

    if (!this.templateFiles?.agents || typeof this.templateFiles.agents !== 'object') {
      this.templateFiles = this.cloneTemplateState(this.templateFiles);
    }
    this.templateFiles.agents[this.normalizeAgentId(draftAgent.id)] = draftTemplates;
    return this.normalizeAgentId(draftAgent.id);
  }

  renameAgentIdEverywhere(oldId: string, newId: string) {
    const normalizedOldId = typeof oldId === 'string' ? oldId.trim() : '';
    const normalizedNewId = typeof newId === 'string' ? newId.trim() : '';
    if (!normalizedOldId || !normalizedNewId || normalizedOldId === normalizedNewId) {
      return;
    }

    if (this.templateFiles?.agents?.[normalizedOldId] && !this.templateFiles.agents[normalizedNewId]) {
      this.templateFiles.agents[normalizedNewId] = this.templateFiles.agents[normalizedOldId];
    }
    if (this.templateFiles?.agents && this.templateFiles.agents[normalizedOldId]) {
      delete this.templateFiles.agents[normalizedOldId];
    }

    for (const { agent } of this.getManagedAgentEntries()) {
      const subagents = this.ensureSubagentsConfig(agent);
      subagents.allowAgents = subagents.allowAgents.map((candidateId: string) => candidateId === normalizedOldId ? normalizedNewId : candidateId);
    }

    for (const workspace of Array.isArray(this.config?.workspaces) ? this.config.workspaces : []) {
      if (Array.isArray(workspace?.agents)) {
        workspace.agents = workspace.agents.map((agentId: string) => agentId === normalizedOldId ? normalizedNewId : agentId);
      }
    }

    for (const endpoint of this.getConfigEndpoints()) {
      endpoint.agents = this.getEndpointAgentIds(endpoint).map((agentId: string) => agentId === normalizedOldId ? normalizedNewId : agentId);
    }

    const telegramRouting = this.ensureTelegramRoutingConfig();
    if (telegramRouting) {
      telegramRouting.routes = this.getTelegramRouteList().map((route: any) => {
        if (String(route?.targetAgentId || '') === normalizedOldId) {
          route.targetAgentId = normalizedNewId;
        }
        return route;
      });
    }

    if (this.topologyLinkSourceAgentId === normalizedOldId) {
      this.topologyLinkSourceAgentId = normalizedNewId;
    }
  }

  renameWorkspaceIdEverywhere(oldId: string, newId: string) {
    const normalizedOldId = typeof oldId === 'string' ? oldId.trim() : '';
    const normalizedNewId = typeof newId === 'string' ? newId.trim() : '';
    if (!normalizedOldId || !normalizedNewId || normalizedOldId === normalizedNewId) {
      return;
    }

    if (this.templateFiles?.workspaces?.[normalizedOldId] && !this.templateFiles.workspaces[normalizedNewId]) {
      this.templateFiles.workspaces[normalizedNewId] = this.templateFiles.workspaces[normalizedOldId];
    }
    if (this.templateFiles?.workspaces && this.templateFiles.workspaces[normalizedOldId]) {
      delete this.templateFiles.workspaces[normalizedOldId];
    }

    for (const workspace of Array.isArray(this.config?.workspaces) ? this.config.workspaces : []) {
      if (Array.isArray(workspace?.sharedWorkspaceIds)) {
        workspace.sharedWorkspaceIds = workspace.sharedWorkspaceIds.map((workspaceId: string) =>
          workspaceId === normalizedOldId ? normalizedNewId : workspaceId
        );
      }
    }

    if (this.editingWorkspaceId === normalizedOldId) {
      this.editingWorkspaceId = normalizedNewId;
    }
  }

  normalizeWorkspaceAssignments(config: any = this.config) {
    if (!Array.isArray(config?.workspaces)) {
      config.workspaces = [];
    }

    config.workspaces = config.workspaces.map((workspace: any) => this.normalizeWorkspaceRecord(workspace));
    const validAgentIds = new Set(
      (Array.isArray(config?.agents?.list) ? config.agents.list : [])
        .map((agent: any) => String(agent?.id || '').trim())
        .filter((agentId: string) => agentId.length > 0)
    );
    const sharedWorkspaceIds = config.workspaces
      .filter((workspace: any) => workspace?.mode === 'shared')
      .map((workspace: any) => String(workspace?.id || '').trim())
      .filter((workspaceId: string) => workspaceId.length > 0);

    const assignedAgentIds = new Set<string>();
    for (const workspace of config.workspaces) {
      const cleanedAgentIds: string[] = [];
      for (const agentId of Array.isArray(workspace?.agents) ? workspace.agents : []) {
        const normalizedAgentId = String(agentId || '').trim();
        if (!normalizedAgentId || !validAgentIds.has(normalizedAgentId) || assignedAgentIds.has(normalizedAgentId)) {
          continue;
        }
        cleanedAgentIds.push(normalizedAgentId);
        assignedAgentIds.add(normalizedAgentId);
        if (workspace.mode === 'private') {
          break;
        }
      }
      workspace.agents = cleanedAgentIds;

      if (workspace.mode === 'private') {
        const cleanedSharedWorkspaceIds: string[] = [];
        for (const workspaceId of Array.isArray(workspace.sharedWorkspaceIds) ? workspace.sharedWorkspaceIds : []) {
          const normalizedWorkspaceId = String(workspaceId || '').trim();
          if (!normalizedWorkspaceId || !sharedWorkspaceIds.includes(normalizedWorkspaceId) || cleanedSharedWorkspaceIds.includes(normalizedWorkspaceId)) {
            continue;
          }
          cleanedSharedWorkspaceIds.push(normalizedWorkspaceId);
        }
        workspace.sharedWorkspaceIds = cleanedSharedWorkspaceIds;
      } else {
        workspace.sharedWorkspaceIds = [];
      }
      delete workspace.allowSharedWorkspaceAccess;
    }

    return config;
  }

  getWorkspaces() {
    if (!Array.isArray(this.config?.workspaces)) {
      this.config.workspaces = [];
    }
    this.normalizeWorkspaceAssignments(this.config);
    return this.config.workspaces;
  }

  getWorkspaceAgentIds(workspace: any) {
    if (!workspace || typeof workspace !== 'object') {
      return [];
    }
    if (!Array.isArray(workspace.agents)) {
      workspace.agents = [];
    }
    workspace.agents = workspace.agents
      .map((agentId: any) => String(agentId || '').trim())
      .filter((agentId: string) => agentId.length > 0);
    return workspace.agents;
  }

  getWorkspaceSharedAccessIds(workspace: any) {
    if (!workspace || typeof workspace !== 'object' || workspace.mode !== 'private') {
      return [];
    }
    if (!Array.isArray(workspace.sharedWorkspaceIds)) {
      workspace.sharedWorkspaceIds = [];
    }
    workspace.sharedWorkspaceIds = workspace.sharedWorkspaceIds
      .map((workspaceId: any) => String(workspaceId || '').trim())
      .filter((workspaceId: string) => workspaceId.length > 0);
    return workspace.sharedWorkspaceIds;
  }

  getWorkspaceById(workspaceId: string | null | undefined) {
    if (!workspaceId) return null;
    return this.getWorkspaces().find((workspace: any) => String(workspace?.id || '') === workspaceId) || null;
  }

  getWorkspaceForAgentId(agentId: string | null | undefined) {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) {
      return null;
    }
    return this.getWorkspaces().find((workspace: any) => this.getWorkspaceAgentIds(workspace).includes(normalizedAgentId)) || null;
  }

  getSharedWorkspaces() {
    return this.getWorkspaces().filter((workspace: any) => workspace?.mode === 'shared');
  }

  getWorkspaceDisplayLabel(workspace: any) {
    if (!workspace) {
      return 'No workspace';
    }
    const label = String(workspace?.name || workspace?.id || 'Workspace');
    return `${label} (${workspace.mode === 'private' ? 'private' : 'shared'})`;
  }

  getAgentEffectiveSandboxMode(agent: any) {
    if (typeof agent?.sandboxMode === 'string' && agent.sandboxMode.trim().length > 0) {
      return agent.sandboxMode.trim();
    }
    if (typeof this.config?.sandbox?.mode === 'string' && this.config.sandbox.mode.trim().length > 0) {
      return this.config.sandbox.mode.trim();
    }
    return 'off';
  }

  isAgentSandboxEffectivelyOff(agent: any) {
    return this.getAgentEffectiveSandboxMode(agent) === 'off';
  }

  getWorkspaceHomeBaseDescription(workspace: any) {
    if (!workspace) {
      return 'No home workspace assigned yet.';
    }
    if (workspace.mode === 'private') {
      return 'Private home workspace';
    }
    return 'Shared collaboration home workspace';
  }

  enforceWorkspaceSandboxPolicy(agent: any, workspace: any) {
    if (!agent || !workspace) {
      return '';
    }

    const agentName = String(agent?.name || agent?.id || 'Agent');
    const workspaceName = String(workspace?.name || workspace?.id || 'workspace');
    const sharedAccessIds = workspace?.mode === 'private' ? this.getWorkspaceSharedAccessIds(workspace) : [];
    const needsSandboxOff = workspace.mode === 'shared' || sharedAccessIds.length > 0;
    const effectiveSandboxMode = this.getAgentEffectiveSandboxMode(agent);

    if (needsSandboxOff) {
      if (effectiveSandboxMode !== 'off') {
        agent.sandboxMode = 'off';
        if (workspace.mode === 'shared') {
          return `${agentName} now lives in shared workspace "${workspaceName}", so the toolkit turned sandbox off. Shared collaboration should not be limited to a single private home-base path.`;
        }
        return `${agentName} keeps private workspace "${workspaceName}" as the home base, but shared workspace access is enabled, so the toolkit turned sandbox off to let the agent reach those extra collaboration workspaces.`;
      }
      return '';
    }

    if (effectiveSandboxMode === 'off' || effectiveSandboxMode === 'all') {
      agent.sandboxMode = 'workspace-write';
      return `${agentName} now lives only in private workspace "${workspaceName}", so the toolkit turned sandbox on with workspace-write mode. The private workspace is now the agent's home base and privacy boundary.`;
    }

    return '';
  }

  setAgentPrimaryWorkspace(agentId: string, workspaceId: string | null) {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) {
      return;
    }

    for (const workspace of this.getWorkspaces()) {
      workspace.agents = this.getWorkspaceAgentIds(workspace).filter((candidateId: string) => candidateId !== normalizedAgentId);
    }

    if (!workspaceId) {
      this.requestUpdate();
      return;
    }

    const targetWorkspace = this.getWorkspaceById(workspaceId);
    if (!targetWorkspace) {
      this.requestUpdate();
      return;
    }

    const targetAgent = this.getManagedAgentEntries().find(({ agent }: any) => String(agent?.id || '') === normalizedAgentId)?.agent || null;

    if (targetWorkspace.mode === 'private') {
      targetWorkspace.agents = [normalizedAgentId];
    } else if (!this.getWorkspaceAgentIds(targetWorkspace).includes(normalizedAgentId)) {
      targetWorkspace.agents = [...this.getWorkspaceAgentIds(targetWorkspace), normalizedAgentId];
    }

    this.normalizeWorkspaceAssignments(this.config);
    if (targetAgent) {
      const message = this.enforceWorkspaceSandboxPolicy(targetAgent, targetWorkspace);
      if (message) {
        alert(message);
      }
    }
    this.requestUpdate();
  }

  setWorkspaceSharedAccess(workspace: any, sharedWorkspaceIds: string[]) {
    if (!workspace || workspace.mode !== 'private') {
      return;
    }
    const availableSharedIds = new Set(this.getSharedWorkspaces().map((candidate: any) => String(candidate?.id || '')));
    workspace.sharedWorkspaceIds = Array.from(new Set(
      sharedWorkspaceIds
        .map((workspaceId: any) => String(workspaceId || '').trim())
        .filter((workspaceId: string) => workspaceId.length > 0 && availableSharedIds.has(workspaceId))
    ));
    const primaryAgentId = this.getWorkspaceAgentIds(workspace)[0];
    if (primaryAgentId) {
      const primaryAgent = this.getManagedAgentEntries().find(({ agent }: any) => String(agent?.id || '') === primaryAgentId)?.agent || null;
      if (primaryAgent) {
        const message = this.enforceWorkspaceSandboxPolicy(primaryAgent, workspace);
        if (message) {
          alert(message);
        }
      }
    }
    this.requestUpdate();
  }

  renderStatus() {
    const sections = this.parseStatusOutput(this.statusOutput);
    const rebootMap: Record<string, string> = {
        'Docker': 'docker',
        'Gateway': 'gateway',
        'Tailscale Serve': 'tailscale',
        'Ollama Runtime': 'ollama'
    };
    const authActionMap: Record<string, string> = {
        'OpenAI Auth': 'openai-auth',
        'Claude Auth': 'claude-auth',
        'Gemini Auth': 'gemini-auth',
        'Copilot Auth': 'copilot-auth',
        'Ollama Cloud Auth': 'ollama-auth'
    };
    const authActionLabelMap: Record<string, string> = {
        'Ollama Cloud Auth': 'Sign in'
    };

    const dockerSection = sections.find(s => s.title === 'Docker');
    const ollamaSection = sections.find(s => s.title === 'Ollama Runtime');
    const gatewaySection = sections.find(s => s.title === 'Gateway');
    const wsl2Section = sections.find(s => s.title === 'WSL2');
    const virtSection = sections.find(s => s.title === 'Virtualization');
    const bootstrapSection = sections.find(s => s.title === 'Bootstrap');
    const managedImagesSection = sections.find(s => s.title === 'Managed Images');

    // If the script crashed and produced no parseable sections, treat as unprovisioned
    const scriptFailed = sections.length === 0 && !!this.statusOutput;

    const managedImageCounts = managedImagesSection?.content.match(/(\d+)\s*\/\s*(\d+)\s*present/i);
    const managedImagesPresentCount = managedImageCounts ? Number(managedImageCounts[1]) : 0;
    const managedImagesExpectedCount = managedImageCounts ? Number(managedImageCounts[2]) : 0;
    const bootstrapAssetsIncomplete = !scriptFailed && managedImagesExpectedCount > 0 && managedImagesPresentCount < managedImagesExpectedCount;

    const dockerNotInstalled = scriptFailed || dockerSection?.status === 'not-installed';
    const ollamaNotInstalled = scriptFailed || ollamaSection?.status === 'not-installed';
    const wsl2NotInstalled = !scriptFailed && (wsl2Section?.status === 'not-installed' || wsl2Section?.status === 'offline');
    const virtNotReady = !scriptFailed && (virtSection?.status === 'not-installed');
    const dockerNotReady = !scriptFailed && dockerSection?.status === 'offline';
    // Bootstrap is done when the repo has been cloned (repoPath exists)
    const repoNotCloned = !scriptFailed && (!bootstrapSection || bootstrapSection.status === 'not-installed');
    const gatewayDown = !scriptFailed && (!gatewaySection || gatewaySection.status === 'offline');
    const bootstrapProvisioning = bootstrapAssetsIncomplete && gatewayDown;

    const isNewInstall = dockerNotInstalled || ollamaNotInstalled || wsl2NotInstalled || virtNotReady || repoNotCloned || bootstrapProvisioning;
    const isServicesDown = !isNewInstall && (dockerNotReady || gatewayDown);

    // Step progression
    const prereqsDone = !dockerNotInstalled && !wsl2NotInstalled && !virtNotReady;
    const bootstrapDone = prereqsDone && !dockerNotReady && !repoNotCloned && !bootstrapAssetsIncomplete;
    const runningOk = bootstrapDone && !gatewayDown;
    const canLaunchOnboarding = runningOk;
    const setupSubtitle = bootstrapProvisioning
      ? 'Bootstrap is still provisioning the managed Docker images. Let it finish before starting services.'
      : 'Some required software is not installed or bootstrap has not completed yet. Follow these steps to get OpenClaw running.';

    const shouldShowAuthAction = (section: { title: string, content: string, status: 'online'|'offline'|'not-installed' }) =>
      !!authActionMap[section.title] && (section.status !== 'online' || section.content.includes('Run:'));

    return html`
      <header>
        <h2>${isNewInstall ? '👋 Welcome to OpenClaw' : 'System Health Dashboard'}</h2>
        <button class="btn btn-secondary" @click=${() => this.fetchStatus()}>↻ Refresh</button>
      </header>

      ${!this.statusLoaded ? html`
        <div class="card" style="color: #888;">⏳ Loading status...</div>
      ` : isNewInstall ? html`
        <div class="setup-guide">
          <h2>🚀 Let's get you set up</h2>
          <p class="subtitle">${setupSubtitle}</p>
          <div class="setup-steps">
            <div class="setup-step ${prereqsDone ? 'done' : 'active'}">
              <div class="step-num">1</div>
              <div class="step-body">
                <div class="step-title">Check & Install Prerequisites</div>
                <div class="step-desc">Audits your Windows setup and installs Docker Desktop, WSL2, and Ollama if needed.</div>
              </div>
              ${prereqsDone
                ? html`<span class="step-done-badge">✓ Done</span>`
                : html`<button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand('prereqs')}>Install Prerequisites</button>`}
            </div>
            <div class="setup-step ${bootstrapDone ? 'done' : prereqsDone ? 'active' : ''}">
              <div class="step-num">2</div>
              <div class="step-body">
                <div class="step-title">Bootstrap OpenClaw</div>
                <div class="step-desc">Clones the OpenClaw repo as a sibling directory, builds Docker images, configures agents, and applies all hardening.</div>
              </div>
              ${bootstrapDone
                ? html`<span class="step-done-badge">✓ Done</span>`
                : html`<button class="btn btn-primary" ?disabled=${this.isRunning || !prereqsDone} @click=${() => this.runCommand('bootstrap')}>Run Bootstrap</button>`}
            </div>
            <div class="setup-step ${runningOk ? 'done' : bootstrapDone ? 'active' : ''}">
              <div class="step-num">3</div>
              <div class="step-body">
                <div class="step-title">Start Services</div>
                <div class="step-desc">Starts all services and OpenClaw.</div>
              </div>
              ${runningOk
                ? html`<span class="step-done-badge">✓ Running</span>`
                : html`<button class="btn btn-primary" ?disabled=${this.isRunning || !bootstrapDone} @click=${() => this.runCommand('start')}>Start</button>`}
            </div>
          </div>
        </div>
      ` : isServicesDown ? html`
        <div class="setup-guide" style="border-color: #ff9800;">
          <h2>⚠️ Services are stopped</h2>
          <p class="subtitle">Prerequisites look good but the gateway or Docker isn't running.</p>
          <div style="display: flex; gap: 12px; flex-wrap: wrap;">
            <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand('start')}>▶ Start Services</button>
            <button class="btn btn-secondary" ?disabled=${this.isRunning} @click=${() => this.runCommand('verify')}>Run Verify</button>
          </div>
        </div>
      ` : ''}

      ${canLaunchOnboarding ? html`
        <div class="card" style="border-color: #00bcd4;">
          <div class="card-header">
            <h3>Interactive onboarding</h3>
          </div>
          <p style="color: #888; margin-bottom: 16px;">OpenClaw onboarding asks questions and needs a real interactive terminal, so the toolkit launches it in a separate PowerShell window instead of the dashboard log pane.</p>
          <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand('onboard')}>Launch Onboarding</button>
        </div>
      ` : ''}

      ${sections.length > 0 ? html`
          <div class="status-grid">
              ${sections.map(s => html`
                  <div class="status-card">
                      <div class="status-card-header">
                           <h4>${s.title}</h4>
                           <div style="display: flex; align-items: center; gap: 12px;">
                                ${shouldShowAuthAction(s) ? html`
                                    <button class="btn btn-ghost" style="padding: 4px 8px; font-size: 0.7rem;"
                                            ?disabled=${this.isRunning}
                                            @click=${() => this.runCommand(authActionMap[s.title])}>
                                        ${authActionLabelMap[s.title] ?? 'Authenticate'}
                                    </button>
                                ` : ''}
                               ${rebootMap[s.title] && s.status !== 'not-installed'
                                  && !(s.title === 'Gateway' && (dockerNotInstalled || dockerNotReady))
                                  && !(s.title === 'Docker' && dockerNotInstalled) ? html`
                                   <button class="btn btn-ghost" style="padding: 4px 8px; font-size: 0.7rem;" 
                                           ?disabled=${this.isRunning}
                                           @click=${() => this.rebootService(rebootMap[s.title])}>
                                       Restart
                                   </button>
                               ` : ''}
                               ${s.title === 'Telegram' ? html`
                                   <button class="btn btn-ghost" style="padding: 4px 8px; font-size: 0.7rem;"
                                           ?disabled=${this.isRunning}
                                            @click=${() => this.runCommand('telegram-setup')}>
                                       Setup
                                   </button>
                                    <button class="btn btn-ghost" style="padding: 4px 8px; font-size: 0.7rem;"
                                            ?disabled=${this.isRunning}
                                            @click=${() => this.runCommand('telegram-ids')}>
                                        Seen IDs
                                    </button>
                               ` : ''}
                               <span class="status-indicator ${
                                 s.status === 'online' ? 'status-online' :
                                 s.status === 'not-installed' ? 'status-not-installed' :
                                'status-offline'
                              }"></span>
                          </div>
                      </div>
                      <div class="status-content">${s.content}</div>
                  </div>
              `)}
          </div>
      ` : !isNewInstall && !isServicesDown && this.statusOutput ? html`
          <div class="card">
            <p style="color: #888; margin-bottom: 15px;">Gathering live data from Docker and local gateway...</p>
            <div class="log-container" style="height: auto; max-height: 400px; background: #0f0f0f;">
                ${this.statusOutput}
            </div>
          </div>
      ` : ''}
    `;
  }

  renderTopology() {
    if (!this.config) return html`<p>Loading topology...</p>`;

    const slots = this.getTopologySlots().map((slot: any) => {
      const columnCount = slot.agents.length >= 4 ? 2 : 1;
      const cardMinWidth = 304;
      const columnGap = this.getTopologySlotColumnGap(slot, columnCount);
      const innerPadding = 32;
      const slotWidth = innerPadding + (columnCount * cardMinWidth) + ((columnCount - 1) * columnGap);
      return {
        ...slot,
        columnCount,
        columnGap,
        slotWidth
      };
    });
    const slotGap = 28;
    const estimatedBoardWidth = slots.reduce((total: number, slot: any, index: number) => total + slot.slotWidth + (index > 0 ? slotGap : 0), 0);
    const boardHeight = this.topologyBoardHeight || 560;
    const previewSourceAgentId = this.getTopologyPreviewSourceAgentId();
    const visibleEdges = this.getVisibleTopologyEdges();
    const orderedVisibleEdges = [...visibleEdges].sort((left: any, right: any) => {
      const leftHovered = this.topologyHoverEdgeKey === left.key ? 1 : 0;
      const rightHovered = this.topologyHoverEdgeKey === right.key ? 1 : 0;
      return leftHovered - rightHovered;
    });

    return html`
      <header>
        <h2>Agent Topology Workbench</h2>
        <div style="display: flex; gap: 10px;">
          ${this.topologyLinkSourceAgentId ? html`
            <button class="btn btn-secondary" @click=${() => { this.topologyLinkSourceAgentId = null; this.clearTopologyNotice(); }}>Cancel Delegation Wiring</button>
          ` : ''}
          <button class="btn btn-secondary" @click=${() => this.activeTab = 'config'}>Open Full Configuration</button>
        </div>
      </header>

      <div class="topology-shell">
        <div class="card">
          <div class="topology-toolbar">
            <div>
              <div style="color: #fff; font-weight: 600; margin-bottom: 6px;">Drag agents onto endpoint workbenches</div>
              <div class="topology-help">
                Drag a pawn onto a computer/workbench to change its <strong>endpoint assignment</strong>. Click <strong>Delegation</strong> on an agent, then click another agent to add or remove a dotted delegation arrow.
              </div>
            </div>
            <div class="topology-toolbar-controls">
              <label class="toggle-switch topology-legend-item" title="When off, arrows only appear while hovering a delegator card.">
                <input type="checkbox" ?checked=${this.topologyShowAllArrows} @change=${(event: Event) => {
                  const target = event.target as HTMLInputElement;
                  this.topologyShowAllArrows = !!target.checked;
                }}>
                <span>${this.topologyShowAllArrows ? 'Showing all arrows' : 'Hover to preview arrows'}</span>
              </label>
              <div class="topology-legend">
                <span class="topology-legend-item">💻 endpoint workbench</span>
                <span class="topology-legend-item">👑 main agent</span>
                <span class="topology-legend-item">⬈ dotted arrow = delegates to</span>
                <span class="topology-legend-item">♻ cycles blocked</span>
                <span class="topology-legend-item">${this.topologyEdges.length} delegation link${this.topologyEdges.length === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
          <div class="topology-help" style="margin-top: 14px;">
            The visual board edits the same config used elsewhere: <strong>endpoints[].agents</strong> for placement and <strong>subagents.allowAgents</strong> for delegation.
          </div>
          ${!this.topologyShowAllArrows ? html`
            <div class="topology-help" style="margin-top: 10px;">
              Hover an agent card with delegates to preview only that agent's outgoing delegation arrows.
            </div>
          ` : ''}
        </div>

        ${this.topologyNotice ? html`
          <div class="topology-notice"><strong>Workbench:</strong> ${this.topologyNotice}</div>
        ` : ''}

        <div class="card">
          <div class="topology-scroll">
            <div class="topology-board" style="min-width: ${Math.max(estimatedBoardWidth, 960)}px; min-height: ${boardHeight}px;">
              <div class="topology-columns">
              ${slots.map((slot: any) => {
                const isDropTarget = this.topologyHoverEndpointKey === slot.key;
                return html`
                  <section
                    class="topology-slot ${isDropTarget ? 'drop-target' : ''}"
                    style="width: ${slot.slotWidth}px;"
                    @dragover=${(event: DragEvent) => {
                      event.preventDefault();
                      this.topologyHoverEndpointKey = slot.key;
                    }}
                    @dragleave=${() => {
                      if (this.topologyHoverEndpointKey === slot.key) {
                        this.topologyHoverEndpointKey = null;
                      }
                    }}
                    @drop=${(event: DragEvent) => {
                      event.preventDefault();
                      this.handleTopologyDrop(slot.endpointKey);
                    }}>
                    <div class="topology-slot-header">
                      <div class="topology-slot-title">
                        <span class="topology-slot-icon">${slot.icon}</span>
                        <div class="topology-slot-heading">
                          <strong>${slot.title}</strong>
                          <span>${slot.subtitle}</span>
                        </div>
                      </div>
                      <span class="topology-slot-badge">${slot.agents.length} agent${slot.agents.length === 1 ? '' : 's'}</span>
                    </div>
                    <div class="topology-slot-body" style=${`grid-template-columns: repeat(${slot.columnCount}, minmax(0, 1fr)); column-gap: ${slot.columnGap}px;`}>
                      ${slot.agents.length === 0 ? html`
                        <div class="topology-slot-empty">
                          ${slot.endpointKey ? 'Drop an agent here to assign this endpoint.' : 'Agents without a resolved endpoint appear here.'}
                        </div>
                      ` : ''}
                      ${slot.agents.map((entry: any, index: number) => {
                        const delegateCount = this.getAgentDelegationTargets(entry.agent).length;
                        const isLinkSource = this.topologyLinkSourceAgentId === entry.id;
                        const isHoverPreview = !this.topologyShowAllArrows && !isLinkSource && previewSourceAgentId === entry.id && delegateCount > 0;
                        const hasSubagentsDisabled = entry.agent?.subagents?.enabled === false;
                        const columnIndex = slot.columnCount > 1 ? (index % slot.columnCount) : 0;
                        return html`
                          <div
                            class="topology-agent ${entry.enabled ? '' : 'disabled'} ${entry.isMain ? 'main-agent' : ''} ${isLinkSource ? 'link-source' : ''} ${isHoverPreview ? 'topology-hover-preview' : ''} ${this.topologyDraggedAgentKey === entry.key ? 'dragging' : ''}"
                            data-topology-agent-id=${entry.id}
                            data-topology-slot-key=${slot.key}
                            data-topology-column=${String(columnIndex)}
                            draggable="true"
                            @mouseenter=${() => { this.topologyHoverAgentId = entry.id; }}
                            @mouseleave=${() => {
                              if (this.topologyHoverAgentId === entry.id) {
                                this.topologyHoverAgentId = null;
                              }
                            }}
                            @dragstart=${(event: DragEvent) => {
                              this.startTopologyDrag(entry.key);
                              event.dataTransfer?.setData('text/plain', entry.key);
                              if (event.dataTransfer) {
                                event.dataTransfer.effectAllowed = 'move';
                              }
                            }}
                            @dragend=${() => this.endTopologyDrag()}
                            @click=${() => this.handleTopologyAgentClick(entry.id)}>
                            <div class="topology-agent-header">
                              <div class="topology-agent-title">
                                <span class="topology-agent-avatar">${entry.isMain ? '👑' : '🧍'}</span>
                                <div style="min-width: 0;">
                                  <strong>${entry.name}</strong>
                                  <div style="color: #777; font-size: 0.72rem;">${entry.id}</div>
                                </div>
                              </div>
                              ${entry.isMain ? html`<span class="topology-agent-main">👑</span>` : ''}
                            </div>

                            <div class="topology-agent-badges">
                              ${entry.isMain ? html`<span class="topology-pill main">Main</span>` : ''}
                              ${!entry.enabled ? html`<span class="topology-pill disabled">Disabled</span>` : ''}
                              <span class="topology-pill ${entry.workspaceMode === 'shared' ? 'shared' : 'private'}">${entry.workspaceMode}</span>
                              <span class="topology-pill ${entry.modelSource === 'local' ? 'local' : 'hosted'}">${entry.modelSource}</span>
                              <span class="topology-pill">${delegateCount} delegate${delegateCount === 1 ? '' : 's'}</span>
                              ${hasSubagentsDisabled ? html`<span class="topology-pill disabled">delegation off</span>` : ''}
                            </div>

                            <div class="topology-agent-meta">
                              AGENTS.md: ${this.getMarkdownTemplateSelection(entry.agent, 'AGENTS.md', VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES) || 'custom'}<br>
                              Model: ${entry.agent.modelRef || 'unassigned'}
                            </div>

                            <div class="topology-agent-actions">
                              <button class="btn btn-ghost" @click=${(event: Event) => {
                                event.stopPropagation();
                                this.selectTopologyDelegationSource(entry.id);
                              }}>
                                ${isLinkSource ? 'Cancel' : 'Delegation'}
                              </button>
                              <button class="btn btn-ghost" @click=${(event: Event) => {
                                event.stopPropagation();
                                this.openTopologyAgentEditor(entry.key);
                              }}>
                                Details
                              </button>
                            </div>

                            ${this.topologyLinkSourceAgentId && this.topologyLinkSourceAgentId !== entry.id ? html`
                              <div class="topology-card-link-hint">
                                ${this.hasDelegationEdge(this.topologyLinkSourceAgentId, entry.id)
                                  ? 'Click to remove delegation'
                                  : 'Click to delegate here'}
                              </div>
                            ` : ''}
                          </div>
                        `;
                      })}
                    </div>
                  </section>
                `;
              })}
              </div>
              <div class="topology-edge-overlay" aria-hidden="true">
                ${orderedVisibleEdges.flatMap((edge: any) => {
                  const edgeColor = this.getTopologyEdgeColor(edge);
                  return (Array.isArray(edge.renderSegments) ? edge.renderSegments : []).map((segment: any) => html`
                  <div
                    class="topology-edge-hit ${segment.orientation}"
                    style=${segment.orientation === 'h'
                      ? `left:${segment.left}px; top:${segment.top - 5}px; width:${segment.width}px; height:${segment.height + 10}px;`
                      : `left:${segment.left - 5}px; top:${segment.top}px; width:${segment.width + 10}px; height:${segment.height}px;`}
                    @mouseenter=${() => { this.topologyHoverEdgeKey = edge.key; }}
                    @mouseleave=${() => {
                      if (this.topologyHoverEdgeKey === edge.key) {
                        this.topologyHoverEdgeKey = null;
                      }
                    }}>
                  </div>
                  <div
                    class="topology-edge-segment ${segment.orientation}"
                    style=${`left:${segment.left}px; top:${segment.top}px; width:${segment.width}px; height:${segment.height}px; --edge-color:${edgeColor};`}>
                  </div>
                `);
                })}
                ${orderedVisibleEdges.map((edge: any) => {
                  if (!edge.arrowHead) {
                    return '';
                  }
                  const edgeColor = this.getTopologyEdgeColor(edge);
                  return html`
                  <div
                    class="topology-edge-arrowhead-hit"
                    style=${`left:${edge.arrowHead.x}px; top:${edge.arrowHead.y}px; transform: translate(-50%, -50%) rotate(${edge.arrowHead.rotation}deg);`}
                    @mouseenter=${() => { this.topologyHoverEdgeKey = edge.key; }}
                    @mouseleave=${() => {
                      if (this.topologyHoverEdgeKey === edge.key) {
                        this.topologyHoverEdgeKey = null;
                      }
                    }}>
                  </div>
                  <div
                    class="topology-edge-arrowhead"
                    style=${`left:${edge.arrowHead.x}px; top:${edge.arrowHead.y}px; --edge-color:${edgeColor}; transform: translate(-50%, -50%) rotate(${edge.arrowHead.rotation}deg);`}>
                  </div>
                `;
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderLogs() {
    return html`
      <header>
        <h2>Process Output</h2>
        ${this.isRunning ? html`
          <button class="btn btn-danger" @click=${() => this.cancelCommand()}>⏹ Cancel</button>
        ` : ''}
      </header>
      <div class="log-container">
        ${this.logs.map(line => html`<div class="log-entry">${line}</div>`)}
      </div>
    `;
  }

  renderOps() {
    const ops = [
      { id: 'prereqs', name: 'Check Prerequisites', desc: 'Audit Windows, Docker, and WSL setup' },
      { id: 'bootstrap', name: 'Bootstrap', desc: 'Full installation/hardening' },
      { id: 'update', name: 'Update', desc: 'Update OpenClaw repo and rebuild' },
      { id: 'verify', name: 'Verify', desc: 'Run smoke tests and health checks' },
      { id: 'start', name: 'Start', desc: 'Start all services and OpenClaw' },
      { id: 'onboard', name: 'Interactive Onboarding', desc: 'Launch openclaw onboard in a separate PowerShell window so you can answer prompts and make onboarding choices' },
      { id: 'telegram-setup', name: 'Telegram Setup', desc: 'Launch the interactive Telegram channel setup wizard in a separate PowerShell window without storing any token in toolkit config' },
      { id: 'telegram-ids', name: 'Telegram Seen IDs', desc: 'Scan recent Telegram gateway logs for user and group IDs when you need values for allowlists or group routing' },
      { id: 'stop', name: 'Stop', desc: 'Stop all services and OpenClaw' },
      { id: 'cli', args: ['--version'], name: 'OpenClaw CLI Version', desc: 'Run openclaw --version inside the gateway container and stream the result' },
      { id: 'cli', args: ['doctor'], name: 'OpenClaw Doctor', desc: 'Run openclaw doctor inside the gateway container and stream config diagnostics' },
      { id: 'cli', args: ['gateway', 'status'], name: 'OpenClaw Gateway Status', desc: 'Run openclaw gateway status inside the gateway container and stream the result' },
      { id: 'toolkit-dashboard-rebuild', name: 'Rebuild Toolkit Dashboard', desc: 'Rebuild UI and restart the toolkit dashboard server. Page will auto-reconnect.' }
    ];

    return html`
      <header><h2>Available Operations</h2></header>
      <div class="grid-2">
        ${ops.map(op => html`
          <div class="card">
            <h3>${op.name}</h3>
            <p style="color: #888; font-size: 0.85rem; margin: 10px 0 20px;">${op.desc}</p>
            <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand(op.id, op.args ?? [])}>Run Action</button>
          </div>
        `)}
      </div>
    `;
  }

  renderConfig() {
    if (!this.config) return html`<p>Loading config...</p>`;

    return html`
      <header>
        <div style="display: flex; gap: 10px;">
          <div class="tab ${this.configSection === 'general' ? 'active' : ''}" @click=${() => this.configSection = 'general'}>General</div>
          <div class="tab ${this.configSection === 'sandbox' ? 'active' : ''}" @click=${() => this.configSection = 'sandbox'}>Sandbox</div>
          <div class="tab ${this.configSection === 'endpoints' ? 'active' : ''}" @click=${() => this.configSection = 'endpoints'}>Endpoints</div>
          <div class="tab ${this.configSection === 'models' ? 'active' : ''}" @click=${() => this.configSection = 'models'}>Models Catalog</div>
          <div class="tab ${this.configSection === 'markdownTemplates' ? 'active' : ''}" @click=${() => this.configSection = 'markdownTemplates'}>Template Markdowns</div>
          <div class="tab ${this.configSection === 'toolsets' ? 'active' : ''}" @click=${() => this.configSection = 'toolsets'}>Toolsets</div>
          <div class="tab ${this.configSection === 'agents' ? 'active' : ''}" @click=${() => this.configSection = 'agents'}>Agents</div>
          <div class="tab ${this.configSection === 'workspaces' ? 'active' : ''}" @click=${() => this.configSection = 'workspaces'}>Workspaces</div>
          <div class="tab ${this.configSection === 'features' ? 'active' : ''}" @click=${() => this.configSection = 'features'}>Features</div>
        </div>
        <div style="display: flex; gap: 10px;">
           <button class="btn btn-ghost" ?disabled=${this.hasConfigValidationErrors} @click=${this.saveConfig}>Save Only</button>
           <button class="btn btn-primary" ?disabled=${this.hasConfigValidationErrors} @click=${this.applyAndRestart}>Save & Apply (Restart Agents)</button>
        </div>
      </header>

      ${this.hasConfigValidationErrors ? html`
        <div class="card" style="border-color: #ff9800; margin-bottom: 20px;">
          <div class="help-text" style="color: #ff9800; margin: 0;">${this.getValidationErrors()[0]}</div>
        </div>
      ` : ''}

      ${this.renderConfigSection()}
    `;
  }

  renderConfigSection() {
    switch (this.configSection) {
      case 'general': return this.renderGeneralConfig();
      case 'sandbox': return this.renderSandboxConfig();
      case 'endpoints': return this.renderEndpointsConfig();
      case 'models': return this.renderModelsConfig();
      case 'markdownTemplates': return this.renderTemplateMarkdownsConfig();
      case 'toolsets': return this.renderToolsetsConfig();
      case 'agents': return this.renderAgentsConfig();
      case 'workspaces': return this.renderWorkspacesConfig();
      case 'features': return this.renderFeaturesConfig();
      default: return html``;
    }
  }

  renderGeneralConfig() {
    return html`
      <div class="card">
        <div class="card-header"><h3>Base Settings</h3></div>
        <div class="grid-2">
          <div class="form-group">
            <label>Gateway Port</label>
            <input type="number" .value=${this.config.gatewayPort} @input=${(e: any) => this.config.gatewayPort = parseInt(e.target.value)}>
          </div>
          <div class="form-group">
            <label>Gateway Bind</label>
            <select @change=${(e: any) => this.config.gatewayBind = e.target.value}>
              <option value="lan" ?selected=${this.config.gatewayBind === 'lan'}>LAN</option>
              <option value="localhost" ?selected=${this.config.gatewayBind === 'localhost'}>Localhost</option>
            </select>
          </div>
        </div>
        <div class="form-group">
            <label class="toggle-switch">
                <input type="checkbox" ?checked=${this.config.ollama.enabled} @change=${(e: any) => { this.config.ollama.enabled = e.target.checked; this.requestUpdate(); }}>
                Enable Ollama Local Models Support
            </label>
        </div>
        <div class="form-group">
            <label class="toggle-switch">
                <input type="checkbox" ?checked=${this.config.skills.enableAll} @change=${(e: any) => { this.config.skills.enableAll = e.target.checked; this.requestUpdate(); }}>
                Enable All Skills
            </label>
            <div class="help-text">Recommended. When off, bootstrap disables skills for the default agent and toolkit-managed agents.</div>
        </div>
        <div class="form-group">
          <label>Auto-Pull VRAM Budget (%)</label>
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            .value=${String(Math.round((typeof this.config.ollama.pullVramBudgetFraction === 'number' ? this.config.ollama.pullVramBudgetFraction : 0.7) * 100))}
            @input=${(e: any) => {
              const parsed = Number(e.target.value);
              const normalized = Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) / 100 : 0.7;
              this.config.ollama.pullVramBudgetFraction = normalized;
              this.requestUpdate();
            }}>
          <div class="help-text">Auto-pull rejects local models above this percentage of an endpoint's total GPU VRAM.</div>
        </div>
        <div class="form-group">
          <label>Model Fit VRAM Headroom (MiB)</label>
          <input
            type="number"
            min="0"
            step="128"
            .value=${String(Math.round(typeof this.config.ollama.vramHeadroomMiB === 'number' ? this.config.ollama.vramHeadroomMiB : 1536))}
            @input=${(e: any) => {
              const parsed = Number(e.target.value);
              const normalized = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 1536;
              this.config.ollama.vramHeadroomMiB = normalized;
              this.requestUpdate();
            }}>
          <div class="help-text">Reserve this much GPU VRAM when probing the largest safe local-model context window.</div>
        </div>
      </div>
    `;
  }

  renderSandboxConfig() {
    return html`
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h3>Sandbox Defaults</h3></div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${this.config.sandbox.enabled} @change=${(e: any) => { this.config.sandbox.enabled = e.target.checked; this.requestUpdate(); }}>
              Enable sandbox support
            </label>
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label>Mode</label>
              <select @change=${(e: any) => { this.config.sandbox.mode = e.target.value; this.requestUpdate(); }}>
                <option value="off" ?selected=${this.config.sandbox.mode === 'off'}>off</option>
                <option value="all" ?selected=${this.config.sandbox.mode === 'all'}>all</option>
                <option value="workspace-write" ?selected=${this.config.sandbox.mode === 'workspace-write'}>workspace-write</option>
              </select>
            </div>
            <div class="form-group">
              <label>Scope</label>
              <select @change=${(e: any) => { this.config.sandbox.scope = e.target.value; this.requestUpdate(); }}>
                <option value="session" ?selected=${this.config.sandbox.scope === 'session'}>session</option>
                <option value="task" ?selected=${this.config.sandbox.scope === 'task'}>task</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Workspace Access</label>
            <select @change=${(e: any) => { this.config.sandbox.workspaceAccess = e.target.value; this.requestUpdate(); }}>
              <option value="ro" ?selected=${this.config.sandbox.workspaceAccess === 'ro'}>read-only</option>
              <option value="rw" ?selected=${this.config.sandbox.workspaceAccess === 'rw'}>read-write</option>
            </select>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${this.config.sandbox.toolsFsWorkspaceOnly} @change=${(e: any) => { this.config.sandbox.toolsFsWorkspaceOnly = e.target.checked; this.requestUpdate(); }}>
              Limit filesystem tools to workspace only
            </label>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${this.config.sandbox.applyPatchWorkspaceOnly} @change=${(e: any) => { this.config.sandbox.applyPatchWorkspaceOnly = e.target.checked; this.requestUpdate(); }}>
              Limit apply_patch to workspace only
            </label>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Sandbox Images and Docker Socket</h3></div>
          <div class="form-group">
            <label>Docker Socket Source</label>
            <input type="text" .value=${this.config.sandbox.dockerSocketSource || ''} @input=${(e: any) => { this.config.sandbox.dockerSocketSource = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Docker Socket Target</label>
            <input type="text" .value=${this.config.sandbox.dockerSocketTarget || ''} @input=${(e: any) => { this.config.sandbox.dockerSocketTarget = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Docker Socket Group</label>
            <input type="text" .value=${this.config.sandbox.dockerSocketGroup || ''} @input=${(e: any) => { this.config.sandbox.dockerSocketGroup = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${this.config.sandbox.buildGatewayImageWithDockerCli} @change=${(e: any) => { this.config.sandbox.buildGatewayImageWithDockerCli = e.target.checked; this.requestUpdate(); }}>
              Build gateway image with Docker CLI
            </label>
          </div>
          <div class="form-group">
            <label>Gateway Image Tag</label>
            <input type="text" .value=${this.config.sandbox.gatewayImageTag || ''} @input=${(e: any) => { this.config.sandbox.gatewayImageTag = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Sandbox Base Image</label>
            <input type="text" .value=${this.config.sandbox.sandboxBaseImage || ''} @input=${(e: any) => { this.config.sandbox.sandboxBaseImage = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Sandbox Image</label>
            <input type="text" .value=${this.config.sandbox.sandboxImage || ''} @input=${(e: any) => { this.config.sandbox.sandboxImage = e.target.value; this.requestUpdate(); }}>
          </div>
        </div>
      </div>
    `;
  }

  getConfigEndpoints() {
    return this.getConfigEndpointsFrom(this.config);
  }

  getSortedConfigEndpoints() {
    return [...this.getConfigEndpoints()].sort((left: any, right: any) => {
      const leftDefault = left?.default ? 0 : 1;
      const rightDefault = right?.default ? 0 : 1;
      if (leftDefault !== rightDefault) {
        return leftDefault - rightDefault;
      }
      return String(left?.name || left?.key || '').localeCompare(String(right?.name || right?.key || ''));
    });
  }

  getDefaultEndpoint() {
    const endpoints = this.getSortedConfigEndpoints();
    return endpoints.find((endpoint: any) => !!endpoint?.default) || endpoints[0] || null;
  }

  canRemoveEndpoint(endpoint: any) {
    return !endpoint?.default;
  }

  getEndpointsForModelRef(modelRef: string | undefined) {
    if (typeof modelRef !== 'string' || modelRef.length === 0) {
      return [];
    }

    return this.getConfigEndpoints().filter((endpoint: any) =>
      this.getEndpointModelOptions(endpoint).some((option: any) => option.ref === modelRef)
    );
  }

  resolveAgentEndpoint(agent: any) {
    const agentId = String(agent?.id || '').trim();
    if (!agentId) {
      return null;
    }

    for (const endpoint of this.getConfigEndpoints()) {
      if (this.getEndpointAgentIds(endpoint).includes(agentId)) {
        return endpoint;
      }
    }

    return null;
  }

  getEndpointOllama(endpoint: any) {
    if (endpoint?.ollama && typeof endpoint.ollama === 'object') {
      return endpoint.ollama;
    }
    if (endpoint && (endpoint.baseUrl || endpoint.hostBaseUrl || endpoint.providerId || Array.isArray(endpoint.models))) {
      return endpoint;
    }
    return null;
  }

  ensureEndpointOllama(endpoint: any) {
    let runtime = this.getEndpointOllama(endpoint);
    if (runtime && runtime !== endpoint) {
      return runtime;
    }
    if (runtime === endpoint) {
      return endpoint;
    }

    const suffix = String(endpoint?.key || 'local').replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'local';
    endpoint.ollama = {
      enabled: true,
      providerId: suffix === 'local' ? 'ollama' : `ollama-${suffix}`,
      hostBaseUrl: 'http://127.0.0.1:11434',
      baseUrl: 'http://host.docker.internal:11434',
      apiKey: suffix === 'local' ? 'ollama-local' : `ollama-${suffix}`,
      autoPullMissingModels: true,
      models: []
    };
    return endpoint.ollama;
  }

  getEndpointModels(endpoint: any) {
    const runtime = this.getEndpointOllama(endpoint);
    if (Array.isArray(runtime?.models)) {
      return runtime.models;
    }
    return [];
  }

  sanitizeModelEntries(models: any[] | undefined) {
    if (!Array.isArray(models)) return [];
    return models.map((model: any) => {
      const clone = JSON.parse(JSON.stringify(model));
      delete clone.name;
      this.setOrderedFallbackModelIds(clone, this.getOrderedFallbackModelIds(clone));
      return clone;
    });
  }

  sanitizeSharedCatalogEntries(models: any[] | undefined) {
    return this.sanitizeModelEntries(models).map((model: any) => {
      delete model.fallbackModelIds;
      return model;
    });
  }

  getOrderedFallbackModelIds(model: any) {
    const fallbackIds: string[] = [];
    if (Array.isArray(model?.fallbackModelIds)) {
      for (const rawFallbackId of model.fallbackModelIds) {
        const fallbackId = String(rawFallbackId || '').trim();
        if (fallbackId && !fallbackIds.includes(fallbackId)) {
          fallbackIds.push(fallbackId);
        }
      }
    }
    return fallbackIds;
  }

  setOrderedFallbackModelIds(model: any, fallbackIds: string[]) {
    const normalized: string[] = [];
    const selfId = typeof model?.id === 'string' ? model.id.trim() : '';
    for (const rawFallbackId of Array.isArray(fallbackIds) ? fallbackIds : []) {
      const fallbackId = String(rawFallbackId || '').trim();
      if (!fallbackId || fallbackId === selfId || normalized.includes(fallbackId)) {
        continue;
      }
      normalized.push(fallbackId);
    }

    if (normalized.length > 0) {
      model.fallbackModelIds = normalized;
    } else {
      delete model.fallbackModelIds;
    }
    for (const key of Object.keys(model || {})) {
      if (key.startsWith('fallbackModel') && key !== 'fallbackModelIds') {
        delete model[key];
      }
    }
  }

  describeOrderedLocalFallbacks(model: any) {
    const fallbackIds = this.getOrderedFallbackModelIds(model);
    if (fallbackIds.length === 0) {
      return 'No local fallbacks';
    }
    return `Fallback order: ${fallbackIds.map((fallbackId: string) => `ollama/${fallbackId}`).join(' -> ')}`;
  }

  renderOrderedLocalFallbackEditor(model: any, availableModelIds: string[]) {
    const fallbackIds = this.getOrderedFallbackModelIds(model);
    const availableFallbackIds = availableModelIds.filter((fallbackId: string) => fallbackId !== String(model?.id || '') && !fallbackIds.includes(fallbackId));
    return html`
      <div class="form-group fallback-editor">
        <label>Ordered Local Fallbacks</label>
        <div class="help-text" style="margin-top: 0;">OpenClaw tries fallbacks top-to-bottom. The toolkit also uses this order when it needs to step down to a smaller local model.</div>
        ${fallbackIds.length > 0 ? html`
          <div class="fallback-list">
            ${fallbackIds.map((fallbackId: string, index: number) => html`
              <div class="fallback-row">
                <span class="fallback-label">${index + 1}. ollama/${fallbackId}</span>
                <span class="fallback-actions">
                  <button class="btn btn-ghost" style="padding: 4px 8px;" ?disabled=${index === 0} @click=${() => {
                    const nextFallbackIds = [...fallbackIds];
                    [nextFallbackIds[index - 1], nextFallbackIds[index]] = [nextFallbackIds[index], nextFallbackIds[index - 1]];
                    this.setOrderedFallbackModelIds(model, nextFallbackIds);
                    this.requestUpdate();
                  }}>Up</button>
                  <button class="btn btn-ghost" style="padding: 4px 8px;" ?disabled=${index === fallbackIds.length - 1} @click=${() => {
                    const nextFallbackIds = [...fallbackIds];
                    [nextFallbackIds[index], nextFallbackIds[index + 1]] = [nextFallbackIds[index + 1], nextFallbackIds[index]];
                    this.setOrderedFallbackModelIds(model, nextFallbackIds);
                    this.requestUpdate();
                  }}>Down</button>
                  <button class="btn btn-danger" style="padding: 4px 8px;" @click=${() => {
                    this.setOrderedFallbackModelIds(model, fallbackIds.filter((_: string, candidateIndex: number) => candidateIndex !== index));
                    this.requestUpdate();
                  }}>Remove</button>
                </span>
              </div>
            `)}
          </div>
        ` : html`<div class="item-sub" style="margin-top: 10px;">No local fallbacks configured.</div>`}
        ${availableFallbackIds.length > 0 ? html`
          <select class="fallback-select" @change=${(e: any) => {
            const value = String(e.target.value || '').trim();
            if (value) {
              this.setOrderedFallbackModelIds(model, [...fallbackIds, value]);
              this.requestUpdate();
            }
            e.target.value = '';
          }}>
            <option value="">+ Add fallback at the end</option>
            ${availableFallbackIds.map((fallbackId: string) => html`<option value=${fallbackId}>${fallbackId}</option>`)}
          </select>
        ` : ''}
      </div>
    `;
  }

  getLegacyManagedAgentKeys() {
    return [
      'strongAgent',
      'researchAgent',
      'localChatAgent',
      'hostedTelegramAgent',
      'localReviewAgent',
      'localCoderAgent',
      'remoteReviewAgent',
      'remoteCoderAgent'
    ];
  }

  inferModelSourceFromAgent(agent: any) {
    const refs: string[] = [];
    if (typeof agent?.modelRef === 'string' && agent.modelRef.length > 0) {
      refs.push(agent.modelRef);
    }
    if (Array.isArray(agent?.candidateModelRefs)) {
      for (const ref of agent.candidateModelRefs) {
        if (typeof ref === 'string' && ref.length > 0 && !refs.includes(ref)) {
          refs.push(ref);
        }
      }
    }
    for (const ref of refs) {
      if (ref.startsWith('ollama/')) {
        return 'local';
      }
    }
    for (const ref of refs) {
      if (ref.includes('/')) {
        return 'hosted';
      }
    }
    return 'hosted';
  }

  sanitizeAgentRecord(agent: any, key?: string) {
    const clone = JSON.parse(JSON.stringify(agent || {}));
    if (key) clone.key = key;
    delete clone.modelSource;
    clone.enabled = this.normalizeBoolean(clone.enabled, true);
    delete clone.endpointKey;
    clone.markdownTemplateKeys = this.normalizeMarkdownTemplateSelections(clone, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
    delete clone.rolePolicyKey;
    clone.toolsetKeys = this.ensureAgentToolsetKeys(clone);
    const normalizedToolOverrides = this.normalizeAgentToolOverrides(clone);
    if (normalizedToolOverrides) {
      clone.toolOverrides = normalizedToolOverrides;
    } else {
      delete clone.toolOverrides;
    }
    if (!Array.isArray(clone.candidateModelRefs)) {
      clone.candidateModelRefs = [];
    }
    clone.subagents = this.ensureSubagentsConfig(clone);
    if (typeof clone.modelRef !== 'string') {
      clone.modelRef = '';
    }
    clone.modelSource = this.inferModelSourceFromAgent(clone);
    return clone;
  }

  buildPersistedConfig(config: any) {
    const clone = JSON.parse(JSON.stringify(config));
    const defaultTelegramAccountId = (clone.telegram?.defaultAccount && String(clone.telegram.defaultAccount).trim()) || 'default';
    clone.agents = clone.agents || { telegramRouting: {}, list: [] };
    clone.agents.telegramRouting = clone.agents.telegramRouting || {};
    clone.agents.telegramRouting.routes = this.normalizeTelegramRouteList(
      Array.isArray(clone.agents.telegramRouting.routes) ? clone.agents.telegramRouting.routes : [],
      defaultTelegramAccountId
    );
    clone.workspaces = Array.isArray(clone.workspaces) ? clone.workspaces.map((workspace: any) => this.normalizeWorkspaceRecord(workspace)) : [];
    this.ensureToolsetsConfig(clone);
    const normalizedEndpoints = this.getConfigEndpointsFrom(clone).map((endpoint: any) => this.normalizeEndpointRecord(endpoint));
    if (Array.isArray(clone.endpoints)) {
      clone.endpoints = normalizedEndpoints;
    }
    this.normalizeEndpointAgentAssignments(clone);
    this.normalizeWorkspaceAssignments(clone);
    if (Array.isArray(clone.agents?.list)) {
      clone.agents.list = clone.agents.list.map((agent: any) => {
        const normalized = this.sanitizeAgentRecord(agent, agent?.key);
        delete normalized.modelSource;
        delete normalized.workspaceMode;
        delete normalized.workspace;
        delete normalized.sharedWorkspaceAccess;
        delete normalized.rolePolicyKey;
        return normalized;
      });
    }
    clone.toolsets.list = this.getToolsetsList(clone).map((toolset: any) => this.createToolsetRecord(toolset));
    delete clone.toolPolicy;
    if (clone.telegram && typeof clone.telegram === 'object') {
      delete clone.telegram.botToken;
      delete clone.telegram.tokenFile;
      clone.telegram.defaultAccount = (typeof clone.telegram.defaultAccount === 'string' && clone.telegram.defaultAccount.trim())
        ? clone.telegram.defaultAccount.trim()
        : 'default';
      clone.telegram.accounts = Array.isArray(clone.telegram.accounts)
        ? clone.telegram.accounts.map((account: any) => {
            const normalized = this.normalizeTelegramAccountRecord(account);
            delete normalized.botToken;
            delete normalized.tokenFile;
            return normalized;
          }).filter((account: any) => typeof account.id === 'string' && account.id.trim().length > 0)
        : [];
    }
    for (const workspace of Array.isArray(clone.workspaces) ? clone.workspaces : []) {
      delete workspace.allowSharedWorkspaceAccess;
    }
    return clone;
  }

  sanitizeConfigModelNames(config: any) {
    const clone = JSON.parse(JSON.stringify(config));
    if (!clone) return clone;
    const defaultTelegramAccountId = (clone.telegram?.defaultAccount && String(clone.telegram.defaultAccount).trim()) || 'default';
    if (!clone.agents || typeof clone.agents !== 'object') {
      clone.agents = { telegramRouting: {}, list: [] };
    }
    clone.agents.telegramRouting = clone.agents.telegramRouting || {};
    clone.agents.telegramRouting.routes = this.normalizeTelegramRouteList(
      Array.isArray(clone.agents.telegramRouting.routes) ? clone.agents.telegramRouting.routes : [],
      defaultTelegramAccountId
    );
    if (!Array.isArray(clone.agents.list)) {
      clone.agents.list = [];
    }
    if (!Array.isArray(clone.workspaces)) {
      clone.workspaces = [];
    }
    this.ensureToolsetsConfig(clone);
    const normalizedEndpoints = this.getConfigEndpointsFrom(clone).map((endpoint: any) => this.normalizeEndpointRecord(endpoint));
    if (Array.isArray(clone.endpoints)) {
      clone.endpoints = normalizedEndpoints;
    }
    this.normalizeEndpointAgentAssignments(clone);
    clone.workspaces = clone.workspaces.map((workspace: any) => this.normalizeWorkspaceRecord(workspace));
    this.normalizeWorkspaceAssignments(clone);
    clone.agents.list = clone.agents.list.map((agent: any) => {
      const normalized = this.sanitizeAgentRecord(agent, agent?.key);
      delete normalized.workspaceMode;
      delete normalized.workspace;
      delete normalized.sharedWorkspaceAccess;
      return normalized;
    });
    clone.toolsets.list = this.getToolsetsList(clone).map((toolset: any) => this.createToolsetRecord(toolset));
    delete clone.toolPolicy;
    if (!clone.ollama) clone.ollama = {};
    if (!clone.skills || typeof clone.skills !== 'object') clone.skills = {};
    if (!clone.voiceNotes || typeof clone.voiceNotes !== 'object') clone.voiceNotes = {};
    if (typeof clone.skills.enableAll !== 'boolean') {
      clone.skills.enableAll = clone.skills.enableAll === false || clone.skills.enableAll === 'false' ? false : true;
    }
    if (typeof clone.voiceNotes.enabled !== 'boolean') {
      clone.voiceNotes.enabled = clone.voiceNotes.enabled === false || clone.voiceNotes.enabled === 'false' ? false : true;
    }
    if (typeof clone.voiceNotes.mode !== 'string' || !clone.voiceNotes.mode.trim()) {
      clone.voiceNotes.mode = 'local-whisper';
    }
    if (typeof clone.voiceNotes.gatewayImageTag !== 'string' || !clone.voiceNotes.gatewayImageTag.trim()) {
      clone.voiceNotes.gatewayImageTag = 'openclaw:local-voice';
    }
    if (typeof clone.voiceNotes.whisperModel !== 'string' || !clone.voiceNotes.whisperModel.trim()) {
      clone.voiceNotes.whisperModel = 'base';
    }
    if (clone.telegram && typeof clone.telegram === 'object') {
      delete clone.telegram.botToken;
      delete clone.telegram.tokenFile;
      clone.telegram.enabled = this.normalizeBoolean(clone.telegram.enabled, true);
      clone.telegram.defaultAccount = (typeof clone.telegram.defaultAccount === 'string' && clone.telegram.defaultAccount.trim())
        ? clone.telegram.defaultAccount.trim()
        : 'default';
      if (Array.isArray(clone.telegram.groups)) {
        clone.telegram.groups = clone.telegram.groups.map((group: any) => this.normalizeTelegramGroupRecord(group));
      } else {
        clone.telegram.groups = [];
      }
      if (Array.isArray(clone.telegram.accounts)) {
        clone.telegram.accounts = clone.telegram.accounts.map((account: any) => {
          const normalized = this.normalizeTelegramAccountRecord(account);
          delete normalized.botToken;
          delete normalized.tokenFile;
          return normalized;
        }).filter((account: any) => typeof account.id === 'string' && account.id.trim().length > 0);
      } else {
        clone.telegram.accounts = [];
      }
      if (clone.telegram.execApprovals && typeof clone.telegram.execApprovals === 'object') {
        clone.telegram.execApprovals = this.normalizeTelegramExecApprovalsRecord(clone.telegram.execApprovals);
      }
    }
    if (typeof clone.ollama.pullVramBudgetFraction !== 'number' || !Number.isFinite(clone.ollama.pullVramBudgetFraction) || clone.ollama.pullVramBudgetFraction <= 0 || clone.ollama.pullVramBudgetFraction > 1) {
      const parsedBudget = Number(clone.ollama.pullVramBudgetFraction);
      clone.ollama.pullVramBudgetFraction = Number.isFinite(parsedBudget) && parsedBudget > 0 && parsedBudget <= 1 ? parsedBudget : 0.7;
    }
    if (typeof clone.ollama.vramHeadroomMiB !== 'number' || !Number.isFinite(clone.ollama.vramHeadroomMiB) || clone.ollama.vramHeadroomMiB < 0) {
      const parsedHeadroom = Number(clone.ollama.vramHeadroomMiB);
      clone.ollama.vramHeadroomMiB = Number.isFinite(parsedHeadroom) && parsedHeadroom >= 0 ? Math.round(parsedHeadroom) : 1536;
    }

    const normalizeEndpoint = (endpoint: any) => {
      const normalized: any = {
        key: endpoint?.key || 'local',
        default: this.normalizeBoolean(endpoint?.default, false)
      };

      if (endpoint?.name) normalized.name = endpoint.name;
      if (endpoint?.telemetry) normalized.telemetry = endpoint.telemetry;
      normalized.agents = this.getEndpointAgentIds(endpoint);
      if (Array.isArray(endpoint?.hostedModels)) {
        normalized.hostedModels = this.sanitizeModelEntries(endpoint.hostedModels);
      }

      const rawRuntime = endpoint?.ollama || endpoint;
      const hasRuntime = !!endpoint?.ollama ||
        !!endpoint?.baseUrl ||
        !!endpoint?.hostBaseUrl ||
        !!endpoint?.providerId ||
        Array.isArray(endpoint?.models);

      if (hasRuntime) {
        const runtime: any = {};
        runtime.enabled = this.normalizeBoolean(rawRuntime?.enabled, true);
        if (rawRuntime?.providerId) runtime.providerId = rawRuntime.providerId;
        if (rawRuntime?.baseUrl) runtime.baseUrl = rawRuntime.baseUrl;
        if (rawRuntime?.hostBaseUrl) runtime.hostBaseUrl = rawRuntime.hostBaseUrl;
        if (rawRuntime?.apiKey) runtime.apiKey = rawRuntime.apiKey;
        runtime.autoPullMissingModels = this.normalizeBoolean(rawRuntime?.autoPullMissingModels, true);
        if (Array.isArray(rawRuntime?.models)) {
          runtime.models = this.sanitizeModelEntries(rawRuntime.models);
        }
        normalized.ollama = runtime;
      }

      return normalized;
    };

    if (Array.isArray(clone.modelCatalog)) {
      clone.modelCatalog = this.sanitizeSharedCatalogEntries(clone.modelCatalog);
    } else if (Array.isArray(clone.ollama.models)) {
      clone.modelCatalog = this.sanitizeSharedCatalogEntries(clone.ollama.models);
      delete clone.ollama.models;
    }

    if (Array.isArray(clone.endpoints)) {
      clone.endpoints = clone.endpoints.map((endpoint: any) => normalizeEndpoint(endpoint));
    } else {
      clone.endpoints = [];
    }

    return clone;
  }

  getEndpointHostedModels(endpoint: any) {
    if (Array.isArray(endpoint?.hostedModels)) {
      return endpoint.hostedModels;
    }
    return [];
  }

  isHostedCatalogModel(model: any) {
    return typeof model?.modelRef === 'string' && model.modelRef.includes('/');
  }

  isLocalCatalogModel(model: any) {
    return typeof model?.id === 'string' && model.id.length > 0;
  }

  getEndpointLabel(endpoint: any) {
    if (endpoint?.name) {
      return `${endpoint.key} (${endpoint.name})`;
    }
    return String(endpoint?.key || 'endpoint');
  }

  getCatalogModelAssignments(model: any) {
    if (this.isLocalCatalogModel(model)) {
      return this.getConfigEndpoints().filter((endpoint: any) =>
        this.getEndpointModels(endpoint).some((entry: any) => String(entry?.id || '') === String(model.id))
      );
    }

    if (this.isHostedCatalogModel(model)) {
      return this.getConfigEndpoints().filter((endpoint: any) =>
        this.getEndpointHostedModels(endpoint).some((entry: any) => String(entry?.modelRef || '') === String(model.modelRef))
      );
    }

    return [];
  }

  cloneModelCatalogEntry(model: any) {
    const clone = JSON.parse(JSON.stringify(model));
    delete clone.name;
    delete clone.fallbackModelIds;
    return clone;
  }

  getSharedModelCatalog() {
    if (Array.isArray(this.config?.modelCatalog)) {
      return this.config.modelCatalog;
    }
    if (Array.isArray(this.config?.ollama?.models)) {
      return this.config.ollama.models;
    }
    return [];
  }

  getKnownLocalModelCatalog() {
    const models: any[] = [];
    const seen = new Set<string>();

    for (const model of this.getSharedModelCatalog()) {
      if (this.isLocalCatalogModel(model) && !seen.has(model.id)) {
        seen.add(model.id);
        models.push(model);
      }
    }

    for (const endpoint of this.getConfigEndpoints()) {
      for (const model of this.getEndpointModels(endpoint)) {
        if (this.isLocalCatalogModel(model) && !seen.has(model.id)) {
          seen.add(model.id);
          models.push(model);
        }
      }
    }

    return models;
  }

  getKnownHostedModelCatalog() {
    const models: any[] = [];
    const seen = new Set<string>();

    for (const endpoint of this.getConfigEndpoints()) {
      for (const model of this.getEndpointHostedModels(endpoint)) {
        if (this.isHostedCatalogModel(model) && !seen.has(model.modelRef)) {
          seen.add(model.modelRef);
          models.push(model);
        }
      }
    }

    for (const model of this.getSharedModelCatalog()) {
      if (this.isHostedCatalogModel(model) && !seen.has(model.modelRef)) {
        seen.add(model.modelRef);
        models.push(model);
      }
    }

    return models;
  }

  ensureSharedModelCatalog() {
    if (!Array.isArray(this.config?.modelCatalog)) {
      this.config.modelCatalog = [
        ...this.getKnownLocalModelCatalog().map((model: any) => this.cloneModelCatalogEntry(model)),
        ...this.getKnownHostedModelCatalog().map((model: any) => this.cloneModelCatalogEntry(model))
      ];
    }
    return this.config.modelCatalog;
  }

  getOllamaModelCatalog() {
    return this.getKnownLocalModelCatalog();
  }

  isLocalModelRef(modelRef: string | undefined) {
    return typeof modelRef === 'string' && modelRef.startsWith('ollama/');
  }

  getEndpointModelOptions(endpoint: any) {
    const options: any[] = [];
    const seen = new Set<string>();

    for (const model of this.getEndpointModels(endpoint)) {
      const ref = `ollama/${model.id}`;
      if (!seen.has(ref)) {
        seen.add(ref);
        options.push({
          ref,
          label: model.id,
          kind: 'local'
        });
      }
    }

    for (const model of this.getEndpointHostedModels(endpoint)) {
      const ref = model.modelRef;
      if (typeof ref === 'string' && ref.length > 0 && !seen.has(ref)) {
        seen.add(ref);
        options.push({
          ref,
          label: ref,
          kind: 'hosted'
        });
      }
    }

    return options;
  }

  getAvailableFallbackModelIds(endpoint?: any) {
    if (endpoint) {
      return this.getEndpointModels(endpoint).map((model: any) => model.id);
    }
    return this.getKnownLocalModelCatalog().map((model: any) => model.id);
  }

  getManagedAgentEntries() {
    const agents = Array.isArray(this.config?.agents?.list) ? this.config.agents.list : [];
    const entries = agents
      .map((agent: any, idx: number) => ({ key: typeof agent?.key === 'string' && agent.key.trim().length > 0 ? agent.key : `agent:${idx}`, agent }))
      .filter((entry: any) => entry.agent?.id);
    entries.sort((left: any, right: any) => {
      const leftMain = this.isMainAgentEntry(left.key, left.agent) ? 0 : 1;
      const rightMain = this.isMainAgentEntry(right.key, right.agent) ? 0 : 1;
      if (leftMain !== rightMain) {
        return leftMain - rightMain;
      }
      return String(left.agent?.name || left.agent?.id || left.key).localeCompare(String(right.agent?.name || right.agent?.id || right.key));
    });
    return entries;
  }

  getAgentDisplayLabel(agent: any) {
    const agentId = typeof agent?.id === 'string' ? agent.id.trim() : '';
    const agentName = typeof agent?.name === 'string' ? agent.name.trim() : '';
    return agentName && agentName !== agentId ? `${agentName} (${agentId})` : (agentId || 'main');
  }

  getDefaultRoutingAgentEntry() {
    const agents = Array.isArray(this.config?.agents?.list) ? this.config.agents.list : [];
    const entries = agents
      .map((agent: any, idx: number) => ({ key: typeof agent?.key === 'string' && agent.key.trim().length > 0 ? agent.key : `agent:${idx}`, agent }))
      .filter((entry: any) => entry.agent?.id);

    return entries.find((entry: any) => entry.agent?.default === true)
      || entries[0]
      || { key: 'main', agent: { id: 'main', name: 'main' } };
  }

  getTelegramSetupStatusRecord(accountId: string, isDefault: boolean) {
    const status = this.telegramSetupStatus && typeof this.telegramSetupStatus === 'object'
      ? this.telegramSetupStatus
      : { defaultAccount: null, accounts: {} };
    if (isDefault) {
      return status.defaultAccount || null;
    }

    const accounts = status.accounts && typeof status.accounts === 'object' ? status.accounts : {};
    return accountId ? (accounts[accountId] || null) : null;
  }

  isMainAgentEntry(key: string, agent: any) {
    return key === 'strongAgent' || agent?.isMain === true;
  }

  canRemoveAgent(key: string, agent: any) {
    return !this.isMainAgentEntry(key, agent);
  }

  removeAgentReferences(agentId: string) {
    for (const { agent } of this.getManagedAgentEntries()) {
      const subagents = this.ensureSubagentsConfig(agent);
      subagents.allowAgents = subagents.allowAgents.filter((candidateId: string) => candidateId !== agentId);
    }

    for (const workspace of this.getWorkspaces()) {
      workspace.agents = this.getWorkspaceAgentIds(workspace).filter((candidateId: string) => candidateId !== agentId);
    }

    for (const endpoint of this.getConfigEndpoints()) {
      endpoint.agents = this.getEndpointAgentIds(endpoint).filter((candidateId: string) => candidateId !== agentId);
    }

    const telegramRouting = this.ensureTelegramRoutingConfig();
    if (telegramRouting) {
      telegramRouting.routes = this.getTelegramRouteList().filter((route: any) => String(route?.targetAgentId || '') !== agentId);
    }

    if (this.topologyLinkSourceAgentId === agentId) {
      this.topologyLinkSourceAgentId = null;
    }
    if (this.topologyHoverAgentId === agentId) {
      this.topologyHoverAgentId = null;
    }
    if (this.topologyHoverEdgeKey && this.topologyHoverEdgeKey.startsWith(`${agentId}->`)) {
      this.topologyHoverEdgeKey = null;
    }
  }

  getAllowedAgentChoices(currentAgentId?: string) {
    return this.getManagedAgentEntries()
      .filter(({ agent }: any) => agent.id !== currentAgentId)
      .map(({ agent }: any) => ({
        id: agent.id,
        label: agent.name ? `${agent.name} (${agent.id})` : agent.id
      }));
  }

  getAgentEnabledState(_key: string, agent: any) {
    return !!agent?.enabled;
  }

  getAgentEffectiveWorkspaceMode(agent: any) {
    return this.getWorkspaceForAgentId(agent?.id)?.mode || 'private';
  }

  getTopologyAgentEntries() {
    return this.getManagedAgentEntries().map(({ key, agent }: any) => ({
      key,
      agent,
      id: String(agent?.id || key),
      name: String(agent?.name || agent?.id || key),
      enabled: this.getAgentEnabledState(key, agent),
      isMain: this.isMainAgentEntry(key, agent),
      endpoint: this.resolveAgentEndpoint(agent),
      workspaceMode: this.getAgentEffectiveWorkspaceMode(agent),
      modelSource: agent?.modelSource || (this.isLocalModelRef(agent?.modelRef) ? 'local' : 'hosted')
    }));
  }

  getTopologyAgentEntryById(agentId: string | null | undefined) {
    if (!agentId) return null;
    return this.getTopologyAgentEntries().find((entry: any) => entry.id === agentId) || null;
  }

  getTopologyAgentEntryByKey(agentKey: string | null | undefined) {
    if (!agentKey) return null;
    return this.getTopologyAgentEntries().find((entry: any) => entry.key === agentKey) || null;
  }

  getAgentDelegationTargets(agent: any) {
    const subagents = this.ensureSubagentsConfig(agent);
    return subagents.allowAgents;
  }

  getTopologyPreviewSourceAgentId() {
    return this.topologyLinkSourceAgentId || this.topologyHoverAgentId;
  }

  getVisibleTopologyEdges() {
    if (this.topologyShowAllArrows) {
      return this.topologyEdges;
    }
    const previewSourceAgentId = this.getTopologyPreviewSourceAgentId();
    if (!previewSourceAgentId) {
      return [];
    }
    return this.topologyEdges.filter((edge: any) => edge.sourceId === previewSourceAgentId);
  }

  getTopologyEdgeColor(edge: any) {
    if (this.topologyHoverEdgeKey === edge.key) {
      return '#ff4fc3';
    }
    const isHoveredSource = this.topologyHoverAgentId === edge.sourceId;
    if (edge.active) {
      return '#00bcd4';
    }
    if (isHoveredSource) {
      return '#ff8a65';
    }
    if (edge.main) {
      return '#ffd54f';
    }
    return '#6ec6ff';
  }

  getTopologyProtectedLaneMetrics() {
    return {
      laneSpacing: 12,
      leftPadding: 18,
      rightPadding: 12,
      centerGap: 24
    };
  }

  getTopologySlotLaneCounts(slot: any, columnCount: number) {
    if (columnCount < 2) {
      return { leftLaneCount: 0, rightLaneCount: 0 };
    }

    const slotEntries = Array.isArray(slot?.agents) ? slot.agents : [];
    const columnByAgentId = new Map<string, number>();
    slotEntries.forEach((entry: any, index: number) => {
      columnByAgentId.set(String(entry?.id || ''), index % columnCount);
    });

    let leftLaneCount = 0;
    let rightLaneCount = 0;
    for (const entry of slotEntries) {
      for (const targetId of this.getAgentDelegationTargets(entry.agent)) {
        const targetColumn = columnByAgentId.get(String(targetId || ''));
        if (targetColumn === 0) {
          leftLaneCount += 1;
        } else if (targetColumn === 1) {
          rightLaneCount += 1;
        }
      }
    }

    return { leftLaneCount, rightLaneCount };
  }

  getTopologySlotColumnGap(slot: any, columnCount: number) {
    if (columnCount < 2) {
      return 16;
    }

    const { laneSpacing, leftPadding, rightPadding, centerGap } = this.getTopologyProtectedLaneMetrics();
    const { leftLaneCount, rightLaneCount } = this.getTopologySlotLaneCounts(slot, columnCount);
    const leftSpread = Math.max(0, leftLaneCount - 1) * laneSpacing;
    const rightSpread = Math.max(0, rightLaneCount - 1) * laneSpacing;
    const requiredGap = leftPadding + rightPadding + centerGap + leftSpread + rightSpread;
    return Math.min(220, Math.max(92, requiredGap));
  }

  hasDelegationEdge(sourceAgentId: string, targetAgentId: string) {
    const sourceEntry = this.getTopologyAgentEntryById(sourceAgentId);
    if (!sourceEntry) return false;
    return this.getAgentDelegationTargets(sourceEntry.agent).includes(targetAgentId);
  }

  getTopologyReachableAgents(startAgentId: string, visited = new Set<string>()) {
    if (visited.has(startAgentId)) {
      return visited;
    }
    visited.add(startAgentId);
    const sourceEntry = this.getTopologyAgentEntryById(startAgentId);
    if (!sourceEntry) {
      return visited;
    }
    for (const targetId of this.getAgentDelegationTargets(sourceEntry.agent)) {
      if (this.getTopologyAgentEntryById(targetId)) {
        this.getTopologyReachableAgents(targetId, visited);
      }
    }
    return visited;
  }

  wouldCreateDelegationCycle(sourceAgentId: string, targetAgentId: string) {
    if (!sourceAgentId || !targetAgentId) return false;
    if (sourceAgentId === targetAgentId) return true;
    const reachable = this.getTopologyReachableAgents(targetAgentId, new Set<string>());
    return reachable.has(sourceAgentId);
  }

  setTopologyNotice(message: string) {
    this.topologyNotice = message;
  }

  clearTopologyNotice() {
    this.topologyNotice = '';
  }

  selectTopologyDelegationSource(agentId: string) {
    if (this.topologyLinkSourceAgentId === agentId) {
      this.topologyLinkSourceAgentId = null;
      this.clearTopologyNotice();
      return;
    }
    this.topologyLinkSourceAgentId = agentId;
    const sourceEntry = this.getTopologyAgentEntryById(agentId);
    if (sourceEntry) {
      this.setTopologyNotice(`Wiring delegation from ${sourceEntry.name}. Click another agent to add or remove a delegation arrow.`);
    }
  }

  toggleTopologyDelegation(sourceAgentId: string, targetAgentId: string) {
    if (sourceAgentId === targetAgentId) {
      this.setTopologyNotice('An agent cannot delegate to itself.');
      return;
    }

    const sourceEntry = this.getTopologyAgentEntryById(sourceAgentId);
    const targetEntry = this.getTopologyAgentEntryById(targetAgentId);
    if (!sourceEntry || !targetEntry) {
      this.setTopologyNotice('Could not find one of the selected agents.');
      return;
    }

    const subagents = this.ensureSubagentsConfig(sourceEntry.agent);
    const allowedAgents = this.getAgentDelegationTargets(sourceEntry.agent);
    const existingIndex = allowedAgents.indexOf(targetAgentId);
    if (existingIndex >= 0) {
      allowedAgents.splice(existingIndex, 1);
      this.setTopologyNotice(`${sourceEntry.name} no longer delegates to ${targetEntry.name}.`);
      this.requestUpdate();
      return;
    }

    if (this.wouldCreateDelegationCycle(sourceAgentId, targetAgentId)) {
      this.setTopologyNotice(`Blocked circular delegation: ${targetEntry.name} already leads back to ${sourceEntry.name}.`);
      return;
    }

    subagents.enabled = true;
    allowedAgents.push(targetAgentId);
    this.setTopologyNotice(`${sourceEntry.name} can now delegate to ${targetEntry.name}.`);
    this.requestUpdate();
  }

  handleTopologyAgentClick(agentId: string) {
    if (!this.topologyLinkSourceAgentId) {
      return;
    }
    if (this.topologyLinkSourceAgentId === agentId) {
      this.topologyLinkSourceAgentId = null;
      this.clearTopologyNotice();
      return;
    }
    this.toggleTopologyDelegation(this.topologyLinkSourceAgentId, agentId);
  }

  setAgentEndpointAssignment(agent: any, endpointKey: string | null) {
    const agentId = String(agent?.id || '').trim();
    if (agentId) {
      for (const endpoint of this.getConfigEndpoints()) {
        endpoint.agents = this.getEndpointAgentIds(endpoint).filter((candidateId: string) => candidateId !== agentId);
      }
      if (endpointKey && endpointKey.length > 0) {
        const targetEndpoint = this.getConfigEndpoints().find((candidate: any) => candidate.key === endpointKey);
        if (targetEndpoint) {
          targetEndpoint.agents = [...this.getEndpointAgentIds(targetEndpoint), agentId];
        }
      }
    }
    const endpoint = endpointKey ? this.getConfigEndpoints().find((candidate: any) => candidate.key === endpointKey) : null;
    this.syncAgentEndpointModelSelection(agent, endpoint);
  }

  assignTopologyAgentToEndpoint(agentKey: string, endpointKey: string | null) {
    const entry = this.getTopologyAgentEntryByKey(agentKey);
    if (!entry) return;
    this.setAgentEndpointAssignment(entry.agent, endpointKey);
    this.clearTopologyNotice();
    this.requestUpdate();
  }

  startTopologyDrag(agentKey: string) {
    this.topologyDraggedAgentKey = agentKey;
    this.clearTopologyNotice();
  }

  endTopologyDrag() {
    this.topologyDraggedAgentKey = null;
    this.topologyHoverEndpointKey = null;
  }

  handleTopologyDrop(endpointKey: string | null) {
    if (!this.topologyDraggedAgentKey) return;
    this.assignTopologyAgentToEndpoint(this.topologyDraggedAgentKey, endpointKey);
    this.topologyDraggedAgentKey = null;
    this.topologyHoverEndpointKey = null;
  }

  openTopologyAgentEditor(agentKey: string) {
    this.startEditingAgent(agentKey);
    this.activeTab = 'config';
    this.configSection = 'agents';
  }

  getTopologySlots() {
    const slots = this.getSortedConfigEndpoints().map((endpoint: any) => ({
      key: endpoint.key,
      endpointKey: endpoint.key,
      title: this.getEndpointLabel(endpoint),
      subtitle: endpoint.default ? 'Default workbench' : 'Endpoint workbench',
      icon: endpoint.default ? '💻' : '🖥️',
      endpoint,
      agents: [] as any[]
    }));

    const roamingSlot = {
      key: '__roaming__',
      endpointKey: null,
      title: 'Roaming Bench',
      subtitle: 'Agents without a resolved endpoint',
      icon: '🧰',
      endpoint: null,
      agents: [] as any[]
    };

    for (const entry of this.getTopologyAgentEntries()) {
      const slot = entry.endpoint
        ? slots.find((candidate: any) => candidate.endpointKey === entry.endpoint.key)
        : roamingSlot;
      (slot || roamingSlot).agents.push(entry);
    }

    return [...slots, roamingSlot];
  }

  syncAgentModelSource(agent: any) {
    const primaryRef = typeof agent?.modelRef === 'string' && agent.modelRef.length > 0
      ? agent.modelRef
      : (Array.isArray(agent?.candidateModelRefs) && agent.candidateModelRefs.length > 0 ? agent.candidateModelRefs[0] : '');

    agent.modelSource = this.isLocalModelRef(primaryRef) ? 'local' : 'hosted';
  }

  syncAgentEndpointModelSelection(agent: any, endpoint: any) {
    if (!agent) {
      return;
    }

    if (!endpoint) {
      this.syncAgentModelSource(agent);
      return;
    }

    const allowedRefs = new Set(this.getEndpointModelOptions(endpoint).map((option: any) => option.ref));
    if (allowedRefs.size === 0) {
      this.syncAgentModelSource(agent);
      return;
    }

    const currentCandidates = Array.isArray(agent?.candidateModelRefs) ? agent.candidateModelRefs : [];
    if (!allowedRefs.has(agent?.modelRef)) {
      const firstCompatibleCandidate = currentCandidates.find((ref: string) => allowedRefs.has(ref));
      if (firstCompatibleCandidate) {
        agent.modelRef = firstCompatibleCandidate;
      }
    }

    this.syncAgentModelSource(agent);
  }

  syncAllAgentModelSources() {
    for (const { agent } of this.getManagedAgentEntries()) {
      this.syncAgentModelSource(agent);
    }
  }

  syncAllAgentSelections() {
    for (const { agent } of this.getManagedAgentEntries()) {
      const endpoint = this.resolveAgentEndpoint(agent);
      this.syncAgentEndpointModelSelection(agent, endpoint);
    }
  }

  renderEndpointsConfig() {
    if (this.editingEndpointKey) {
        return this.renderEndpointEditor(this.editingEndpointKey);
    }

    const endpoints = this.getSortedConfigEndpoints();

    return html`
      <div class="card">
        <div class="card-header">
          <h3>Endpoints</h3>
          <button class="btn btn-ghost" @click=${() => this.addEndpoint()}>+ Add Endpoint</button>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Endpoints are machines or PCs. Each one can expose a local Ollama runtime, a hosted model pool, or both.</p>
        ${repeat(endpoints, (ep: any) => ep.key, (ep: any) => {
          const runtime = this.getEndpointOllama(ep);
          const assignedAgentCount = this.getEndpointAgentIds(ep).length;
          return html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${ep.key} ${ep.default ? html`<span class="badge" style="background: #ffc107;">Default</span>` : ''}</span>
              <span class="item-sub">${runtime?.hostBaseUrl || 'Hosted-only endpoint'} | ${this.getEndpointModels(ep).length} local, ${this.getEndpointHostedModels(ep).length} hosted | ${assignedAgentCount} assigned</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" @click=${() => this.editingEndpointKey = ep.key}>Configure Endpoint</button>
              ${this.canRemoveEndpoint(ep) ? html`
                <button class="btn btn-danger" @click=${() => this.removeEndpointByKey(ep.key)}>Remove</button>
              ` : ''}
            </div>
          </div>
        `})}
      </div>
    `;
  }

  renderEndpointEditor(key: string) {
      const ep = this.getConfigEndpoints().find((e: any) => e.key === key);
      if (!ep) return html`Endpoint not found`;
      const endpointModels = this.getEndpointModels(ep);
      const endpointHostedModels = this.getEndpointHostedModels(ep);
      const runtime = this.getEndpointOllama(ep);
      const assignedAgentIds = this.getEndpointAgentIds(ep);
      const assignedAgents = this.getManagedAgentEntries().filter(({ agent }: any) => assignedAgentIds.includes(String(agent?.id || '')));
      const availableAgents = this.getManagedAgentEntries().filter(({ agent }: any) => {
        const agentId = String(agent?.id || '');
        return agentId.length > 0 && !assignedAgentIds.includes(agentId);
      });

      return html`
        <div class="card">
            <div class="card-header">
                <h3>Endpoint: ${ep.key}</h3>
                <button class="btn btn-ghost" @click=${() => this.editingEndpointKey = null}>Back to Endpoints</button>
            </div>

            <div class="grid-2">
                <div>
                    <div class="form-group">
                        <label>Endpoint Key</label>
                        <input type="text" .value=${ep.key} disabled>
                    </div>
                    <div class="form-group">
                        <label class="toggle-switch">
                            <input type="checkbox" ?checked=${!!ep.default} @change=${(e: any) => {
                                if (e.target.checked) {
                                    for (const endpoint of this.getConfigEndpoints()) {
                                        endpoint.default = endpoint.key === ep.key;
                                    }
                                } else {
                                    ep.default = false;
                                }
                                this.requestUpdate();
                            }}>
                            Default endpoint
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <label>Endpoint Role</label>
                    <div class="help-text" style="margin-top: 0;">The default endpoint is the main workbench the toolkit prefers first when an agent has not been moved elsewhere.</div>
                </div>
            </div>

            <div class="form-group" style="margin-top: 16px;">
                <label class="toggle-switch">
                    <input type="checkbox" ?checked=${!!runtime} @change=${(e: any) => {
                        if (e.target.checked) {
                            this.ensureEndpointOllama(ep);
                        } else {
                            delete ep.ollama;
                        }
                        this.requestUpdate();
                    }}>
                    This endpoint has a local Ollama runtime
                </label>
            </div>

            <h4 style="color: #666; margin-top: 24px;">Assigned Agents</h4>
            <p style="font-size: 0.8rem; color: #888; margin-bottom: 15px;">Endpoints now own agent placement. Agents listed here belong to this machine/workbench.</p>
            <div class="tag-list">
                ${assignedAgents.map(({ agent }: any) => html`
                    <div class="tag">
                        ${agent.name ? `${agent.name} (${agent.id})` : agent.id}
                        <span class="tag-remove" @click=${() => {
                            this.setAgentEndpointAssignment(agent, null);
                            this.requestUpdate();
                        }}>×</span>
                    </div>
                `)}
            </div>
            <div style="margin-top: 10px; margin-bottom: 20px;">
                <select @change=${(e: any) => {
                    const agentId = e.target.value;
                    const entry = this.getManagedAgentEntries().find((candidate: any) => String(candidate?.agent?.id || '') === agentId);
                    if (entry) {
                        this.setAgentEndpointAssignment(entry.agent, ep.key);
                        this.requestUpdate();
                    }
                    e.target.value = '';
                }}>
                    <option value="">${availableAgents.length === 0 ? 'All configured agents are already assigned' : '+ Add Agent to Endpoint'}</option>
                    ${availableAgents.map(({ agent }: any) => html`<option value=${agent.id}>${agent.name ? `${agent.name} (${agent.id})` : agent.id}</option>`)}
                </select>
            </div>

            ${runtime ? html`
            <div class="grid-2">
                <div class="form-group">
                    <label>Base URL (Inside Docker)</label>
                    <input type="text" .value=${runtime.baseUrl || ''} @input=${(e: any) => { runtime.baseUrl = e.target.value; this.requestUpdate(); }}>
                </div>
                <div class="form-group">
                    <label>Host Base URL (Direct Access)</label>
                    <input type="text" .value=${runtime.hostBaseUrl || ''} @input=${(e: any) => { runtime.hostBaseUrl = e.target.value; this.requestUpdate(); }}>
                </div>
            </div>

            <div class="grid-2">
                <div>
                    <div class="form-group">
                        <label>Provider ID</label>
                        <input type="text" .value=${runtime.providerId || ''} @input=${(e: any) => { runtime.providerId = e.target.value; this.requestUpdate(); }}>
                    </div>
                    <div class="form-group">
                        <label class="toggle-switch">
                            <input type="checkbox" ?checked=${!!runtime.autoPullMissingModels} @change=${(e: any) => { runtime.autoPullMissingModels = e.target.checked; this.requestUpdate(); }}>
                            Auto-pull missing local models when they fit
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <label>Runtime Pull Behavior</label>
                    <div class="help-text" style="margin-top: 0;">When enabled, bootstrap can pull missing local models onto this machine if they fit the configured hardware budget.</div>
                </div>
            </div>

            <h4 style="color: #666; margin-top: 20px;">Local Runtime Models</h4>
            <p style="font-size: 0.8rem; color: #888; margin-bottom: 15px;">Models listed here are desired on this machine's local runtime. Bootstrap will pull them when they fit the machine. When a model has fallbacks, both toolkit fit checks and OpenClaw runtime fallbacks follow the order shown here.</p>
             
            ${endpointModels.map((mo: any, idx: number) => html`
                <div class="item-row" style="align-items: flex-start; gap: 16px;">
                    <div class="item-info">
                        <span class="item-title">${mo.id}</span>
                        <span class="item-sub">Ctx: ${mo.contextWindow} | MaxTokens: ${mo.maxTokens || 8192}</span>
                        ${endpointModels.length > 1 ? this.renderOrderedLocalFallbackEditor(mo, endpointModels.map((localModel: any) => localModel.id)) : ''}
                    </div>
                    <div style="display: flex; gap: 12px; align-items: flex-start; flex-shrink: 0;">
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <button class="btn btn-secondary" @click=${() => this.tuneExistingModel(ep.key, mo.id)}>Re-Tune</button>
                            <button class="btn btn-danger" @click=${() => { endpointModels.splice(idx, 1); this.requestUpdate(); }}>Remove</button>
                        </div>
                    </div>
                </div>
            `)}

            <div style="margin-top: 20px;">
                <button class="btn btn-primary" @click=${() => { this.selectorTarget = 'tune'; this.showModelSelector = true; }}>+ Add Local Model from Catalog</button>
            </div>
            ` : html`
            <div class="item-sub" style="margin-top: 20px;">This endpoint is currently hosted-only. Enable the local runtime toggle above if this machine should run Ollama too.</div>
            `}

            <h4 style="color: #666; margin-top: 24px;">Hosted Models</h4>
            <p style="font-size: 0.8rem; color: #888; margin-bottom: 15px;">These are provider-backed models available from this endpoint, such as OpenAI, Claude, Gemini, Copilot, or Ollama Cloud refs. If the primary hosted model fails, OpenClaw tries the local fallbacks below in order.</p>

            ${endpointHostedModels.map((model: any, idx: number) => html`
                <div class="item-row" style="align-items: flex-start; gap: 16px;">
                    <div class="item-info">
                        <span class="item-title">${model.modelRef}</span>
                        ${endpointModels.length > 0 ? this.renderOrderedLocalFallbackEditor(model, endpointModels.map((localModel: any) => localModel.id)) : ''}
                    </div>
                    <div style="display: flex; gap: 12px; align-items: flex-start; flex-shrink: 0;">
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <button class="btn btn-danger" @click=${() => { endpointHostedModels.splice(idx, 1); this.requestUpdate(); }}>Remove</button>
                        </div>
                    </div>
                </div>
            `)}

            <div style="margin-top: 20px;">
                <button class="btn btn-primary" @click=${() => { this.selectorTarget = 'endpoint-hosted'; this.showModelSelector = true; }}>+ Add Hosted Model from Catalog</button>
            </div>
        </div>
      `;
  }

  renderModelSelector() {
      const models = this.selectorTarget === 'endpoint-hosted'
        ? this.getKnownHostedModelCatalog()
        : this.getKnownLocalModelCatalog();
      return html`
        <div class="modal-overlay">
            <div class="modal">
                <div class="card-header" style="padding: 20px;">
                    <h3>${this.selectorTarget === 'endpoint-hosted' ? 'Select Hosted Model from Catalog' : 'Select Local Model from Catalog'}</h3>
                    <button class="btn btn-ghost" @click=${() => this.showModelSelector = false}>Close</button>
                </div>
                <div class="modal-body">
                    ${models.length === 0 ? html`<div class="item-sub">No matching models are in the shared catalog yet.</div>` : ''}
                    ${models.map((m: any) => html`
                        <div class="selectable-item" @click=${() => this.handleModelSelected(this.selectorTarget === 'endpoint-hosted' ? m.modelRef : m.id)}>
                            <div class="item-title">${m.id || m.modelRef}</div>
                            <div class="item-sub">${this.selectorTarget === 'endpoint-hosted' ? `Ref: ${m.modelRef}` : `ID: ${m.id}`}</div>
                        </div>
                    `)}
                </div>
            </div>
        </div>
      `;
  }

  handleModelSelected(modelId: string) {
      this.showModelSelector = false;
      if (this.selectorTarget === 'tune') {
          const maxCtx = prompt('Maximum context window to test:', '131072');
          if (maxCtx) {
              this.runCommand('add-local-model', ['-Model', modelId, '-EndpointKey', this.editingEndpointKey!, '-MaxContextWindow', maxCtx, '-SkipBootstrap']);
          }
      } else if (this.selectorTarget === 'endpoint-hosted') {
          const endpoint = this.getConfigEndpoints().find((e: any) => e.key === this.editingEndpointKey);
          const catalogEntry = this.getKnownHostedModelCatalog().find((entry: any) => entry.modelRef === modelId);
          if (!endpoint || !catalogEntry) return;
          if (!Array.isArray(endpoint.hostedModels)) endpoint.hostedModels = [];
          if (endpoint.hostedModels.some((entry: any) => entry.modelRef === modelId)) {
              alert(`Hosted model "${modelId}" is already added to endpoint "${endpoint.key}".`);
              return;
          }
          endpoint.hostedModels.push(this.sanitizeModelEntries([catalogEntry])[0]);
          this.requestUpdate();
      } else if (this.selectorTarget === 'candidate') {
          const agent = this.getEditingAgent();
          const ref = `ollama/${modelId}`;
          if (!agent.candidateModelRefs) agent.candidateModelRefs = [];
          if (!agent.candidateModelRefs.includes(ref)) {
              agent.candidateModelRefs.push(ref);
          }
          this.requestUpdate();
      }
  }

  tuneExistingModel(endpointKey: string, modelId: string) {
      const maxCtx = prompt('Maximum context window to test:', '131072');
      if (maxCtx) {
          this.runCommand('add-local-model', ['-Model', modelId, '-EndpointKey', endpointKey, '-MaxContextWindow', maxCtx, '-SkipBootstrap']);
      }
  }

  renderModelsConfig() {
    const hasSharedCatalog = Array.isArray(this.config?.modelCatalog) || Array.isArray(this.config?.ollama?.models);
    const localModels = hasSharedCatalog ? this.getSharedModelCatalog().filter((model: any) => this.isLocalCatalogModel(model)) : this.getKnownLocalModelCatalog();
    const hostedModels = hasSharedCatalog ? this.getSharedModelCatalog().filter((model: any) => this.isHostedCatalogModel(model)) : this.getKnownHostedModelCatalog();
    return html`
      <div class="card">
        <div class="card-header">
          <h3>Known Models</h3>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-ghost" @click=${() => this.addModel()}>+ Add Local</button>
            <button class="btn btn-ghost" @click=${() => this.addHostedModel()}>+ Add Hosted</button>
          </div>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">
          ${hasSharedCatalog
            ? 'This shared catalog is stored in top-level modelCatalog in openclaw-bootstrap.config.json. Endpoint model rows still decide what each machine should pull, run, and fall back to.'
            : 'No shared catalog exists yet. The view below is inferred from endpoint-local and endpoint-hosted models; adding a catalog model will seed a reusable shared catalog from this list.'}
        </p>
        <h4 style="color: #666; margin-bottom: 10px;">Local Catalog</h4>
        ${repeat(localModels, (m: any) => m.id, (m: any) => {
          const idx = hasSharedCatalog ? this.getSharedModelCatalog().indexOf(m) : -1;
          return html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${m.id}</span>
              <span class="item-sub">Min Ctx: ${m.minimumContextWindow || 24576}</span>
            </div>
            ${hasSharedCatalog && idx >= 0 ? html`
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-danger" @click=${() => this.removeModel(idx)}>Remove</button>
              </div>
            ` : ''}
          </div>
        `;})}
        <h4 style="color: #666; margin: 20px 0 10px;">Hosted Catalog</h4>
        ${repeat(hostedModels, (m: any) => m.modelRef, (m: any) => {
          const idx = hasSharedCatalog ? this.getSharedModelCatalog().indexOf(m) : -1;
          return html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${m.modelRef}</span>
              <span class="item-sub">Hosted provider model</span>
            </div>
            ${hasSharedCatalog && idx >= 0 ? html`
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-danger" @click=${() => this.removeModel(idx)}>Remove</button>
              </div>
            ` : ''}
          </div>
        `;})}
      </div>
    `;
  }

  renderTemplateMarkdownsConfig() {
      const scope = this.markdownTemplateScope;
      const fileNames = this.getMarkdownTemplateFileOptions(scope) as string[];
      const selectedTemplateFile = this.getSelectedTemplateMarkdownFile();
      const selectedFileName = fileNames.includes(selectedTemplateFile)
        ? selectedTemplateFile
        : fileNames[0];
      const library = this.ensureMarkdownTemplateLibrary(scope, selectedFileName);
      const templateKeys = Object.keys(library).sort((left, right) => left.localeCompare(right));

      return html`
        <div class="card">
            <div class="card-header">
                <h3>Template Markdowns</h3>
                <button class="btn btn-ghost" @click=${() => this.addMarkdownTemplate(scope, selectedFileName)}>+ Add Template</button>
            </div>
            <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Define reusable markdown templates by scope and file type. Agents and workspaces can either reference one of these named templates or keep their own custom markdown files.</p>

            <div style="display: flex; gap: 10px; margin-bottom: 16px;">
              <div class="tab ${scope === 'agents' ? 'active' : ''}" @click=${() => this.markdownTemplateScope = 'agents'}>Agents</div>
              <div class="tab ${scope === 'workspaces' ? 'active' : ''}" @click=${() => this.markdownTemplateScope = 'workspaces'}>Workspaces</div>
            </div>

            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px;">
              ${fileNames.map((fileName) => html`
                <div class="tab ${selectedFileName === fileName ? 'active' : ''}" @click=${() => this.setSelectedTemplateMarkdownFile(fileName)}>${fileName.replace('.md', '')}</div>
              `)}
            </div>

            <p class="help-text" style="margin-bottom: 20px;">Stored under <code>openclaw-toolkit\\markdown-templates\\${scope}\\${selectedFileName.replace('.md', '')}\\&lt;key&gt;.md</code>.</p>

            ${templateKeys.length === 0 ? html`
              <div class="help-text">No templates defined for ${scope} ${selectedFileName} yet.</div>
            ` : templateKeys.map((templateKey) => html`
              <div class="form-group" style="margin-bottom: 25px; border-bottom: 1px solid #333; padding-bottom: 20px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                      <span style="font-weight: bold; color: #00bcd4;">${templateKey}</span>
                      <button class="btn btn-danger btn-small" style="padding: 4px 10px;" @click=${() => this.removeMarkdownTemplate(scope, selectedFileName, templateKey)}>Delete Template</button>
                  </div>
                  <textarea rows="10" .value=${library[templateKey] || ''} @input=${(e: any) => { library[templateKey] = e.target.value; this.requestUpdate(); }}></textarea>
              </div>
            `)}
        </div>
      `;
  }

  renderToolsetsConfig() {
    const toolsets = this.getToolsetsList();

    return html`
      <div class="card">
        <div class="card-header">
          <h3>Toolsets</h3>
          <button class="btn btn-ghost" @click=${() => {
            const toolsetsList = this.getToolsetsList();
            let counter = toolsetsList.length + 1;
            let key = `toolset-${counter}`;
            while (this.getToolsetByKey(key)) {
              counter += 1;
              key = `toolset-${counter}`;
            }
            toolsetsList.push(this.createToolsetRecord({ key, name: `Toolset ${counter}`, allow: [], deny: [] }));
            this.requestUpdate();
          }}>+ Add Toolset</button>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Toolsets are reusable allow/deny layers. The built-in <code>minimal</code> toolset is always applied first, then each agent's own toolsets are merged from top to bottom so lower entries win conflicts.</p>

        ${toolsets.map((toolset: any) => {
          const isMinimal = toolset.key === 'minimal';
          const availableAllowOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !this.normalizeToolNameList(toolset.allow).includes(option.id));
          const availableDenyOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !this.normalizeToolNameList(toolset.deny).includes(option.id));
          return html`
            <div class="card" style="margin-bottom: 16px; border-color: ${isMinimal ? '#00bcd4' : '#333'};">
              <div class="card-header">
                <h3>${toolset.name || toolset.key} ${isMinimal ? html`<span class="badge">Global Minimal</span>` : ''}</h3>
                ${isMinimal ? html`<span class="help-text" style="margin: 0;">Built in and always applied first.</span>` : html`
                  <button class="btn btn-danger" @click=${() => this.removeToolset(toolset.key)}>Remove Toolset</button>
                `}
              </div>

              <div class="grid-2">
                <div class="form-group">
                  <label>Name</label>
                  <input type="text" .value=${toolset.name || ''} @input=${(e: any) => { toolset.name = e.target.value; this.requestUpdate(); }}>
                </div>
                <div class="form-group">
                  <label>Key</label>
                  <input
                    type="text"
                    .value=${toolset.key || ''}
                    ?disabled=${isMinimal}
                    @change=${(e: any) => this.renameToolsetKey(toolset, e.target.value)}
                  >
                  ${isMinimal ? html`<div class="help-text">The global minimal toolset key is locked.</div>` : html`<div class="help-text">Agents reference this key. Renaming updates existing agent assignments.</div>`}
                </div>
              </div>

              <div class="help-text" style="margin-top: 0; margin-bottom: 14px;">${this.getToolsetPreviewText(toolset)}</div>

              <div class="grid-2">
                <div class="form-group">
                  <label>Allowed Tools</label>
                  <div class="tag-list">
                    ${this.normalizeToolNameList(toolset.allow).map((toolId: string) => html`
                      <div class="tag">
                        ${this.renderToolLabel(toolId)}
                        <span class="tag-remove" @click=${() => this.removeToolFromToolset(toolset, 'allow', toolId)}>×</span>
                      </div>
                    `)}
                  </div>
                  <div style="margin-top: 10px;">
                    <select @change=${(e: any) => {
                      const value = e.target.value;
                      if (value) {
                        this.addToolToToolset(toolset, 'allow', value);
                        e.target.value = '';
                      }
                    }}>
                      <option value="">+ Add allowed tool</option>
                      ${availableAllowOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`)}
                    </select>
                  </div>
                </div>

                <div class="form-group">
                  <label>Denied Tools</label>
                  <div class="tag-list">
                    ${this.normalizeToolNameList(toolset.deny).map((toolId: string) => html`
                      <div class="tag">
                        ${this.renderToolLabel(toolId)}
                        <span class="tag-remove" @click=${() => this.removeToolFromToolset(toolset, 'deny', toolId)}>×</span>
                      </div>
                    `)}
                  </div>
                  <div style="margin-top: 10px;">
                    <select @change=${(e: any) => {
                      const value = e.target.value;
                      if (value) {
                        this.addToolToToolset(toolset, 'deny', value);
                        e.target.value = '';
                      }
                    }}>
                      <option value="">+ Add denied tool</option>
                      ${availableDenyOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  renderAgentsConfig() {
    if (this.editingAgentKey) {
        return this.renderAgentEditor(this.editingAgentKey);
    }

    const agents = this.getManagedAgentEntries().map(({ key, agent }: any) => ({
      key,
      ...agent,
      enabled: this.getAgentEnabledState(key, agent),
      appliedToolsets: this.getAgentAppliedToolsets(agent).map((toolset: any) => toolset.name || toolset.key)
    }));

    return html`
      <div class="card">
        <div class="card-header">
            <h3>Agents Configuration</h3>
            <button class="btn btn-ghost" @click=${() => this.addAgent()}>+ Add Agent</button>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Agents are first-class toolkit records. Endpoints own machine placement, and workspaces own the agent home base: the primary workspace the agent lives in by default. Private workspaces are the privacy boundary; shared workspaces are the collaboration area.</p>

        <h4 style="color: #666; margin-bottom: 10px;">All Agents</h4>
        ${agents.map((agent: any) => html`
          <div class="item-row" style="${!agent.enabled ? 'opacity: 0.5;' : ''}">
            <div class="item-info">
              <span class="item-title">
                ${agent.name} 
                ${this.isMainAgentEntry(agent.key, agent) ? html`<span class="badge" style="background: #ffc107;">Main</span>` : ''}
                ${!agent.enabled ? html`<span style="color: #f44336; font-size: 0.7rem;">(Disabled)</span>` : ''}
              </span>
              <span class="item-sub">ID: ${agent.id} | Home Base: ${this.getWorkspaceDisplayLabel(this.getWorkspaceForAgentId(agent.id))} | Sandbox: ${this.getAgentEffectiveSandboxMode(agent)} | Model: ${agent.modelRef || '(unset)'} | Toolsets: ${agent.appliedToolsets.join(' -> ') || 'Minimal'}</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" @click=${() => this.startEditingAgent(agent.key)}>Configure</button>
              ${this.canRemoveAgent(agent.key, agent) ? html`
                <button class="btn btn-danger" @click=${() => this.removeAgentByKey(agent.key)}>Remove</button>
              ` : ''}
            </div>
          </div>
        `)}
      </div>
    `;
  }

  getEditingAgent() {
      return this.editingAgentDraft;
  }

  renderAgentEditor(key: string) {
    const agent = this.getEditingAgent();
    if (!agent) return html`Agent not found`;
    const isMain = this.isMainAgentEntry(key, agent);

    const endpoints = this.getSortedConfigEndpoints();
    const subagents = this.ensureSubagentsConfig(agent);
    const agentTemplateFiles = this.ensureEditingAgentTemplateFiles();
    const agentIdValidationError = this.getEditingAgentValidationError();
    const primaryWorkspace = this.getWorkspaceForAgentId(agent.id);
    const accessibleSharedWorkspaces = primaryWorkspace?.mode === 'private'
      ? this.getWorkspaceSharedAccessIds(primaryWorkspace).map((workspaceId: string) => this.getWorkspaceById(workspaceId)).filter(Boolean)
      : [];
    const selectedEndpoint = this.resolveAgentEndpoint(agent);
    const effectiveEndpointKey = selectedEndpoint?.key || '';
    const endpointModelOptions = selectedEndpoint ? this.getEndpointModelOptions(selectedEndpoint) : [];
    const allowedAgentChoices = this.getAllowedAgentChoices(agent.id);
    const selectedAllowedAgents = Array.isArray(subagents.allowAgents) ? subagents.allowAgents : (subagents.allowAgents = []);
    const candidateModelRefs = Array.isArray(agent.candidateModelRefs) ? agent.candidateModelRefs : (agent.candidateModelRefs = []);
    const toolsetKeys = this.ensureAgentToolsetKeys(agent);
    const appliedToolsets = this.getAgentAppliedToolsets(agent);
    const effectiveToolState = this.getEffectiveAgentToolState(agent);
    const directToolOverrides = this.normalizeAgentToolOverrides(agent) || { allow: [], deny: [] };
    const directAllowedTools = this.normalizeToolNameList(directToolOverrides.allow);
    const directDeniedTools = this.normalizeToolNameList(directToolOverrides.deny);
    const availableAgentToolsets = this.getToolsetsList().filter((toolset: any) => toolset.key !== 'minimal' && !toolsetKeys.includes(toolset.key));
    const availableDirectAllowOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !directAllowedTools.includes(option.id));
    const availableDirectDenyOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !directDeniedTools.includes(option.id));
    const sandboxModeOverride = typeof agent.sandboxMode === 'string' ? agent.sandboxMode : '';
    const forceSandboxOff = sandboxModeOverride === 'off';
    const telegramRoutesForAgent = this.getTelegramRoutesForAgent(String(agent.id || ''));

    return html`
        <div class="card">
            <div class="card-header">
                <h3>Edit Agent: ${agent.name}</h3>
                <button class="btn btn-ghost" @click=${() => this.closeEditingAgentEditor()}>Back to List</button>
            </div>

            <div class="card" style="margin-bottom: 20px; border-color: ${agent.enabled ? '#00bcd4' : '#f44336'};">
                <div class="card-header"><h3>Agent Status</h3></div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label class="toggle-switch" style="font-size: 1rem; font-weight: 700; color: #fff;">
                        <input type="checkbox" ?checked=${!!agent.enabled} @change=${(e: any) => { agent.enabled = e.target.checked; this.requestUpdate(); }}>
                        Enable this Agent
                    </label>
                    <div class="help-text">${agent.enabled ? 'This agent is available for toolkit-managed OpenClaw configuration.' : 'Disabled agents stay in toolkit config only and are not propagated into live OpenClaw config.'}</div>
                </div>
            </div>

            ${telegramRoutesForAgent.length > 0 ? html`
              <div class="card" style="margin-bottom: 20px; border-color: #5c6bc0;">
                <div class="card-header">
                  <h3>Telegram Routing</h3>
                  <span class="badge">Inbound</span>
                </div>
                <div class="help-text" style="margin-top: 0; margin-bottom: 10px;">This agent is currently the managed Telegram target for:</div>
                ${telegramRoutesForAgent.map((route: any) => html`
                  <div class="applied-toolset-card" style="margin-bottom: 10px;">
                    <div class="applied-toolset-header">
                      <strong>${String(route?.accountId || this.getDefaultTelegramAccountId())}</strong>
                      <span class="badge">Telegram</span>
                    </div>
                    <div class="toolset-preview-rows">
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Route</div>
                          <div class="toolset-preview-tags">
                          ${String(route?.matchType || '').toLowerCase() === 'trusted-dms' ? html`<div class="tag">Trusted DMs</div>` : ''}
                          ${String(route?.matchType || '').toLowerCase() === 'trusted-groups' ? html`<div class="tag">Trusted Groups</div>` : ''}
                          ${String(route?.matchType || '').toLowerCase() === 'group' ? html`<div class="tag">Group ${route?.peerId || '(missing id)'}</div>` : ''}
                          ${String(route?.matchType || '').toLowerCase() === 'direct' ? html`<div class="tag">DM ${route?.peerId || '(missing id)'}</div>` : ''}
                          ${!route?.matchType ? html`<div class="toolset-preview-empty">No inbound Telegram route details available.</div>` : ''}
                          </div>
                        </div>
                      </div>
                  </div>
                `)}
                <div class="help-text" style="margin-top: 8px;">Change these routes on <strong>Configuration -> Features -> Telegram</strong>.</div>
              </div>
            ` : ''}
            
            <div class="grid-2">
                <div class="form-group">
                    <label>Display Name</label>
                    <input type="text" .value=${agent.name} @input=${(e: any) => { agent.name = e.target.value; this.requestUpdate(); }}>
                </div>
                <div class="form-group">
                    <label>Agent ID</label>
                    <input type="text" .value=${agent.id} ?disabled=${isMain} @input=${(e: any) => {
                        agent.id = e.target.value;
                        this.requestUpdate();
                    }}>
                    ${agentIdValidationError ? html`<div class="help-text" style="color: #f44336;">${agentIdValidationError}</div>` : ''}
                </div>
            </div>

            <div class="form-group">
                <label>Endpoint</label>
                <select @change=${(e: any) => {
                    const endpointKey = e.target.value || null;
                    this.setAgentEndpointAssignment(agent, endpointKey);
                    this.requestUpdate();
                }}>
                    <option value="">Select Endpoint</option>
                    ${endpoints.map((ep: any) => html`<option value=${ep.key} ?selected=${effectiveEndpointKey === ep.key}>${ep.key}</option>`)}
                </select>
            </div>

            <div class="grid-2">
                <div class="card" style="margin-bottom: 0;">
                    <div class="card-header"><h3>Home Workspace</h3></div>
                    <div class="help-text" style="margin-top: 0;">This is the agent's home base. OpenClaw uses the configured workspace path directly, so it does not need to match the agent ID.</div>
                    <div style="color: #fff; margin-top: 10px;">${primaryWorkspace ? this.getWorkspaceDisplayLabel(primaryWorkspace) : 'No primary workspace assigned yet.'}</div>
                    ${primaryWorkspace ? html`
                      <div class="help-text" style="margin-top: 10px;">${this.getWorkspaceHomeBaseDescription(primaryWorkspace)} at <code>${primaryWorkspace.path || '(unset path)'}</code>.</div>
                    ` : ''}
                    ${primaryWorkspace?.mode === 'private' && accessibleSharedWorkspaces.length > 0 ? html`
                      <div class="help-text" style="margin-top: 10px;">Shared collaboration access: ${accessibleSharedWorkspaces.map((workspace: any) => workspace.name || workspace.id).join(', ')}. Because this reaches beyond the private home base, the toolkit keeps sandbox off for this agent.</div>
                    ` : ''}
                    ${primaryWorkspace?.mode === 'private' && accessibleSharedWorkspaces.length === 0 ? html`
                      <div class="help-text" style="margin-top: 10px;">This private workspace currently has no shared collaboration workspaces attached, so the toolkit keeps the agent sandboxed to the home base.</div>
                    ` : ''}
                    ${primaryWorkspace?.mode === 'shared' ? html`
                      <div class="help-text" style="margin-top: 10px;">Shared workspaces are collaboration areas rather than private boundaries, so the toolkit keeps sandbox off for agents living here.</div>
                    ` : ''}
                    <div style="margin-top: 12px;">
                      <button class="btn btn-ghost" @click=${() => { this.editingWorkspaceId = primaryWorkspace?.id || null; this.configSection = 'workspaces'; }}>Open Workspaces Tab</button>
                    </div>
                </div>
                <div class="card" style="margin-bottom: 0;">
                    <div class="card-header"><h3>Sandbox Mode</h3></div>
                    <label class="toggle-switch">
                        <input type="checkbox" ?checked=${forceSandboxOff} @change=${(e: any) => {
                            if (e.target.checked) {
                                agent.sandboxMode = 'off';
                            } else {
                                delete agent.sandboxMode;
                            }
                            this.requestUpdate();
                        }}>
                        Force sandbox off for this agent
                    </label>
                    <div class="help-text">Turn this off to use the global sandbox default instead of an explicit agent override.</div>
                    ${sandboxModeOverride && sandboxModeOverride !== 'off'
                      ? html`<div class="help-text" style="color: #ff9800;">This agent currently has custom sandbox mode "${sandboxModeOverride}". Using the toggle will replace that custom mode with the toolkit's off/default behavior.</div>`
                      : ''}
                </div>
            </div>

            <div class="form-group">
                <label>Primary Model</label>
                <select ?disabled=${!selectedEndpoint || endpointModelOptions.length === 0} @change=${(e: any) => {
                    agent.modelRef = e.target.value;
                    this.syncAgentModelSource(agent);
                    this.requestUpdate();
                }}>
                    <option value="">${selectedEndpoint ? 'Select Endpoint Model' : 'Choose an endpoint first'}</option>
                    ${endpointModelOptions.map((option: any) => html`
                        <option value=${option.ref} ?selected=${agent.modelRef === option.ref}>${option.kind === 'local' ? '[Local]' : '[Hosted]'} ${option.label}</option>
                    `)}
                </select>
                ${selectedEndpoint && endpointModelOptions.length === 0 ? html`<p style="color: #f44336; font-size: 0.7rem; margin-top: 4px;">This endpoint has no models configured yet. Add local or hosted models on the Endpoints tab first.</p>` : ''}
                ${selectedEndpoint && endpointModelOptions.length > 0 ? html`<p style="color: #888; font-size: 0.75rem; margin-top: 4px;">Primary and candidate models are limited to the currently selected endpoint.</p>` : ''}
            </div>

            <div class="card" style="margin-top: 20px; margin-bottom: 20px;">
                <div class="card-header"><h3>Subagents</h3></div>
                <div class="form-group">
                    <label class="toggle-switch">
                        <input type="checkbox" ?checked=${!!subagents.enabled} @change=${(e: any) => {
                            subagents.enabled = e.target.checked;
                            this.requestUpdate();
                        }}>
                        Enable spawning subagents from this agent
                    </label>
                </div>
                <div class="form-group">
                    <label class="toggle-switch">
                        <input type="checkbox" ?checked=${!!subagents.requireAgentId} @change=${(e: any) => { subagents.requireAgentId = e.target.checked; this.requestUpdate(); }}>
                        Require explicit agent ID when spawning subagents
                    </label>
                </div>
                <div class="form-group">
                    <label>Allowed Agent IDs</label>
                    <div class="tag-list">
                        ${selectedAllowedAgents.map((agentId: string, idx: number) => html`
                            <div class="tag">
                                ${agentId}
                                <span class="tag-remove" @click=${() => {
                                    selectedAllowedAgents.splice(idx, 1);
                                    this.requestUpdate();
                                }}>×</span>
                            </div>
                        `)}
                    </div>
                    <div style="margin-top: 10px;">
                        <select @change=${(e: any) => {
                            const value = e.target.value;
                            if (value && !selectedAllowedAgents.includes(value)) {
                                selectedAllowedAgents.push(value);
                                this.requestUpdate();
                            }
                            e.target.value = '';
                        }}>
                            <option value="">${allowedAgentChoices.length === 0 ? 'No other configured agents available' : '+ Add Allowed Agent'}</option>
                            ${allowedAgentChoices
                                .filter((choice: any) => !selectedAllowedAgents.includes(choice.id))
                                .map((choice: any) => html`<option value=${choice.id}>${choice.label}</option>`)}
                        </select>
                    </div>
                    <p style="color: #888; font-size: 0.75rem; margin-top: 6px;">Leave the list empty to keep the toolkit defaults.</p>
                </div>
            </div>

            <div class="form-group">
                <label>Candidate Models</label>
                <div class="tag-list">
                    ${(agent.candidateModelRefs || []).map((ref: string, idx: number) => html`
                        <div class="tag">
                            ${ref}
                            <span class="tag-remove" @click=${() => { agent.candidateModelRefs.splice(idx, 1); this.requestUpdate(); }}>×</span>
                        </div>
                    `)}
                </div>
                <div style="margin-top: 10px;">
                    <select ?disabled=${!selectedEndpoint || endpointModelOptions.length === 0} @change=${(e: any) => {
                        const value = e.target.value;
                        if (value) {
                            if (!agent.candidateModelRefs) agent.candidateModelRefs = [];
                            if (!agent.candidateModelRefs.includes(value)) {
                                agent.candidateModelRefs.push(value);
                                this.syncAgentModelSource(agent);
                                this.requestUpdate();
                            }
                            e.target.value = '';
                        }
                    }}>
                        <option value="">${selectedEndpoint ? '+ Add Endpoint Model' : 'Choose an endpoint first'}</option>
                        ${endpointModelOptions
                            .filter((option: any) => !candidateModelRefs.includes(option.ref))
                            .map((option: any) => html`<option value=${option.ref}>${option.kind === 'local' ? '[Local]' : '[Hosted]'} ${option.label}</option>`)}
                    </select>
                </div>
            </div>

            <div class="card" style="margin-top: 20px; margin-bottom: 20px;">
                <div class="card-header"><h3>Toolsets</h3></div>
                <div class="help-text" style="margin-top: 0; margin-bottom: 14px;">The global <code>minimal</code> toolset is always applied first. Toolsets lower in the list win when the same tool is both allowed and denied.</div>

                <div class="form-group">
                    <label>Applied Toolsets</label>
                    <div class="applied-toolset-list">
                        ${appliedToolsets.map((toolset: any) => {
                          const isMinimal = toolset.key === 'minimal';
                          const agentToolsetIndex = isMinimal ? -1 : toolsetKeys.indexOf(toolset.key);
                          const allowedTools = this.normalizeToolNameList(toolset.allow);
                          const deniedTools = this.normalizeToolNameList(toolset.deny);
                          return html`
                            <div class="applied-toolset-card">
                              <div class="applied-toolset-header">
                                <strong>${toolset.name || toolset.key}</strong>
                                ${isMinimal ? html`<span class="badge">Global</span>` : ''}
                                ${!isMinimal ? html`
                                  <button class="btn btn-ghost" style="padding: 2px 6px;" ?disabled=${agentToolsetIndex <= 0} @click=${() => this.moveAgentToolset(agent, agentToolsetIndex, -1)}>Up</button>
                                  <button class="btn btn-ghost" style="padding: 2px 6px;" ?disabled=${agentToolsetIndex < 0 || agentToolsetIndex >= toolsetKeys.length - 1} @click=${() => this.moveAgentToolset(agent, agentToolsetIndex, 1)}>Down</button>
                                  <button class="btn btn-danger" style="padding: 2px 6px;" @click=${() => { agent.toolsetKeys.splice(agentToolsetIndex, 1); this.requestUpdate(); }}>Remove</button>
                                ` : ''}
                              </div>
                              <div class="toolset-preview-rows">
                                <div class="toolset-preview-row">
                                  <div class="toolset-preview-label">Allow</div>
                                  ${allowedTools.length === 0
                                    ? html`<div class="toolset-preview-empty">No allowed tools.</div>`
                                    : html`
                                      <div class="toolset-preview-tags">
                                        ${allowedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                                      </div>
                                    `}
                                </div>
                                <div class="toolset-preview-row">
                                  <div class="toolset-preview-label">Deny</div>
                                  ${deniedTools.length === 0
                                    ? html`<div class="toolset-preview-empty">No denied tools.</div>`
                                    : html`
                                      <div class="toolset-preview-tags">
                                        ${deniedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                                      </div>
                                    `}
                                </div>
                              </div>
                            </div>
                          `;
                        })}
                    </div>
                    <div style="margin-top: 10px;">
                        <select @change=${(e: any) => {
                          const value = e.target.value;
                          if (value) {
                            this.addAgentToolset(agent, value);
                            e.target.value = '';
                          }
                        }}>
                            <option value="">${availableAgentToolsets.length === 0 ? 'No other toolsets available' : '+ Add toolset'}</option>
                            ${availableAgentToolsets.map((toolset: any) => html`
                              <option value=${toolset.key}>${toolset.name || toolset.key} - ${this.getToolsetPreviewText(toolset)}</option>
                            `)}
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label>Direct Tool Overrides</label>
                    <div class="applied-toolset-card">
                      <div class="applied-toolset-header">
                        <strong>Direct Tool Overrides</strong>
                        <span class="badge">Final Layer</span>
                      </div>
                      <div class="toolset-preview-rows">
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Allow</div>
                          ${directAllowedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No direct allow overrides.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${directAllowedTools.map((toolId: string) => html`
                                  <div class="tag">
                                    ${this.renderToolLabel(toolId)}
                                    <span class="tag-remove" @click=${() => this.removeAgentToolOverride(agent, 'allow', toolId)}>×</span>
                                  </div>
                                `)}
                              </div>
                            `}
                          <div style="margin-top: 6px;">
                            <select @change=${(e: any) => {
                              const value = e.target.value;
                              if (value) {
                                this.addAgentToolOverride(agent, 'allow', value);
                                e.target.value = '';
                              }
                            }}>
                              <option value="">+ Add allowed tool override</option>
                              ${availableDirectAllowOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`)}
                            </select>
                          </div>
                        </div>
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Deny</div>
                          ${directDeniedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No direct deny overrides.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${directDeniedTools.map((toolId: string) => html`
                                  <div class="tag">
                                    ${this.renderToolLabel(toolId)}
                                    <span class="tag-remove" @click=${() => this.removeAgentToolOverride(agent, 'deny', toolId)}>×</span>
                                  </div>
                                `)}
                              </div>
                            `}
                          <div style="margin-top: 6px;">
                            <select @change=${(e: any) => {
                              const value = e.target.value;
                              if (value) {
                                this.addAgentToolOverride(agent, 'deny', value);
                                e.target.value = '';
                              }
                            }}>
                              <option value="">+ Add denied tool override</option>
                              ${availableDirectDenyOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`)}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="help-text" style="margin-top: 8px;">These direct per-agent tool picks merge after all applied toolsets, so they are the easiest way to make one-off tweaks.</div>
                </div>

                <div class="form-group">
                    <label>Combined Toolset</label>
                    <div class="applied-toolset-card">
                      <div class="applied-toolset-header">
                        <strong>Combined Toolset</strong>
                        <span class="badge">Final</span>
                      </div>
                      <div class="toolset-preview-rows">
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Allow</div>
                          ${effectiveToolState.allowedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No tools allowed yet.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${effectiveToolState.allowedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                              </div>
                            `}
                        </div>
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Deny</div>
                          ${effectiveToolState.deniedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No explicit denies.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${effectiveToolState.deniedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                              </div>
                            `}
                        </div>
                      </div>
                    </div>
                </div>

                ${effectiveToolState.explicitTools ? html`
                  <div class="help-text" style="margin-top: 0;">This agent also has a raw <code>tools</code> block in config. Those direct OpenClaw overrides still apply after the combined toolkit toolset shown above.</div>
                ` : ''}
            </div>

            <div class="card" style="margin-top: 20px; margin-bottom: 20px;">
                <div class="card-header"><h3>Agent Bootstrap Markdown</h3></div>
                <p class="help-text">Custom markdown for this agent is stored in <code>openclaw-toolkit\\agents\\${agent.id || 'agent-id'}\\bootstrap\\</code>. Shared templates come from <code>openclaw-toolkit\\markdown-templates\\agents\\&lt;TYPE&gt;\\</code>. The selected effective files are copied into <code>.openclaw\\agents\\${agent.id || 'agent-id'}\\bootstrap\\</code> as agent-specific bootstrap overlays. Workspace-only lifecycle files such as <code>BOOT.md</code> and one-time <code>BOOTSTRAP.md</code> live on the workspace page instead.</p>
                ${VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES.map((fileName) => {
                    const selectedTemplateKey = this.getMarkdownTemplateSelection(agent, fileName, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
                    const templateKeys = this.getMarkdownTemplateKeys('agents', fileName);
                    const isTemplateMode = selectedTemplateKey.length > 0;
                    const effectiveValue = isTemplateMode
                      ? this.getMarkdownTemplateContent('agents', fileName, selectedTemplateKey)
                      : (agentTemplateFiles[fileName] || '');
                    return html`
                      <div class="form-group">
                          <label>${fileName}</label>
                          <div class="help-text" style="margin-top: 0; margin-bottom: 6px;">${this.getMarkdownFileHelpText(fileName, 'agent')}</div>
                          <select style="margin-bottom: 8px;" @change=${(e: any) => {
                              const value = e.target.value;
                              this.setMarkdownTemplateSelection(agent, fileName, value || null, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
                              this.requestUpdate();
                          }}>
                              <option value="">Custom markdown</option>
                              ${templateKeys.map((templateKey) => html`<option value=${templateKey} ?selected=${selectedTemplateKey === templateKey}>Template: ${templateKey}</option>`)}
                          </select>
                          ${isTemplateMode ? html`<div class="help-text" style="margin-top: 0; margin-bottom: 6px;">Using template <code>${selectedTemplateKey}</code>. Switch to Custom markdown to edit agent-specific content without changing the shared template.</div>` : ''}
                          <textarea rows=${this.getMarkdownEditorRows(fileName)} .value=${effectiveValue} ?readonly=${isTemplateMode} placeholder=${isTemplateMode ? '' : this.buildAgentBootstrapPlaceholder(agent, fileName)} @input=${(e: any) => {
                              if (!isTemplateMode) {
                                agentTemplateFiles[fileName] = e.target.value;
                                this.requestUpdate();
                              }
                          }}></textarea>
                      </div>
                    `;
                })}
            </div>
        </div>
    `;
  }

  renderFeaturesConfig() {
      return html`
        <div class="tabs">
          <div class="tab ${this.featureSubsection === 'telegram' ? 'active' : ''}" @click=${() => this.featureSubsection = 'telegram'}>Telegram</div>
          <div class="tab ${this.featureSubsection === 'voice' ? 'active' : ''}" @click=${() => this.featureSubsection = 'voice'}>Voice</div>
        </div>
        ${this.featureSubsection === 'telegram'
          ? this.renderTelegramFeaturesConfig()
          : this.renderVoiceFeaturesConfig()}
      `;
  }

  renderWorkspacesConfig() {
    if (this.editingWorkspaceId) {
      return this.renderWorkspaceEditor(this.editingWorkspaceId);
    }

    const workspaces = this.getWorkspaces();
    return html`
      <div class="card">
        <div class="card-header">
          <h3>Workspaces</h3>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-ghost" @click=${() => this.addWorkspace('shared')}>+ Shared Workspace</button>
            <button class="btn btn-ghost" @click=${() => this.addWorkspace('private')}>+ Private Workspace</button>
          </div>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Workspaces define the agent home base. Shared workspaces can host many agents and are collaboration areas. Private workspaces host one agent, act as the privacy boundary, and can optionally expose specific shared collaboration workspaces.</p>
        ${workspaces.map((workspace: any) => {
          const occupantIds = this.getWorkspaceAgentIds(workspace);
          const occupants = this.getManagedAgentEntries().filter(({ agent }: any) => occupantIds.includes(String(agent?.id || '')));
          const sharedAccessLabels = workspace.mode === 'private'
            ? this.getWorkspaceSharedAccessIds(workspace)
                .map((workspaceId: string) => this.getWorkspaceById(workspaceId))
                .filter(Boolean)
                .map((candidate: any) => candidate.name || candidate.id)
            : [];
          return html`
            <div class="item-row">
              <div class="item-info">
                <span class="item-title">${workspace.name || workspace.id}</span>
                <span class="item-sub">
                  ID: ${workspace.id} | Mode: ${workspace.mode} | Home Base Path: ${workspace.path || '(unset)'} | Occupants: ${occupants.length > 0 ? occupants.map(({ agent }: any) => agent.name || agent.id).join(', ') : 'none'}
                  ${workspace.mode === 'private' ? ` | Shared access: ${sharedAccessLabels.length > 0 ? sharedAccessLabels.join(', ') : 'none'}` : ''}
                </span>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-secondary" @click=${() => this.editingWorkspaceId = workspace.id}>Configure</button>
                <button class="btn btn-danger" @click=${() => this.removeWorkspaceById(workspace.id)}>Remove</button>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  renderWorkspaceEditor(workspaceId: string) {
    const workspace = this.getWorkspaceById(workspaceId);
    if (!workspace) return html`Workspace not found`;

    const previousWorkspaceId = String(workspace?.id || '');
    const occupantIds = this.getWorkspaceAgentIds(workspace);
    const occupantEntries = this.getManagedAgentEntries().filter(({ agent }: any) => occupantIds.includes(String(agent?.id || '')));
    const sharedWorkspaces = this.getSharedWorkspaces().filter((candidate: any) => candidate.id !== workspace.id);
    const availableAgents = this.getManagedAgentEntries().filter(({ agent }: any) => {
      const agentId = String(agent?.id || '');
      const assignedWorkspace = this.getWorkspaceForAgentId(agentId);
      return agentId.length > 0 && (!assignedWorkspace || assignedWorkspace.id === workspace.id);
    });
    const selectedSharedAccessIds = this.getWorkspaceSharedAccessIds(workspace);

    return html`
        <div class="card">
          <div class="card-header">
            <h3>Workspace: ${workspace.name || workspace.id}</h3>
            <button class="btn btn-ghost" @click=${() => this.editingWorkspaceId = null}>Back to Workspaces</button>
          </div>

        <div class="card" style="margin-bottom: 20px; border-color: ${workspace.mode === 'private' ? '#90caf9' : '#81c784'};">
          <div class="card-header"><h3>Home Base Rules</h3></div>
          <div class="help-text" style="margin-top: 0;">
            <strong>${workspace.mode === 'private' ? 'Private workspace' : 'Shared workspace'}:</strong>
            ${workspace.mode === 'private'
              ? 'this is the agent home base and privacy boundary. With no shared access attached, the toolkit forces sandbox on with workspace-write mode.'
              : 'this is a collaboration area, not a private boundary. The toolkit forces sandbox off for agents who live here so they can work beyond a single private home-base path.'}
          </div>
          <div class="help-text" style="margin-top: 10px;">
            OpenClaw uses the exact configured workspace path directly. It does not require the private workspace name or path to match the agent ID.
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label>Workspace Name</label>
            <input type="text" .value=${workspace.name || ''} @input=${(e: any) => { workspace.name = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Workspace ID</label>
            <input type="text" .value=${workspace.id || ''} @input=${(e: any) => {
              const nextId = e.target.value;
              this.renameWorkspaceIdEverywhere(previousWorkspaceId, nextId);
              workspace.id = nextId;
              this.requestUpdate();
            }}>
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label>Workspace Mode</label>
            <select @change=${(e: any) => {
              const nextMode = e.target.value === 'private' ? 'private' : 'shared';
              if (nextMode === 'private' && workspace.mode !== 'private' && this.getWorkspaceAgentIds(workspace).length > 1) {
                alert('A private workspace can only host one primary agent. Move the extra agents to other workspaces first.');
                e.target.value = workspace.mode;
                return;
              }
              workspace.mode = nextMode;
              if (workspace.mode === 'shared') {
                workspace.sharedWorkspaceIds = [];
              } else if (!Array.isArray(workspace.sharedWorkspaceIds)) {
                workspace.sharedWorkspaceIds = [];
              }
              this.normalizeWorkspaceAssignments(this.config);
              const messages = occupantEntries
                .map(({ agent }: any) => this.enforceWorkspaceSandboxPolicy(agent, workspace))
                .filter((message: string) => message.length > 0);
              if (messages.length > 0) {
                alert(messages.join('\n\n'));
              }
              this.requestUpdate();
            }}>
              <option value="shared" ?selected=${workspace.mode === 'shared'}>shared</option>
              <option value="private" ?selected=${workspace.mode === 'private'}>private</option>
            </select>
          </div>
          <div class="form-group">
            <label>${workspace.mode === 'private' ? 'Home Workspace Path' : 'Shared Workspace Path'}</label>
            <input type="text" .value=${workspace.path || ''} @input=${(e: any) => { workspace.path = e.target.value; this.requestUpdate(); }}>
            <div class="help-text">This exact path becomes the workspace home base path used by OpenClaw. It can be any valid path; it does not need to match the agent name.</div>
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${!!workspace.enableAgentToAgent} @change=${(e: any) => { workspace.enableAgentToAgent = e.target.checked; this.requestUpdate(); }}>
              Enable agent-to-agent tool in this workspace
            </label>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${!!workspace.manageWorkspaceAgentsMd} @change=${(e: any) => { workspace.manageWorkspaceAgentsMd = e.target.checked; this.requestUpdate(); }}>
              Manage workspace markdown files
            </label>
            <div class="help-text">Workspace markdown lives under <code>openclaw-toolkit\\workspaces\\${workspace.id || '&lt;workspaceId&gt;'}\\markdown\\</code>.</div>
          </div>
        </div>

        ${workspace.mode === 'shared' ? html`
          <div class="form-group">
            <label>Primary Agents in this Shared Workspace</label>
            <div class="help-text" style="margin-bottom: 10px;">Assigning an agent here makes this shared workspace the agent's home base and forces sandbox off so collaboration is not blocked by a private workspace restriction.</div>
            <div class="tag-list">
              ${occupantEntries.map(({ agent }: any) => html`
                <div class="tag">
                  ${agent.name || agent.id}
                  <span class="tag-remove" @click=${() => this.setAgentPrimaryWorkspace(agent.id, null)}>×</span>
                </div>
              `)}
            </div>
            <div style="margin-top: 10px;">
              <select @change=${(e: any) => {
                const agentId = e.target.value;
                if (agentId) {
                  this.setAgentPrimaryWorkspace(agentId, workspace.id);
                }
                e.target.value = '';
              }}>
                <option value="">${availableAgents.length === 0 ? 'No unassigned agents available' : '+ Add Agent to Shared Workspace'}</option>
                ${availableAgents
                  .filter(({ agent }: any) => !occupantIds.includes(String(agent?.id || '')))
                  .map(({ agent }: any) => html`<option value=${agent.id}>${agent.name || agent.id}</option>`)}
              </select>
            </div>
          </div>
        ` : html`
          <div class="grid-2">
            <div class="form-group">
              <label>Primary Agent in this Private Workspace</label>
              <select @change=${(e: any) => {
                const agentId = e.target.value;
                if (agentId) {
                  this.setAgentPrimaryWorkspace(agentId, workspace.id);
                } else {
                  workspace.agents = [];
                  this.requestUpdate();
                }
              }}>
                <option value="">No primary agent assigned</option>
                ${availableAgents.map(({ agent }: any) => html`
                  <option value=${agent.id} ?selected=${occupantIds.includes(String(agent?.id || ''))}>${agent.name || agent.id}</option>
                `)}
              </select>
              <div class="help-text">A private workspace can host only one primary agent at a time. If that agent was previously sandbox-off, the toolkit turns sandbox back on with workspace-write mode unless shared collaboration access is attached below.</div>
            </div>
            <div class="form-group">
              <label>Shared Workspaces Accessible from this Private Workspace</label>
              <div class="help-text" style="margin-bottom: 10px;">Granting shared collaboration access means the agent must reach paths outside its private home base, so the toolkit will turn sandbox off for the occupying agent.</div>
              <div class="tag-list">
                ${selectedSharedAccessIds.map((sharedWorkspaceId: string) => {
                  const sharedWorkspace = this.getWorkspaceById(sharedWorkspaceId);
                  if (!sharedWorkspace) return null;
                  return html`
                    <div class="tag">
                      ${sharedWorkspace.name || sharedWorkspace.id}
                      <span class="tag-remove" @click=${() => {
                        this.setWorkspaceSharedAccess(workspace, selectedSharedAccessIds.filter((candidateId: string) => candidateId !== sharedWorkspaceId));
                      }}>×</span>
                    </div>
                  `;
                })}
              </div>
              <div style="margin-top: 10px;">
                <select @change=${(e: any) => {
                  const selectedId = e.target.value;
                  if (selectedId && !selectedSharedAccessIds.includes(selectedId)) {
                    this.setWorkspaceSharedAccess(workspace, [...selectedSharedAccessIds, selectedId]);
                  }
                  e.target.value = '';
                }}>
                  <option value="">${sharedWorkspaces.length === 0 ? 'No shared workspaces available' : '+ Grant Shared Workspace Access'}</option>
                  ${sharedWorkspaces
                    .filter((candidate: any) => !selectedSharedAccessIds.includes(String(candidate?.id || '')))
                    .map((candidate: any) => html`<option value=${candidate.id}>${candidate.name || candidate.id}</option>`)}
                </select>
              </div>
            </div>
          </div>
        `}

        <div class="card" style="margin-top: 20px;">
          <div class="card-header"><h3>Workspace Markdown</h3></div>
          <p class="help-text">Custom markdown for this workspace is stored in <code>openclaw-toolkit\\workspaces\\${workspace.id || '&lt;workspaceId&gt;'}\\markdown\\</code>. Shared templates come from <code>openclaw-toolkit\\markdown-templates\\workspaces\\&lt;TYPE&gt;\\</code>. The selected effective files are synced into the live workspace home base. <code>BOOT.md</code> is a startup checklist. <code>BOOTSTRAP.md</code> is a one-time first-run ritual and is only seeded when the workspace is brand new or the live file still exists.</p>
          ${VALID_WORKSPACE_MARKDOWN_FILES.map((fileName) => {
            const selectedTemplateKey = this.getMarkdownTemplateSelection(workspace, fileName, VALID_WORKSPACE_MARKDOWN_FILES);
            const templateKeys = this.getMarkdownTemplateKeys('workspaces', fileName);
            const isTemplateMode = selectedTemplateKey.length > 0;
            const workspaceFiles = this.ensureWorkspaceTemplateFiles(workspace);
            const effectiveValue = isTemplateMode
              ? this.getMarkdownTemplateContent('workspaces', fileName, selectedTemplateKey)
              : (workspaceFiles[fileName] || '');
            return html`
              <div class="form-group" style="margin-bottom: 20px;">
                <label>${fileName}</label>
                <div class="help-text" style="margin-top: 0; margin-bottom: 6px;">${this.getMarkdownFileHelpText(fileName, 'workspace')}</div>
                <select style="margin-bottom: 8px;" @change=${(e: any) => {
                  const value = e.target.value;
                  this.setMarkdownTemplateSelection(workspace, fileName, value || null, VALID_WORKSPACE_MARKDOWN_FILES);
                  this.requestUpdate();
                }}>
                  <option value="">Custom markdown</option>
                  ${templateKeys.map((templateKey) => html`<option value=${templateKey} ?selected=${selectedTemplateKey === templateKey}>Template: ${templateKey}</option>`)}
                </select>
                ${isTemplateMode ? html`<div class="help-text" style="margin-top: 0; margin-bottom: 6px;">Using template <code>${selectedTemplateKey}</code>. Switch to Custom markdown to edit workspace-specific content without changing the shared template.</div>` : ''}
                <textarea rows=${this.getMarkdownEditorRows(fileName)} .value=${effectiveValue} ?readonly=${isTemplateMode} placeholder=${isTemplateMode ? '' : this.buildWorkspaceBootstrapPlaceholder(workspace, fileName)} @input=${(e: any) => {
                  if (!isTemplateMode) {
                    workspaceFiles[fileName] = e.target.value;
                    this.requestUpdate();
                  }
                }}></textarea>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  // Helpers
  addAgent() {
      this.startNewAgentDraft();
  }

  addExtraAgent() {
      this.addAgent();
  }

  removeAgentByKey(key: string) {
      const entry = this.getManagedAgentEntries().find((candidate: any) => candidate.key === key);
      if (!entry?.agent?.id) {
          return;
      }

      if (!this.canRemoveAgent(key, entry.agent)) {
          alert('The main agent cannot be removed from the dashboard.');
          return;
      }

      const label = entry.agent.name ? `${entry.agent.name} (${entry.agent.id})` : entry.agent.id;
      if (!confirm(`Remove agent ${label}?`)) {
          return;
      }

      this.removeAgentReferences(entry.agent.id);
      if (this.templateFiles?.agents?.[entry.agent.id]) {
          delete this.templateFiles.agents[entry.agent.id];
      }

      if (Array.isArray(this.config?.agents?.list)) {
          const idx = this.config.agents.list.findIndex((candidate: any) => candidate === entry.agent || String(candidate?.id || '') === String(entry.agent.id || ''));
          if (idx >= 0) {
              this.config.agents.list.splice(idx, 1);
          }
      }

      if (this.editingAgentKey === key) {
          this.editingAgentKey = null;
      }

      this.requestUpdate();
  }

  addWorkspace(mode: 'shared' | 'private') {
    const workspaceId = `${mode === 'shared' ? 'shared' : 'workspace'}-${Date.now()}`;
    if (!Array.isArray(this.config?.workspaces)) {
      this.config.workspaces = [];
    }
    const workspace = {
      id: workspaceId,
      name: mode === 'shared' ? 'New Shared Workspace' : 'New Private Workspace',
      mode,
      path: mode === 'shared' && this.getSharedWorkspaces().length === 0
        ? '/home/node/.openclaw/workspace'
        : `/home/node/.openclaw/${workspaceId}`,
      markdownTemplateKeys: mode === 'shared' && this.getMarkdownTemplateContent('workspaces', 'AGENTS.md', 'sharedWorkspace')
        ? { 'AGENTS.md': 'sharedWorkspace' }
        : {},
      enableAgentToAgent: false,
      manageWorkspaceAgentsMd: false,
      sharedWorkspaceIds: [],
      agents: []
    };
    this.config.workspaces.push(workspace);
    this.ensureWorkspaceTemplateFiles(workspace);
    this.editingWorkspaceId = workspace.id;
    this.requestUpdate();
  }

  removeWorkspaceById(workspaceId: string) {
    const workspace = this.getWorkspaceById(workspaceId);
    if (!workspace) {
      return;
    }

    const label = workspace.name ? `${workspace.name} (${workspace.id})` : workspace.id;
    if (!confirm(`Remove workspace ${label}?`)) {
      return;
    }

    this.config.workspaces = this.getWorkspaces().filter((candidate: any) => candidate.id !== workspaceId);
    for (const candidate of this.config.workspaces) {
      if (Array.isArray(candidate?.sharedWorkspaceIds)) {
        candidate.sharedWorkspaceIds = candidate.sharedWorkspaceIds.filter((candidateId: string) => candidateId !== workspaceId);
      }
    }
    if (this.templateFiles?.workspaces?.[workspaceId]) {
      delete this.templateFiles.workspaces[workspaceId];
    }
    if (this.editingWorkspaceId === workspaceId) {
      this.editingWorkspaceId = null;
    }
    this.normalizeWorkspaceAssignments(this.config);
    this.requestUpdate();
  }

  addEndpoint() {
    const key = prompt('Endpoint Key:');
    if (key) {
        if (!this.config.endpoints) this.config.endpoints = [];
        this.config.endpoints.push({
            key,
            default: this.getConfigEndpoints().length === 0,
            agents: [],
            hostedModels: [],
            ollama: {
                enabled: true,
                providerId: key === 'local' ? 'ollama' : `ollama-${key}`,
                hostBaseUrl: 'http://127.0.0.1:11434',
                baseUrl: 'http://host.docker.internal:11434',
                apiKey: key === 'local' ? 'ollama-local' : `ollama-${key}`,
                autoPullMissingModels: true,
                models: []
            }
        });
        this.requestUpdate();
    }
  }

  removeEndpointByKey(key: string) {
    const endpoint = this.getConfigEndpoints().find((candidate: any) => candidate.key === key);
    if (!endpoint) {
        return;
    }
    if (!this.canRemoveEndpoint(endpoint)) {
        alert('The default endpoint cannot be removed from the dashboard.');
        return;
    }
    if (confirm('Remove endpoint?')) {
        this.config.endpoints = this.getConfigEndpoints().filter((endpoint: any) => endpoint.key !== key);
        this.requestUpdate();
    }
  }

  addModel() {
      const id = prompt('Model ID:');
      if (id) {
          const models = this.ensureSharedModelCatalog();
          if (models.some((model: any) => model.id === id)) {
              alert(`Model "${id}" is already in the catalog.`);
              return;
          }
          models.push({ id, input: ['text'], minimumContextWindow: 24576 });
          this.requestUpdate();
      }
  }

  addHostedModel() {
      const modelRef = prompt('Hosted model ref (e.g. openai-codex/gpt-5.4 or ollama/kimi-k2.5:cloud):');
      if (modelRef) {
          const models = this.ensureSharedModelCatalog();
          if (models.some((model: any) => model.modelRef === modelRef)) {
              alert(`Hosted model "${modelRef}" is already in the catalog.`);
              return;
          }
          models.push({ modelRef });
          this.requestUpdate();
      }
  }

  async removeModel(idx: number) {
      const models = this.ensureSharedModelCatalog();
      const model = models[idx];
      if (!model) return;

      const assignedEndpoints = this.getCatalogModelAssignments(model);
      const assignedLabels = assignedEndpoints.map((endpoint: any) => this.getEndpointLabel(endpoint)).join(', ');

      if (this.isLocalCatalogModel(model)) {
          if (this.hasUnsavedChanges) {
              alert('Save or discard pending config edits before removing a local catalog model. This action runs toolkit cleanup and then reloads config from disk.');
              return;
          }

          const message = assignedEndpoints.length > 0
              ? `Remove local model "${model.id}" from the shared catalog?\n\nIt is currently assigned to: ${assignedLabels}.\n\nThe toolkit will remove it from those endpoints, update managed agent refs, attempt to delete installed copies from those endpoints, and compact Docker Desktop storage on this machine.`
              : `Remove local model "${model.id}" from the shared catalog?\n\nThe toolkit will remove it from the bootstrap config, attempt to delete any installed local copy, and compact Docker Desktop storage on this machine.`;
          if (!confirm(message)) return;

          this.runCommand('remove-local-model', ['-Model', model.id, '-CompactDockerData']);
          return;
      }

      if (this.isHostedCatalogModel(model)) {
          const message = assignedEndpoints.length > 0
              ? `Remove hosted model "${model.modelRef}" from the shared catalog?\n\nIt is currently assigned to: ${assignedLabels}.\n\nRemoving it here will also remove it from those endpoints.`
              : `Remove hosted model "${model.modelRef}" from the shared catalog?`;
          if (!confirm(message)) return;

          this.config.modelCatalog = models.filter((_: any, modelIdx: number) => modelIdx !== idx);
          for (const endpoint of this.getConfigEndpoints()) {
              endpoint.hostedModels = this.getEndpointHostedModels(endpoint).filter(
                  (entry: any) => String(entry?.modelRef || '') !== String(model.modelRef)
              );
          }

          await this.saveConfig();
          return;
      }

      if (confirm('Remove model?')) {
          models.splice(idx, 1);
          this.requestUpdate();
      }
  }

}
