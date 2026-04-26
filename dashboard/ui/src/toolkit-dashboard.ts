import { LitElement, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ToolkitDashboardRenderMixin } from './toolkit-dashboard-render-mixin';

@customElement('toolkit-dashboard')
export class ToolkitDashboard extends ToolkitDashboardRenderMixin(LitElement) {
  @state() config: any = null;
  @state() savedConfig: any = null;
  @state() templateFiles: any = { agents: {}, workspaces: {} };
  @state() savedTemplateFiles: any = { agents: {}, workspaces: {} };
  @state() statusOutput: string = '';
  @state() statusLoaded: boolean = false;
  @state() telegramSetupStatus: any = { defaultAccount: null, accounts: {} };
  @state() voiceWhisperModels: string[] = [];
  @state() voiceWhisperModelSource: string = 'fallback';
  @state() voiceWhisperModelError: string = '';
  @state() logs: string[] = [];
  @state() isRunning: boolean = false;
  @state() activeTab: string = 'status';
  @state() configSection: string = 'general';
  @state() featureSubsection: string = 'telegram';
  @state() markdownTemplateScope: 'agents' | 'workspaces' = 'agents';
  @state() markdownTemplateAgentFile: string = 'AGENTS.md';
  @state() markdownTemplateWorkspaceFile: string = 'AGENTS.md';
  @state() editingAgentKey: string | null = null;
  @state() editingAgentDraft: any = null;
  @state() editingAgentTemplateDraft: any = null;
  @state() editingAgentInitialDraft: any = null;
  @state() editingAgentInitialTemplateDraft: any = null;
  @state() editingAgentWorkspaceId: string | null = null;
  @state() editingAgentInitialWorkspaceId: string | null = null;
  @state() editingEndpointKey: string | null = null;
  @state() editingWorkspaceId: string | null = null;
  @state() topologyLinkSourceAgentId: string | null = null;
  @state() topologyHoverAgentId: string | null = null;
  @state() topologyHoverEdgeKey: string | null = null;
  @state() topologySelectedAgentId: string | null = null;
  @state() topologyDraggedAgentKey: string | null = null;
  @state() topologyHoverEndpointKey: string | null = null;
  @state() topologyNotice: string = '';
  @state() topologyBoardWidth: number = 0;
  @state() topologyBoardHeight: number = 0;
  @state() topologyInspectorOpen: boolean = false;
  @state() topologyEdges: any[] = [];
  @state() topologyShowAllArrows: boolean = false;
  @state() topologyInspectorMarkdownFile: string = 'AGENTS.md';
  @state() topologyAgentSessions: Array<{ key: string; sessionId?: string; agentId: string; label: string; url: string; createdAt: number }> = [];
  @state() topologyAgentSessionBusyKey: string | null = null;
  @state() topologyAgentSessionError: string = '';
  @state() showModelSelector: boolean = false;
  @state() selectorTarget: string | null = null; // 'tune' or 'candidate' or 'endpoint-hosted'
  ws: WebSocket | null = null;
  statusAbortController: AbortController | null = null;
  seenServerStartTime: string | null = null;
  reconnectTimer: number | null = null;
  pendingSocketAction: string | null = null;
  pendingSocketRetryTimer: number | null = null;
  topologyMeasureFrame: number | null = null;
  topologyAgentSessionWindows = new Map<string, Window>();
  topologyAgentSessionPollTimers = new Map<string, number>();
  gatewayAuthTokenPromise: Promise<string> | null = null;

  // Helper for API URL construction
  private getBaseUrl() {
      // If we are served under /toolkit/, API calls must be prefixed.
      return window.location.pathname.startsWith('/toolkit') ? '/toolkit' : '';
  }

  getOpenClawChatBaseUrl() {
    const basePath = this.getBaseUrl();
    if (basePath === '/toolkit') {
      return `${window.location.origin}/chat`;
    }
    const url = new URL(window.location.href);
    url.port = '18789';
    url.pathname = '/chat';
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  static styles = css`
    :host { display: block; width: 100%; min-height: 100vh; background-color: #0f0f0f; overflow-x: clip; }
    .layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; width: 100%; }
    aside { background: #1a1a1a; border-right: 1px solid #333; padding: 20px 0; display: flex; flex-direction: column; }
    .brand { padding: 0 24px 20px; }
    .nav-item { padding: 12px 24px; cursor: pointer; color: #aaa; transition: all 0.2s; border-left: 3px solid transparent; display: flex; align-items: center; gap: 10px; }
    .nav-item:hover { background: #252525; color: #fff; }
    .nav-item.active { background: #2a2a2a; color: #00bcd4; border-left-color: #00bcd4; }
    main { min-width: 0; padding: 30px; overflow-y: auto; max-height: 100vh; }
    main.config-main { padding-top: 0; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 30px; }
    header > div { min-width: 0; }
    h1 { margin: 0; font-size: 1.4rem; color: #fff; display: flex; align-items: center; gap: 10px; }
    .badge { background: #00bcd4; color: #000; font-size: 0.7rem; padding: 2px 6px; border-radius: 10px; font-weight: bold; }
    .badge-warning { background: #ff9800; color: #000; }
    .card { background: #1e1e1e; border: 1px solid #333; border-radius: 8px; padding: 20px; margin-bottom: 20px; min-width: 0; }
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
    .btn { padding: 10px 18px; border-radius: 4px; border: none; cursor: pointer; font-weight: 600; font-size: 0.9rem; transition: opacity 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; max-width: 100%; }
    .btn-primary { background: #00bcd4; color: #000; }
    .btn-secondary { background: #333; color: #fff; }
    .btn-danger { background: #f44336; color: #fff; }
    .btn-ghost { background: transparent; color: #888; border: 1px solid #444; }
    .btn:hover { opacity: 0.8; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .log-container { background: #000; height: 500px; overflow-y: auto; padding: 15px; border-radius: 6px; font-family: monospace; border: 1px solid #333; }
    .log-entry { margin-bottom: 2px; white-space: pre-wrap; word-break: break-all; }
    .item-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px; background: #252525; border: 1px solid #333; border-radius: 4px; margin-bottom: 8px; min-width: 0; }
    .item-info { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
    .item-title { font-weight: bold; color: #fff; }
    .item-sub { font-size: 0.75rem; color: #777; }
    .model-catalog-list { display: flex; flex-direction: column; gap: 14px; }
    .model-catalog-card { background: #252525; border: 1px solid #333; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
    .model-catalog-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .model-catalog-title { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .model-catalog-title .item-title { overflow-wrap: anywhere; }
    .model-catalog-pill-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .model-catalog-pill { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; border: 1px solid #444; font-size: 0.72rem; color: #bbb; background: #1b1b1b; }
    .model-catalog-pill.reasoning { border-color: #245b68; color: #7fe8ff; background: rgba(0, 188, 212, 0.08); }
    .model-catalog-pill.standard { border-color: #4f3c1d; color: #ffd180; background: rgba(255, 152, 0, 0.08); }
    .model-catalog-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .model-catalog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .model-catalog-help { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 0 0 18px; }
    .model-catalog-help-card { background: #161616; border: 1px solid #2e2e2e; border-radius: 8px; padding: 12px; }
    .model-catalog-help-card strong { color: #fff; display: block; margin-bottom: 6px; }
    .model-catalog-help-card span { color: #9a9a9a; font-size: 0.8rem; line-height: 1.45; }
    .tabs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
    .tab { padding: 10px 20px; cursor: pointer; border: 1px solid #333; background: #1a1a1a; border-radius: 4px; font-size: 0.9rem; color: #888; transition: all 0.2s; }
    .tab:hover { background: #252525; color: #fff; border-color: #444; }
    .tab.active { background: #00bcd4; color: #000; border-color: #00bcd4; font-weight: 600; }
    .config-page { margin: 0 -30px -30px; padding: 0 30px 30px; }
    .config-toolbar { position: sticky; top: 0; z-index: 40; display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; padding: 10px 0 16px; background: linear-gradient(180deg, rgba(15,15,15,0.98) 0%, rgba(15,15,15,0.94) 100%); backdrop-filter: blur(8px); border-bottom: 1px solid #252525; box-shadow: 0 10px 18px rgba(0,0,0,0.25); }
    .config-toolbar-tabs { display: flex; flex-wrap: wrap; gap: 10px; }
    .config-toolbar-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; align-items: center; }
    .config-toolbar-actions .btn { flex: 0 1 auto; white-space: nowrap; }
    .unsaved-banner { background: #ff9800; color: #000; padding: 10px 20px; border-radius: 4px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; gap: 12px; font-weight: bold; }
    .toggle-switch { display: flex; align-items: center; gap: 10px; cursor: pointer; }
    .toggle-switch input { width: auto; }
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal { background: #1e1e1e; border: 1px solid #333; border-radius: 8px; width: min(500px, calc(100vw - 32px)); max-height: 80vh; display: flex; flex-direction: column; }
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
    .status-warning { background: #ff9800; box-shadow: 0 0 8px rgba(255, 152, 0, 0.5); }
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
    .topology-main-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; }
    .topology-main-grid.inspector-open { grid-template-columns: minmax(0, 1fr) 400px; }
    .topology-board-column { min-width: 0; display: flex; flex-direction: column; gap: 16px; }
    .topology-inspector-column { min-width: 0; }
    .topology-inspector-sticky { position: sticky; top: 20px; }
    .topology-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
    .topology-toolbar-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: flex-end; }
    .topology-legend { display: flex; flex-wrap: wrap; gap: 10px; color: #888; font-size: 0.8rem; }
    .topology-legend-item { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid #333; border-radius: 999px; background: #181818; }
    .topology-notice { min-height: 50px; padding: 12px 14px; border-radius: 8px; border: 1px solid #3a3a3a; background: #151515; color: #ddd; display: flex; align-items: center; }
    .topology-notice strong { color: #fff; }
    .topology-notice.placeholder { color: #66757f; border-color: #2d3438; background: #131619; }
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
    .topology-agent.selected { border-color: #7e57c2; box-shadow: 0 0 0 2px rgba(126,87,194,0.2), 0 8px 18px rgba(0,0,0,0.2); }
    .topology-agent-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .topology-agent-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .topology-agent-title strong { color: #fff; font-size: 0.92rem; white-space: normal; overflow: visible; text-overflow: unset; overflow-wrap: anywhere; }
    .topology-agent-avatar { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: #2c2c2c; font-size: 0.95rem; flex-shrink: 0; }
    .topology-agent-main { color: #ffc107; font-size: 1rem; }
    .topology-agent-header-actions { display: flex; align-items: center; gap: 8px; }
    .topology-agent-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid #3a3a3a; border-radius: 999px; background: #171717; color: #bfc9cf; font-size: 0.72rem; cursor: pointer; }
    .topology-agent-toggle input { width: auto; margin: 0; }
    .topology-agent-toggle.disabled { border-color: #6a2a2a; color: #ffb4ad; }
    .topology-agent-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .topology-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; border: 1px solid #3a3a3a; color: #bbb; background: #191919; }
    .topology-pill.main { border-color: #7a6210; color: #ffd54f; }
    .topology-pill.disabled { border-color: #6a2a2a; color: #ff8a80; }
    .topology-pill.shared { border-color: #25583d; color: #81c784; }
    .topology-pill.private { border-color: #234f6d; color: #90caf9; }
    .topology-pill.local { border-color: #4b5b24; color: #c5e1a5; }
    .topology-pill.hosted { border-color: #6b4d2c; color: #ffcc80; }
    .topology-agent-meta { color: #8f8f8f; font-size: 0.74rem; line-height: 1.45; min-height: 32px; overflow-wrap: anywhere; }
    .topology-agent-workspace { display: flex; align-items: center; gap: 6px; color: #b7c4ca; margin-bottom: 4px; }
    .topology-agent-workspace-icon { flex-shrink: 0; }
    .topology-agent-workspace select { min-width: 0; flex: 1 1 auto; margin: 0; font-size: 0.74rem; padding: 6px 8px; }
    .topology-agent-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; padding-top: 0; }
    .topology-agent-actions .btn { flex: 1 1 120px; padding: 7px 10px; font-size: 0.75rem; min-width: 0; }
    .topology-agent-session-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .topology-agent-session-chip { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; padding: 6px 8px; border-radius: 999px; border: 1px solid #284653; background: rgba(0, 188, 212, 0.08); color: #ccebf2; font-size: 0.72rem; }
    .topology-agent-session-chip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .topology-agent-session-chip button { border: 0; background: transparent; color: #ffb4ad; cursor: pointer; padding: 0 2px; font-size: 0.86rem; }
    .topology-agent-session-panel { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
    .topology-agent-session-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid #333; border-radius: 10px; background: #171717; }
    .topology-agent-session-row-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #dbe9ee; font-size: 0.8rem; }
    .topology-agent-session-row-meta { color: #7f929b; font-size: 0.7rem; }
    .topology-card-link-hint { margin-top: 8px; color: #00bcd4; font-size: 0.72rem; }
    .topology-hover-preview { border-color: #5b6f79; box-shadow: 0 0 0 1px rgba(110,198,255,0.22), 0 8px 18px rgba(0,0,0,0.2); }
    .topology-inspector-section { margin-top: 18px; padding-top: 18px; border-top: 1px solid #333; }
    .topology-inspector-header { align-items: flex-start; gap: 14px; }
    .topology-inspector-header-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .topology-inspector-header-copy h3 { margin: 0; }
    .topology-inspector-header-subtitle { color: #8f8f8f; font-size: 0.78rem; line-height: 1.4; }
    .topology-inspector-header-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .topology-inspector-header-actions .btn { padding: 8px 12px; font-size: 0.8rem; white-space: nowrap; }
    .topology-inspector-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 12px; color: #9aa7ad; font-size: 0.82rem; margin-top: 2px; }
    .topology-inspector-summary-item { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .topology-inspector-summary-item-wide { grid-column: 1 / -1; }
    .topology-inspector-summary-label { color: #8f8f8f; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
    .topology-inspector-summary-value { min-width: 0; overflow-wrap: anywhere; color: #d6e0e5; }
    .topology-inspector-summary-value strong { color: #fff; }
    .topology-inspector-select { min-width: 0; width: 100%; }
    .topology-expander { border: 1px solid #333; border-radius: 12px; background: #181818; overflow: hidden; }
    .topology-expander summary { cursor: pointer; list-style: none; padding: 12px 14px; color: #d6e0e5; font-weight: 700; }
    .topology-expander summary::-webkit-details-marker { display: none; }
    .topology-expander[open] summary { border-bottom: 1px solid #333; }
    .topology-expander-body { padding: 12px; }
    .status-checklist-panel { margin-bottom: 20px; }
    .status-checklist-group { margin-top: 14px; }
    .status-checklist-group h4 { margin: 0 0 10px; color: #d6e0e5; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .status-checklist { display: flex; flex-direction: column; gap: 10px; }
    .status-checklist-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid #333; border-radius: 10px; background: #171717; }
    .status-checklist-item.done { border-color: #4caf50; }
    .status-checklist-item.active { border-color: #00bcd4; }
    .status-checklist-item.warning { border-color: #ff9800; }
    .status-checklist-item.error { border-color: #f44336; }
    .status-checklist-item.optional { border-style: dashed; border-color: #7a5a1d; }
    .status-checklist-copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .status-checklist-title { display: flex; align-items: center; gap: 8px; color: #fff; font-weight: 600; }
    .status-checklist-note { color: #8a8a8a; font-size: 0.8rem; line-height: 1.45; }
    .topology-markdown-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .topology-markdown-tab { padding: 6px 10px; border: 1px solid #333; border-radius: 999px; background: #181818; color: #888; cursor: pointer; font-size: 0.78rem; }
    .topology-markdown-tab.active { background: #00bcd4; border-color: #00bcd4; color: #000; font-weight: 700; }
    .topology-help { color: #888; font-size: 0.82rem; line-height: 1.55; }
    .topology-help strong { color: #ddd; }
    @media (max-width: 1480px) {
      .topology-main-grid,
      .topology-main-grid.inspector-open { grid-template-columns: minmax(0, 1fr); }
      .topology-inspector-sticky { position: static; }
    }
    @media (max-width: 1100px) {
      .config-toolbar-actions { justify-content: flex-start; }
    }
    @media (max-width: 900px) {
      .model-catalog-header { flex-direction: column; }
      .model-catalog-actions { justify-content: stretch; }
      .model-catalog-actions .btn { flex: 1 1 180px; }
      .config-toolbar-actions { flex-direction: column; align-items: stretch; }
      .config-toolbar-actions .btn { width: 100%; }
    }
    @media (max-width: 820px) {
      .layout { display: flex; flex-direction: column; min-height: 100vh; }
      aside {
        position: sticky;
        top: 0;
        z-index: 30;
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        padding: 12px;
        border-right: 0;
        border-bottom: 1px solid #333;
        box-shadow: 0 10px 24px rgba(0,0,0,0.28);
      }
      .brand { padding: 0; }
      .brand h1 { font-size: 1.05rem; }
      .nav-item {
        border-left: 0;
        border-bottom: 3px solid transparent;
        border-radius: 10px;
        padding: 10px 12px;
        white-space: nowrap;
        justify-content: center;
      }
      aside > .nav-item,
      aside > div:not(.brand) { min-width: 0; }
      aside {
        grid-template-columns: repeat(5, minmax(max-content, 1fr));
        overflow-x: auto;
        scrollbar-width: thin;
      }
      .brand { grid-column: 1 / -1; }
      .nav-item.active { border-left-color: transparent; border-bottom-color: #00bcd4; }
      main { max-height: none; overflow: visible; padding: 18px; }
      header { align-items: flex-start; flex-direction: column; margin-bottom: 18px; }
      header > div { width: 100%; flex-wrap: wrap; }
      header .btn { flex: 0 1 auto; }
      main.config-main { padding-top: 0; }
      .config-page { margin: 0 -18px -18px; padding: 0 18px 18px; }
      .config-toolbar { top: 0; padding-top: 12px; margin-bottom: 20px; }
      .card { padding: 16px; border-radius: 12px; }
      .card-header { align-items: flex-start; flex-direction: column; gap: 10px; }
      .card-header .btn { width: 100%; }
      .grid-2,
      .status-grid,
      .model-catalog-help,
      .model-catalog-grid { grid-template-columns: minmax(0, 1fr); gap: 14px; }
      .status-content { white-space: pre-wrap; overflow-wrap: anywhere; }
      .item-row,
      .setup-step,
      .unsaved-banner { align-items: stretch; flex-direction: column; }
      .item-row .btn,
      .setup-step .btn,
      .unsaved-banner .btn { width: 100%; }
      .unsaved-banner > div { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
      .tabs { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 4px; }
      .tab { white-space: nowrap; flex: 0 0 auto; }
      .log-container { height: 48vh; min-height: 320px; }
      .modal-overlay { align-items: stretch; padding: 12px; }
      .modal { width: 100%; max-height: calc(100vh - 24px); }
      .modal-body { padding: 14px; }
      .fallback-row,
      .topology-agent-session-row { grid-template-columns: minmax(0, 1fr); }
      .fallback-actions,
      .topology-agent-session-row .btn { width: 100%; }
      .topology-toolbar,
      .topology-toolbar-controls { align-items: stretch; flex-direction: column; }
      .topology-legend,
      .topology-legend-item { width: 100%; box-sizing: border-box; }
      .topology-scroll {
        margin: 0 -16px;
        padding: 0 16px 12px;
        scroll-snap-type: x proximity;
      }
      .topology-board { min-width: 760px !important; }
      .topology-slot { scroll-snap-align: start; }
      .topology-agent-header,
      .topology-agent-workspace { align-items: stretch; flex-direction: column; }
      .topology-agent-header-actions { justify-content: space-between; }
      .topology-agent-actions .btn { flex-basis: 100%; }
      .topology-inspector-header { align-items: flex-start; flex-direction: column; }
      .topology-inspector-header-actions { justify-content: flex-start; width: 100%; }
      .topology-inspector-summary { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 520px) {
      main { padding: 12px; }
      aside { grid-template-columns: repeat(5, max-content); }
      .nav-item { font-size: 0.82rem; padding: 9px 10px; }
      .card { padding: 12px; }
      h1 { font-size: 1rem; }
      h2 { font-size: 1.2rem; }
      .btn { padding: 10px 12px; }
      .model-catalog-card { padding: 12px; }
      .model-catalog-actions .btn { flex-basis: 100%; }
      .setup-guide { padding: 18px; }
      .status-card-header { align-items: flex-start; flex-direction: column; gap: 8px; }
      .status-card-header .btn { width: 100%; }
      .topology-board { min-width: 680px !important; }
      .topology-agent { min-height: 150px; }
      .topology-agent-session-chip { width: 100%; box-sizing: border-box; }
    }
  `;

  async firstUpdated() {
    window.onerror = (msg) => { this.logs = [...this.logs, `ERR: ${msg}`]; this.requestUpdate(); };
    window.onunhandledrejection = (event) => { this.logs = [...this.logs, `REJ: ${event.reason}`]; this.requestUpdate(); };
    
    // Wait for server to be responsive
    let ready = false;
    for (let i = 0; i < 5; i++) {
        try {
            await fetch(this.getBaseUrl() + '/api/config', { cache: 'no-store' });
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
      const res = await fetch(this.getBaseUrl() + '/api/config', { cache: 'no-store' });
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
        signal: controller.signal,
        cache: 'no-store'
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
      const res = await fetch(this.getBaseUrl() + '/api/telegram-setup-status', { cache: 'no-store' });
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
      const res = await fetch(this.getBaseUrl() + '/api/voice-models', { cache: 'no-store' });
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

  runOperation(operation: any) {
    if (operation?.confirmText && !confirm(operation.confirmText)) {
      return;
    }
    this.runCommand(operation.id, operation.args ?? []);
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
          models.push({ id, input: ['text'], minimumContextWindow: 24576, maxTokens: 8192 });
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

  async removeModel(idx: number, options: { keepOllamaModel?: boolean } = {}) {
      const models = this.ensureSharedModelCatalog();
      const model = models[idx];
      if (!model) return;

      const assignedEndpoints = this.getCatalogModelAssignments(model);
      const assignedLabels = assignedEndpoints.map((endpoint: any) => this.getEndpointLabel(endpoint)).join(', ');
      const keepOllamaModel = !!options.keepOllamaModel;

      if (this.isLocalCatalogModel(model)) {
          if (!keepOllamaModel && this.hasUnsavedChanges) {
              alert('Save or discard pending config edits before removing a local catalog model. This action runs toolkit cleanup and then reloads config from disk.');
              return;
          }

          const message = keepOllamaModel
              ? assignedEndpoints.length > 0
                  ? `Remove local model "${model.id}" from the shared catalog only?\n\nIt is currently assigned to: ${assignedLabels}.\n\nThe dashboard will remove it from the bootstrap config, remove it from those managed endpoints, and update managed agent refs if needed.\n\nInstalled Ollama copies will be kept on disk, and the change will stay unsaved until you press Save Only or Save & Apply.`
                  : `Remove local model "${model.id}" from the shared catalog only?\n\nThe dashboard will remove it from the bootstrap config, keep any installed Ollama copy on disk, and leave the change unsaved until you press Save Only or Save & Apply.`
              : assignedEndpoints.length > 0
                  ? `Remove local model "${model.id}" from the shared catalog?\n\nIt is currently assigned to: ${assignedLabels}.\n\nThe toolkit will remove it from those endpoints, update managed agent refs, attempt to delete installed copies from those endpoints, and compact Docker Desktop storage on this machine.`
                  : `Remove local model "${model.id}" from the shared catalog?\n\nThe toolkit will remove it from the bootstrap config, attempt to delete any installed local copy, and compact Docker Desktop storage on this machine.`;
          if (!confirm(message)) return;

          if (keepOllamaModel) {
              this.removeLocalCatalogModelFromConfig(idx, model);
          } else {
              const args = ['-Model', model.id];
              args.push('-CompactDockerData');
              this.runCommand('remove-local-model', args);
          }
          return;
      }

      if (this.isHostedCatalogModel(model)) {
          const message = assignedEndpoints.length > 0
              ? `Remove hosted model "${model.modelRef}" from the shared catalog?\n\nIt is currently assigned to: ${assignedLabels}.\n\nThe dashboard will remove it from the shared catalog and from those endpoint assignments. The change will stay unsaved until you press Save Only or Save & Apply.`
              : `Remove hosted model "${model.modelRef}" from the shared catalog?\n\nThe change will stay unsaved until you press Save Only or Save & Apply.`;
          if (!confirm(message)) return;

          this.config.modelCatalog = models.filter((_: any, modelIdx: number) => modelIdx !== idx);
          for (const endpoint of this.getConfigEndpoints()) {
              endpoint.hostedModels = this.getEndpointHostedModels(endpoint).filter(
                  (entry: any) => String(entry?.modelRef || '') !== String(model.modelRef)
              );
          }

          this.requestUpdate();
          return;
      }

      if (confirm('Remove model?')) {
          models.splice(idx, 1);
          this.requestUpdate();
      }
  }

}
