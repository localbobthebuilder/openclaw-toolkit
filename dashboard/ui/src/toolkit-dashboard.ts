import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

@customElement('toolkit-dashboard')
export class ToolkitDashboard extends LitElement {
  @state() private config: any = null;
  @state() private savedConfig: any = null;
  @state() private statusOutput: string = '';
  @state() private statusLoaded: boolean = false;
  @state() private voiceWhisperModels: string[] = [];
  @state() private voiceWhisperModelSource: string = 'fallback';
  @state() private voiceWhisperModelError: string = '';
  @state() private logs: string[] = [];
  @state() private isRunning: boolean = false;
  @state() private activeTab: string = 'status';
  @state() private configSection: string = 'general';
  @state() private editingAgentKey: string | null = null;
  @state() private editingEndpointKey: string | null = null;
  @state() private topologyLinkSourceAgentId: string | null = null;
  @state() private topologyDraggedAgentKey: string | null = null;
  @state() private topologyHoverEndpointKey: string | null = null;
  @state() private topologyNotice: string = '';
  @state() private showModelSelector: boolean = false;
  @state() private selectorTarget: string | null = null; // 'tune' or 'candidate' or 'endpoint-hosted'
  private ws: WebSocket | null = null;
  private statusAbortController: AbortController | null = null;
  private seenServerStartTime: string | null = null;

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
    label { display: block; margin-bottom: 6px; font-size: 0.85rem; color: #888; }
    .help-text { display: block; margin-top: 6px; font-size: 0.85rem; color: #888; }
    input, select, textarea { width: 100%; background: #2a2a2a; border: 1px solid #444; color: #fff; padding: 10px; border-radius: 4px; font-size: 0.9rem; }
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
    .item-info { display: flex; flex-direction: column; gap: 4px; }
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
    .topology-legend { display: flex; flex-wrap: wrap; gap: 10px; color: #888; font-size: 0.8rem; }
    .topology-legend-item { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid #333; border-radius: 999px; background: #181818; }
    .topology-notice { padding: 12px 14px; border-radius: 8px; border: 1px solid #3a3a3a; background: #151515; color: #ddd; }
    .topology-notice strong { color: #fff; }
    .topology-scroll { overflow-x: auto; overflow-y: hidden; padding-bottom: 8px; }
    .topology-board { position: relative; min-height: 480px; }
    .topology-links { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
    .topology-slot { position: absolute; top: 0; border: 1px solid #333; border-radius: 16px; background: linear-gradient(180deg, #191919 0%, #111 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); }
    .topology-slot.drop-target { border-color: #00bcd4; box-shadow: 0 0 0 2px rgba(0, 188, 212, 0.2); }
    .topology-slot-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 16px 10px; border-bottom: 1px solid #2e2e2e; }
    .topology-slot-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .topology-slot-icon { font-size: 1.35rem; }
    .topology-slot-heading { display: flex; flex-direction: column; min-width: 0; }
    .topology-slot-heading strong { color: #fff; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .topology-slot-heading span { color: #777; font-size: 0.76rem; }
    .topology-slot-badge { color: #00bcd4; font-size: 0.74rem; border: 1px solid #24434a; border-radius: 999px; padding: 4px 8px; background: rgba(0,188,212,0.08); }
    .topology-slot-body { position: relative; }
    .topology-slot-empty { position: absolute; left: 16px; right: 16px; top: 82px; padding: 14px; border: 1px dashed #333; border-radius: 12px; color: #777; font-size: 0.82rem; text-align: center; background: rgba(255,255,255,0.01); }
    .topology-agent { position: absolute; left: 16px; right: 16px; border: 1px solid #353535; border-radius: 14px; background: #202020; padding: 12px 12px 10px; cursor: pointer; user-select: none; box-shadow: 0 8px 18px rgba(0,0,0,0.2); }
    .topology-agent:hover { border-color: #4a4a4a; }
    .topology-agent.dragging { opacity: 0.55; border-style: dashed; }
    .topology-agent.disabled { opacity: 0.6; }
    .topology-agent.main-agent { border-color: #d4a514; box-shadow: 0 0 0 1px rgba(212,165,20,0.2), 0 8px 18px rgba(0,0,0,0.2); }
    .topology-agent.link-source { border-color: #00bcd4; box-shadow: 0 0 0 2px rgba(0,188,212,0.2), 0 8px 18px rgba(0,0,0,0.2); }
    .topology-agent-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .topology-agent-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .topology-agent-title strong { color: #fff; font-size: 0.92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
    .topology-agent-meta { color: #8f8f8f; font-size: 0.74rem; line-height: 1.45; min-height: 32px; }
    .topology-agent-actions { display: flex; gap: 8px; margin-top: 10px; }
    .topology-agent-actions .btn { flex: 1; padding: 7px 10px; font-size: 0.75rem; }
    .topology-card-link-hint { margin-top: 8px; color: #00bcd4; font-size: 0.72rem; }
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
        this.connectWS();
    } else {
        console.error('Server failed to initialize after multiple attempts');
    }
  }

  async fetchConfig() {
    try {
      const res = await fetch(this.getBaseUrl() + '/api/config');
      const data = await res.json();
      this.config = this.sanitizeConfigModelNames(data);
      this.savedConfig = JSON.parse(JSON.stringify(this.config));
    } catch (err) {
      console.error('Failed to fetch config', err);
    }
  }

  async fetchStatus() {
    if (this.statusAbortController) {
      this.statusAbortController.abort();
    }
    this.statusAbortController = new AbortController();
    this.statusLoaded = false;

    try {
      const res = await fetch(this.getBaseUrl() + '/api/status', {
        signal: this.statusAbortController.signal
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      this.statusOutput = data.output;
      this.statusLoaded = true;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to fetch status', err);
      }
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
    return JSON.stringify(this.config) !== JSON.stringify(this.savedConfig);
  }

  connectWS() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.port === '18791' ? '127.0.0.1:18791' : window.location.host;
    this.ws = new WebSocket(`${protocol}//${host}`);
    this.ws.onopen = () => {
      // If a command was running when the connection dropped (e.g. dashboard rebuild
      // killed the server), mark it finished so the UI is no longer locked.
      if (this.isRunning) {
        this.isRunning = false;
        this.logs = [...this.logs, '\n[RECONNECTED] Dashboard server restarted. ✅'];
        this.fetchConfig();
        this.fetchStatus();
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
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      // Auto-reconnect after 3s (handles server restart / dashboard rebuild)
      setTimeout(() => this.connectWS(), 3000);
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  runCommand(command: string, args: string[] = []) {
    if (!this.ws || this.isRunning) return;
    this.isRunning = true;
    this.logs = [`[START] Running: ${command} ${args.join(' ')}...\n`];
    this.activeTab = 'logs';
    this.ws.send(JSON.stringify({ type: 'run-command', command, args }));
  }

  cancelCommand() {
    if (!this.ws || !this.isRunning) return;
    this.ws.send(JSON.stringify({ type: 'cancel-command' }));
  }

  rebootService(service: string) {
    if (!this.ws || this.isRunning) return;
    if (!confirm(`Are you sure you want to reboot ${service}?`)) return;
    this.isRunning = true;
    this.logs = [`[REBOOT] Restarting ${service}...\n`];
    this.activeTab = 'logs';
    this.ws.send(JSON.stringify({ type: 'reboot-service', service }));
  }

  async saveConfig() {
    try {
      this.syncAllAgentModelSources();
      const persistedConfig = this.buildPersistedConfig(this.config);
      const res = await fetch(this.getBaseUrl() + '/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(persistedConfig)
      });
      if (res.ok) {
        this.config = this.sanitizeConfigModelNames(persistedConfig);
        this.savedConfig = JSON.parse(JSON.stringify(this.config));
        alert('Configuration saved successfully.');
      } else throw new Error('Failed to save');
    } catch (err) {
      alert('Error saving configuration.');
    }
  }

  discardChanges() {
    if (confirm('Discard all unsaved changes?')) {
      this.config = JSON.parse(JSON.stringify(this.savedConfig));
    }
  }

  async applyAndRestart() {
    await this.saveConfig();
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
                <button class="btn btn-primary" style="background: #000; color: #ff9800;" @click=${this.saveConfig}>Save</button>
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
      if (!Array.isArray(this.config.telegram.allowFrom)) {
          this.config.telegram.allowFrom = [];
      }
      if (!Array.isArray(this.config.telegram.groupAllowFrom)) {
          this.config.telegram.groupAllowFrom = [];
      }
      if (!Array.isArray(this.config.telegram.groups)) {
          this.config.telegram.groups = [];
      }
      this.config.telegram.groups = this.config.telegram.groups.map((group: any) => this.normalizeTelegramGroupRecord(group));
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

  ensureTelegramExecApprovalsConfig() {
      const telegram = this.ensureTelegramConfig();
      if (!telegram.execApprovals || typeof telegram.execApprovals !== 'object') {
          telegram.execApprovals = {};
      }
      if (typeof telegram.execApprovals.enabled !== 'boolean') {
          telegram.execApprovals.enabled = false;
      }
      if (!Array.isArray(telegram.execApprovals.approvers)) {
          telegram.execApprovals.approvers = [];
      }
      if (!telegram.execApprovals.target) {
          telegram.execApprovals.target = 'dm';
      }
      return telegram.execApprovals;
  }

  parseCommaSeparatedList(value: string) {
      return value.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  }

  addTelegramGroup() {
      const telegram = this.ensureTelegramConfig();
      telegram.groups.push({
          id: '',
          enabled: true,
          requireMention: true,
          allowFrom: []
      });
      this.requestUpdate();
  }

  removeTelegramGroup(index: number) {
      const telegram = this.ensureTelegramConfig();
      telegram.groups.splice(index, 1);
      this.requestUpdate();
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
    normalized.enableAgentToAgent = this.normalizeBoolean(normalized.enableAgentToAgent, false);
    normalized.manageWorkspaceAgentsMd = this.normalizeBoolean(normalized.manageWorkspaceAgentsMd, false);
    if (!Array.isArray(normalized.agents)) {
      normalized.agents = [];
    }
    if (normalized.mode === 'private') {
      normalized.allowSharedWorkspaceAccess = this.normalizeBoolean(normalized.allowSharedWorkspaceAccess, false);
    }
    return normalized;
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

    const slots = this.getTopologySlots();
    const slotWidth = 308;
    const slotGap = 28;
    const slotHeaderHeight = 74;
    const slotTopPadding = 22;
    const agentHeight = 136;
    const agentGap = 18;
    const agentStep = agentHeight + agentGap;
    const agentStartTop = slotHeaderHeight + slotTopPadding;
    const maxRows = Math.max(1, ...slots.map((slot: any) => slot.agents.length));
    const boardWidth = Math.max(1, slots.length) * slotWidth + Math.max(0, slots.length - 1) * slotGap;
    const boardHeight = agentStartTop + maxRows * agentStep + 24;

    const getAgentPosition = (agentId: string) => {
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        const slot = slots[slotIndex];
        const rowIndex = slot.agents.findIndex((entry: any) => entry.id === agentId);
        if (rowIndex >= 0) {
          const left = slotIndex * (slotWidth + slotGap) + 16;
          const top = agentStartTop + rowIndex * agentStep;
          return {
            x: left + ((slotWidth - 32) / 2),
            y: top + (agentHeight / 2)
          };
        }
      }
      return null;
    };

    const edges: any[] = [];
    for (const sourceEntry of this.getTopologyAgentEntries()) {
      for (const targetId of this.getAgentDelegationTargets(sourceEntry.agent)) {
        const targetEntry = this.getTopologyAgentEntryById(targetId);
        if (!targetEntry) {
          continue;
        }
        const from = getAgentPosition(sourceEntry.id);
        const to = getAgentPosition(targetId);
        if (!from || !to) {
          continue;
        }
        const deltaX = to.x - from.x;
        const curve = deltaX === 0 ? 90 : Math.max(60, Math.abs(deltaX) * 0.35);
        const c1x = from.x + (deltaX >= 0 ? curve : -curve);
        const c2x = to.x - (deltaX >= 0 ? curve : -curve);
        edges.push({
          key: `${sourceEntry.id}->${targetId}`,
          path: `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`,
          active: this.topologyLinkSourceAgentId === sourceEntry.id || this.topologyLinkSourceAgentId === targetId,
          main: sourceEntry.isMain
        });
      }
    }

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
            <div class="topology-legend">
              <span class="topology-legend-item">💻 endpoint workbench</span>
              <span class="topology-legend-item">👑 main agent</span>
              <span class="topology-legend-item">⬈ dotted arrow = delegates to</span>
              <span class="topology-legend-item">♻ cycles blocked</span>
            </div>
          </div>
          <div class="topology-help" style="margin-top: 14px;">
            The visual board edits the same config used elsewhere: <strong>endpointKey</strong> for placement and <strong>subagents.allowAgents</strong> for delegation.
          </div>
        </div>

        ${this.topologyNotice ? html`
          <div class="topology-notice"><strong>Workbench:</strong> ${this.topologyNotice}</div>
        ` : ''}

        <div class="card">
          <div class="topology-scroll">
            <div class="topology-board" style="width: ${boardWidth}px; height: ${boardHeight}px;">
              <svg class="topology-links" width=${boardWidth} height=${boardHeight} viewBox=${`0 0 ${boardWidth} ${boardHeight}`} preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <marker id="topologyArrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#6ec6ff"></path>
                  </marker>
                </defs>
                ${edges.map((edge: any) => html`
                  <path
                    d=${edge.path}
                    fill="none"
                    stroke=${edge.active ? '#00bcd4' : edge.main ? '#ffd54f' : '#6ec6ff'}
                    stroke-width=${edge.active ? '3' : '2'}
                    stroke-dasharray="6 7"
                    marker-end="url(#topologyArrow)"
                    opacity=${edge.active ? '0.95' : '0.75'}></path>
                `)}
              </svg>

              ${slots.map((slot: any, slotIndex: number) => {
                const left = slotIndex * (slotWidth + slotGap);
                const isDropTarget = this.topologyHoverEndpointKey === slot.key;
                return html`
                  <section
                    class="topology-slot ${isDropTarget ? 'drop-target' : ''}"
                    style="left: ${left}px; width: ${slotWidth}px; height: ${boardHeight}px;"
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
                    <div class="topology-slot-body" style="height: ${boardHeight - slotHeaderHeight}px;">
                      ${slot.agents.length === 0 ? html`
                        <div class="topology-slot-empty">
                          ${slot.endpointKey ? 'Drop an agent here to assign this endpoint.' : 'Agents without a resolved endpoint appear here.'}
                        </div>
                      ` : ''}
                      ${slot.agents.map((entry: any, rowIndex: number) => {
                        const top = agentStartTop + rowIndex * agentStep;
                        const delegateCount = this.getAgentDelegationTargets(entry.agent).length;
                        const isLinkSource = this.topologyLinkSourceAgentId === entry.id;
                        const hasSubagentsDisabled = entry.agent?.subagents?.enabled === false;
                        return html`
                          <div
                            class="topology-agent ${entry.enabled ? '' : 'disabled'} ${entry.isMain ? 'main-agent' : ''} ${isLinkSource ? 'link-source' : ''} ${this.topologyDraggedAgentKey === entry.key ? 'dragging' : ''}"
                            style="top: ${top}px; height: ${agentHeight}px;"
                            draggable="true"
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
                              Role: ${entry.agent.rolePolicyKey || 'default'}<br>
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
          <div class="tab ${this.configSection === 'roles' ? 'active' : ''}" @click=${() => this.configSection = 'roles'}>Role Policies</div>
          <div class="tab ${this.configSection === 'agents' ? 'active' : ''}" @click=${() => this.configSection = 'agents'}>Agents</div>
          <div class="tab ${this.configSection === 'features' ? 'active' : ''}" @click=${() => this.configSection = 'features'}>Features</div>
        </div>
        <div style="display: flex; gap: 10px;">
           <button class="btn btn-ghost" @click=${this.saveConfig}>Save Only</button>
           <button class="btn btn-primary" @click=${this.applyAndRestart}>Save & Apply (Restart Agents)</button>
        </div>
      </header>

      ${this.renderConfigSection()}
    `;
  }

  renderConfigSection() {
    switch (this.configSection) {
      case 'general': return this.renderGeneralConfig();
      case 'sandbox': return this.renderSandboxConfig();
      case 'endpoints': return this.renderEndpointsConfig();
      case 'models': return this.renderModelsConfig();
      case 'roles': return this.renderRolesConfig();
      case 'agents': return this.renderAgentsConfig();
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
    if (Array.isArray(this.config?.endpoints)) {
      return this.config.endpoints;
    }
    if (Array.isArray(this.config?.ollama?.endpoints)) {
      return this.config.ollama.endpoints;
    }
    return [];
  }

  getDefaultEndpoint() {
    const endpoints = this.getConfigEndpoints();
    return endpoints.find((endpoint: any) => !!endpoint?.default) || endpoints[0] || null;
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
    const endpoints = this.getConfigEndpoints();
    if (typeof agent?.endpointKey === 'string' && agent.endpointKey.length > 0) {
      const explicitEndpoint = endpoints.find((endpoint: any) => endpoint.key === agent.endpointKey);
      if (explicitEndpoint) {
        return explicitEndpoint;
      }
    }

    return null;
  }

  getEndpointOllama(endpoint: any) {
    if (endpoint?.ollama && typeof endpoint.ollama === 'object') {
      return endpoint.ollama;
    }
    if (endpoint && (endpoint.baseUrl || endpoint.hostBaseUrl || endpoint.providerId || Array.isArray(endpoint.models) || Array.isArray(endpoint.modelOverrides))) {
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
    if (Array.isArray(runtime?.modelOverrides)) {
      return runtime.modelOverrides;
    }
    return [];
  }

  sanitizeModelEntries(models: any[] | undefined) {
    if (!Array.isArray(models)) return [];
    return models.map((model: any) => {
      const clone = JSON.parse(JSON.stringify(model));
      delete clone.name;
      return clone;
    });
  }

  sanitizeSharedCatalogEntries(models: any[] | undefined) {
    return this.sanitizeModelEntries(models).map((model: any) => {
      delete model.fallbackModelId;
      return model;
    });
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
    if (typeof clone.endpointKey !== 'string' || !clone.endpointKey.trim()) {
      delete clone.endpointKey;
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

  buildAgentsSchemaFromLegacy(config: any) {
    const multi = (config?.multiAgent && typeof config.multiAgent === 'object') ? config.multiAgent : {};
    const agentsList: any[] = [];
    const privateWorkspaces: any[] = [];
    const sharedAgentIds: string[] = [];

    const pushAgent = (agent: any, key?: string) => {
      if (!agent || typeof agent !== 'object' || typeof agent.id !== 'string' || !agent.id.trim()) return;
      const normalized = this.sanitizeAgentRecord(agent, key);
      delete normalized.workspaceMode;
      delete normalized.workspace;
      delete normalized.sharedWorkspaceAccess;
      if (key === 'strongAgent') {
        normalized.isMain = true;
      }
      agentsList.push(normalized);

      const isPrivate = agent.workspaceMode === 'private' || typeof agent.workspace === 'string' && agent.workspace.trim().length > 0;
      if (isPrivate) {
        privateWorkspaces.push({
          id: `workspace-${normalized.id}`,
          name: `${normalized.name || normalized.id} Workspace`,
          mode: 'private',
          path: typeof agent.workspace === 'string' && agent.workspace.trim().length > 0 ? agent.workspace : `/home/node/.openclaw/workspace-${normalized.id}`,
          allowSharedWorkspaceAccess: this.normalizeBoolean(agent.sharedWorkspaceAccess, false),
          enableAgentToAgent: this.normalizeBoolean(multi.enableAgentToAgent, false),
          manageWorkspaceAgentsMd: this.normalizeBoolean(multi.manageWorkspaceAgentsMd, false),
          agents: [normalized.id]
        });
      } else {
        sharedAgentIds.push(normalized.id);
      }
    };

    for (const key of this.getLegacyManagedAgentKeys()) {
      pushAgent(multi[key], key);
    }
    for (const agent of (Array.isArray(multi.extraAgents) ? multi.extraAgents : [])) {
      pushAgent(agent);
    }

    const workspaces: any[] = [];
    if ((multi.sharedWorkspace && this.normalizeBoolean(multi.sharedWorkspace.enabled, true)) || sharedAgentIds.length > 0) {
      workspaces.push({
        id: 'shared-main',
        name: 'Shared Workspace',
        mode: 'shared',
        path: multi.sharedWorkspace?.path || '/home/node/.openclaw/workspace',
        rolePolicyKey: multi.sharedWorkspace?.rolePolicyKey || 'sharedWorkspace',
        enableAgentToAgent: this.normalizeBoolean(multi.enableAgentToAgent, false),
        manageWorkspaceAgentsMd: this.normalizeBoolean(multi.manageWorkspaceAgentsMd, false),
        agents: sharedAgentIds
      });
    }
    workspaces.push(...privateWorkspaces);

    return {
      agents: {
        rolePolicies: JSON.parse(JSON.stringify(multi.rolePolicies || {})),
        telegramRouting: JSON.parse(JSON.stringify(multi.telegramRouting || {})),
        list: agentsList
      },
      workspaces
    };
  }

  buildLegacyMultiAgentView(config: any) {
    const agentsRoot = (config?.agents && typeof config.agents === 'object') ? config.agents : {};
    const agentsList = Array.isArray(agentsRoot.list) ? agentsRoot.list : [];
    const workspaces = Array.isArray(config?.workspaces) ? config.workspaces : [];
    const workspaceByAgentId = new Map<string, any>();

    for (const workspace of workspaces) {
      for (const agentId of (Array.isArray(workspace?.agents) ? workspace.agents : [])) {
        if (typeof agentId === 'string' && agentId.length > 0) {
          workspaceByAgentId.set(agentId, workspace);
        }
      }
    }

    const multi: any = {
      enableAgentToAgent: workspaces.some((workspace: any) => this.normalizeBoolean(workspace?.enableAgentToAgent, false)),
      manageWorkspaceAgentsMd: workspaces.some((workspace: any) => this.normalizeBoolean(workspace?.manageWorkspaceAgentsMd, false)),
      sharedWorkspace: { enabled: false },
      rolePolicies: JSON.parse(JSON.stringify(agentsRoot.rolePolicies || {})),
      telegramRouting: JSON.parse(JSON.stringify(agentsRoot.telegramRouting || {})),
      extraAgents: []
    };

    const primarySharedWorkspace = workspaces.find((workspace: any) => workspace?.mode === 'shared');
    if (primarySharedWorkspace) {
      multi.sharedWorkspace = {
        enabled: true,
        path: primarySharedWorkspace.path || '/home/node/.openclaw/workspace',
        rolePolicyKey: primarySharedWorkspace.rolePolicyKey || 'sharedWorkspace'
      };
    }

    const legacyKeys = new Set(this.getLegacyManagedAgentKeys());
    let inferredMainAssigned = false;
    for (const rawAgent of agentsList) {
      const workspace = workspaceByAgentId.get(rawAgent?.id);
      const agent = this.sanitizeAgentRecord(rawAgent, rawAgent?.key);
      if (workspace?.mode === 'private') {
        agent.workspaceMode = 'private';
        if (workspace.path) {
          agent.workspace = workspace.path;
        }
        if (workspace.allowSharedWorkspaceAccess) {
          agent.sharedWorkspaceAccess = true;
        }
      }

      const targetKey = typeof agent.key === 'string' && legacyKeys.has(agent.key)
        ? agent.key
        : (!inferredMainAssigned && agent.isMain ? 'strongAgent' : '');

      if (targetKey) {
        multi[targetKey] = agent;
        if (targetKey === 'strongAgent') {
          inferredMainAssigned = true;
        }
      } else {
        multi.extraAgents.push(agent);
      }
    }

    return multi;
  }

  buildPersistedConfig(config: any) {
    const clone = JSON.parse(JSON.stringify(config));
    const migrated = clone.multiAgent ? this.buildAgentsSchemaFromLegacy(clone) : {
      agents: clone.agents,
      workspaces: clone.workspaces
    };

    clone.agents = migrated.agents || { rolePolicies: {}, telegramRouting: {}, list: [] };
    clone.workspaces = Array.isArray(migrated.workspaces) ? migrated.workspaces.map((workspace: any) => this.normalizeWorkspaceRecord(workspace)) : [];
    if (Array.isArray(clone.agents?.list)) {
      clone.agents.list = clone.agents.list.map((agent: any) => {
        const normalized = this.sanitizeAgentRecord(agent, agent?.key);
        delete normalized.modelSource;
        delete normalized.workspaceMode;
        delete normalized.workspace;
        delete normalized.sharedWorkspaceAccess;
        if (typeof normalized.endpointKey !== 'string' || !normalized.endpointKey.trim()) {
          delete normalized.endpointKey;
        }
        return normalized;
      });
    }
    delete clone.multiAgent;
    return clone;
  }

  sanitizeConfigModelNames(config: any) {
    const clone = JSON.parse(JSON.stringify(config));
    if (!clone) return clone;
    if (!clone.agents && clone.multiAgent) {
      const migrated = this.buildAgentsSchemaFromLegacy(clone);
      clone.agents = migrated.agents;
      clone.workspaces = migrated.workspaces;
    }
    if (!clone.agents || typeof clone.agents !== 'object') {
      clone.agents = { rolePolicies: {}, telegramRouting: {}, list: [] };
    }
    if (!Array.isArray(clone.agents.list)) {
      clone.agents.list = [];
    }
    if (!Array.isArray(clone.workspaces)) {
      clone.workspaces = [];
    }
    clone.workspaces = clone.workspaces.map((workspace: any) => this.normalizeWorkspaceRecord(workspace));
    clone.agents.list = clone.agents.list.map((agent: any) => {
      const normalized = this.sanitizeAgentRecord(agent, agent?.key);
      delete normalized.workspaceMode;
      delete normalized.workspace;
      delete normalized.sharedWorkspaceAccess;
      return normalized;
    });
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
      if (Array.isArray(clone.telegram.groups)) {
        clone.telegram.groups = clone.telegram.groups.map((group: any) => this.normalizeTelegramGroupRecord(group));
      } else {
        clone.telegram.groups = [];
      }
      if (clone.telegram.execApprovals && typeof clone.telegram.execApprovals === 'object') {
        clone.telegram.execApprovals.enabled = this.normalizeBoolean(clone.telegram.execApprovals.enabled, false);
        if (!Array.isArray(clone.telegram.execApprovals.approvers)) {
          clone.telegram.execApprovals.approvers = [];
        }
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
      if (Array.isArray(endpoint?.hostedModels)) {
        normalized.hostedModels = this.sanitizeModelEntries(endpoint.hostedModels);
      }

      const rawRuntime = endpoint?.ollama || endpoint;
      const hasRuntime = !!endpoint?.ollama ||
        !!endpoint?.baseUrl ||
        !!endpoint?.hostBaseUrl ||
        !!endpoint?.providerId ||
        Array.isArray(endpoint?.models) ||
        Array.isArray(endpoint?.modelOverrides) ||
        Array.isArray(endpoint?.desiredModelIds);

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
        } else if (Array.isArray(rawRuntime?.modelOverrides)) {
          runtime.models = this.sanitizeModelEntries(rawRuntime.modelOverrides);
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
    } else if (Array.isArray(clone.ollama.endpoints)) {
      clone.endpoints = clone.ollama.endpoints.map((endpoint: any) => normalizeEndpoint(endpoint));
      delete clone.ollama.endpoints;
    } else {
      clone.endpoints = [];
    }

    clone.multiAgent = this.buildLegacyMultiAgentView(clone);

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
    delete clone.fallbackModelId;
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

    for (const model of this.getSharedModelCatalog()) {
      if (this.isHostedCatalogModel(model) && !seen.has(model.modelRef)) {
        seen.add(model.modelRef);
        models.push(model);
      }
    }

    for (const endpoint of this.getConfigEndpoints()) {
      for (const model of this.getEndpointHostedModels(endpoint)) {
        if (this.isHostedCatalogModel(model) && !seen.has(model.modelRef)) {
          seen.add(model.modelRef);
          models.push(model);
        }
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
          kind: 'local',
          fallbackModelId: model.fallbackModelId || ''
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
          kind: 'hosted',
          fallbackModelId: model.fallbackModelId || ''
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
    const entries: any[] = [];
    const managedKeys = [
      'strongAgent',
      'researchAgent',
      'localChatAgent',
      'hostedTelegramAgent',
      'localReviewAgent',
      'localCoderAgent',
      'remoteReviewAgent',
      'remoteCoderAgent'
    ];

    for (const key of managedKeys) {
      const agent = this.config?.multiAgent?.[key];
      if (agent?.id) {
        entries.push({ key, agent });
      }
    }

    for (const [idx, agent] of (this.config?.multiAgent?.extraAgents || []).entries()) {
      if (agent?.id) {
        entries.push({ key: `extra:${idx}`, agent });
      }
    }

    return entries;
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

    const telegramRouting = this.config?.multiAgent?.telegramRouting;
    if (telegramRouting && telegramRouting.targetAgentId === agentId) {
      delete telegramRouting.targetAgentId;
    }

    if (this.topologyLinkSourceAgentId === agentId) {
      this.topologyLinkSourceAgentId = null;
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
    return agent?.workspaceMode || (this.config?.multiAgent?.sharedWorkspace?.enabled ? 'shared' : 'private');
  }

  getTopologyAgentEntries() {
    return this.getManagedAgentEntries().map(({ key, agent }: any) => ({
      key,
      agent,
      id: String(agent?.id || key),
      name: String(agent?.name || agent?.id || key),
      enabled: this.getAgentEnabledState(key, agent),
      isMain: key === 'strongAgent',
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

  assignTopologyAgentToEndpoint(agentKey: string, endpointKey: string | null) {
    const entry = this.getTopologyAgentEntryByKey(agentKey);
    if (!entry) return;
    if (endpointKey && endpointKey.length > 0) {
      entry.agent.endpointKey = endpointKey;
    } else {
      delete entry.agent.endpointKey;
    }
    const endpoint = endpointKey ? this.getConfigEndpoints().find((candidate: any) => candidate.key === endpointKey) : null;
    this.syncAgentEndpointModelSelection(entry.agent, endpoint);
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
    this.editingAgentKey = agentKey;
    this.activeTab = 'config';
    this.configSection = 'agents';
  }

  getTopologySlots() {
    const slots = this.getConfigEndpoints().map((endpoint: any) => ({
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

    const endpoints = this.getConfigEndpoints();

    return html`
      <div class="card">
        <div class="card-header">
          <h3>Endpoints</h3>
          <button class="btn btn-ghost" @click=${() => this.addEndpoint()}>+ Add Endpoint</button>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Endpoints are machines or PCs. Each one can expose a local Ollama runtime, a hosted model pool, or both.</p>
        ${repeat(endpoints, (ep: any) => ep.key, (ep: any, idx) => {
          const runtime = this.getEndpointOllama(ep);
          return html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${ep.key}</span>
              <span class="item-sub">${runtime?.hostBaseUrl || 'Hosted-only endpoint'} | ${this.getEndpointModels(ep).length} local, ${this.getEndpointHostedModels(ep).length} hosted</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" @click=${() => this.editingEndpointKey = ep.key}>Configure Endpoint</button>
              <button class="btn btn-danger" @click=${() => this.removeEndpoint(idx)}>Remove</button>
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

      return html`
        <div class="card">
            <div class="card-header">
                <h3>Endpoint: ${ep.key}</h3>
                <button class="btn btn-ghost" @click=${() => this.editingEndpointKey = null}>Back to Endpoints</button>
            </div>

            <div class="grid-2">
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

            <h4 style="color: #666; margin-top: 20px;">Local Runtime Models</h4>
            <p style="font-size: 0.8rem; color: #888; margin-bottom: 15px;">Models listed here are desired on this machine's local runtime. Bootstrap will pull them when they fit the machine.</p>
             
            ${endpointModels.map((mo: any, idx: number) => html`
                <div class="item-row">
                    <div class="item-info">
                        <span class="item-title">${mo.id}</span>
                        <span class="item-sub">${mo.fallbackModelId ? `Local fallback: ollama/${mo.fallbackModelId} | ` : ''}Ctx: ${mo.contextWindow} | MaxTokens: ${mo.maxTokens || 8192}</span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        ${endpointModels.length > 1 ? html`
                            <select @change=${(e: any) => {
                                const value = e.target.value;
                                if (value) {
                                    mo.fallbackModelId = value;
                                } else {
                                    delete mo.fallbackModelId;
                                }
                                this.requestUpdate();
                            }}>
                                <option value="" ?selected=${!mo.fallbackModelId}>No local fallback</option>
                                ${endpointModels
                                    .filter((localModel: any) => localModel.id !== mo.id)
                                    .map((localModel: any) => html`<option value=${localModel.id} ?selected=${mo.fallbackModelId === localModel.id}>${localModel.id}</option>`)}
                            </select>
                        ` : ''}
                        <button class="btn btn-secondary" @click=${() => this.tuneExistingModel(ep.key, mo.id)}>Re-Tune</button>
                        <button class="btn btn-danger" @click=${() => { endpointModels.splice(idx, 1); this.requestUpdate(); }}>Remove</button>
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
            <p style="font-size: 0.8rem; color: #888; margin-bottom: 15px;">These are provider-backed models available from this endpoint, such as OpenAI, Claude, Gemini, Copilot, or Ollama Cloud refs.</p>

            ${endpointHostedModels.map((model: any, idx: number) => html`
                <div class="item-row">
                    <div class="item-info">
                        <span class="item-title">${model.modelRef}</span>
                        <span class="item-sub">${model.fallbackModelId ? `Local fallback: ollama/${model.fallbackModelId}` : 'Hosted provider model'}</span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        ${endpointModels.length > 0 ? html`
                            <select @change=${(e: any) => {
                                const value = e.target.value;
                                if (value) {
                                    model.fallbackModelId = value;
                                } else {
                                    delete model.fallbackModelId;
                                }
                                this.requestUpdate();
                            }}>
                                <option value="" ?selected=${!model.fallbackModelId}>No local fallback</option>
                                ${endpointModels.map((localModel: any) => html`<option value=${localModel.id} ?selected=${model.fallbackModelId === localModel.id}>${localModel.id}</option>`)}
                            </select>
                        ` : ''}
                        <button class="btn btn-danger" @click=${() => { endpointHostedModels.splice(idx, 1); this.requestUpdate(); }}>Remove</button>
                    </div>
                </div>
            `)}

            <div style="margin-top: 20px;">
                <button class="btn btn-secondary" @click=${() => { this.selectorTarget = 'endpoint-hosted'; this.showModelSelector = true; }}>+ Add Hosted Model from Catalog</button>
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
          endpoint.hostedModels.push(this.cloneModelCatalogEntry(catalogEntry));
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

  renderRolesConfig() {
      const roles = this.config.multiAgent.rolePolicies || {};
      return html`
        <div class="card">
            <div class="card-header">
                <h3>Role Policies</h3>
                <button class="btn btn-ghost" @click=${() => this.addRole()}>+ Add Role</button>
            </div>
            <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Role policies are sets of instructions injected into agents at runtime.</p>
            ${Object.keys(roles).map(roleKey => html`
                <div class="form-group" style="margin-bottom: 25px; border-bottom: 1px solid #333; padding-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <span style="font-weight: bold; color: #00bcd4;">${roleKey}</span>
                        <button class="btn btn-danger btn-small" style="padding: 4px 10px;" @click=${() => this.removeRole(roleKey)}>Delete Role</button>
                    </div>
                    <textarea rows="8" @input=${(e: any) => { this.config.multiAgent.rolePolicies[roleKey] = e.target.value.split('\n'); this.requestUpdate(); }}>${roles[roleKey].join('\n')}</textarea>
                </div>
            `)}
        </div>
      `;
  }

  addRole() {
      const key = prompt('New Role Key (e.g. specializedCoder):');
      if (key) {
          if (!this.config.multiAgent.rolePolicies) this.config.multiAgent.rolePolicies = {};
          this.config.multiAgent.rolePolicies[key] = ["# AGENTS.md - New Role", "", "## Role", "- Instruction 1"];
          this.requestUpdate();
      }
  }

  removeRole(key: string) {
      if (confirm(`Delete role policy "${key}"?`)) {
          delete this.config.multiAgent.rolePolicies[key];
          this.requestUpdate();
      }
  }

  renderAgentsConfig() {
    if (this.editingAgentKey) {
        return this.renderAgentEditor(this.editingAgentKey);
    }

    const agents = this.getManagedAgentEntries().map(({ key, agent }: any) => ({
      key,
      ...agent,
      enabled: this.getAgentEnabledState(key, agent)
    }));
    const sharedWorkspace = this.config.multiAgent.sharedWorkspace || (this.config.multiAgent.sharedWorkspace = { enabled: false });

    return html`
      <div class="card">
        <div class="card-header">
            <h3>Agents Configuration</h3>
            <button class="btn btn-ghost" @click=${() => this.addExtraAgent()}>+ Add Agent</button>
        </div>
        
        <div class="grid-2" style="margin-bottom: 25px;">
            <div class="card" style="margin-bottom: 0;">
                <div class="card-header"><h3>Workspace Collaboration</h3></div>
                <div class="form-group">
                    <label class="toggle-switch">
                        <input type="checkbox" ?checked=${sharedWorkspace.enabled} @change=${(e: any) => { sharedWorkspace.enabled = e.target.checked; this.requestUpdate(); }}>
                        Enable shared workspace
                    </label>
                </div>
                <div class="form-group">
                    <label>Shared Workspace Path</label>
                    <input type="text" .value=${sharedWorkspace.path || ''} @input=${(e: any) => { sharedWorkspace.path = e.target.value; this.requestUpdate(); }}>
                </div>
                <div class="form-group">
                    <label>Shared Workspace Role Policy</label>
                    <select @change=${(e: any) => {
                        const value = e.target.value;
                        if (value) {
                            sharedWorkspace.rolePolicyKey = value;
                        } else {
                            delete sharedWorkspace.rolePolicyKey;
                        }
                        this.requestUpdate();
                    }}>
                        <option value="">Default sharedWorkspace policy</option>
                        ${Object.keys(this.config.multiAgent.rolePolicies || {}).map((role: string) => html`
                            <option value=${role} ?selected=${sharedWorkspace.rolePolicyKey === role}>${role}</option>
                        `)}
                    </select>
                </div>
            </div>

            <div class="card" style="margin-bottom: 0;">
                <div class="card-header"><h3>Managed Agent Wiring</h3></div>
                <div class="form-group">
                    <label class="toggle-switch">
                        <input type="checkbox" ?checked=${this.config.multiAgent.enableAgentToAgent} @change=${(e: any) => { this.config.multiAgent.enableAgentToAgent = e.target.checked; this.requestUpdate(); }}>
                        Enable agent-to-agent tool
                    </label>
                </div>
                <div class="form-group">
                    <label class="toggle-switch">
                        <input type="checkbox" ?checked=${this.config.multiAgent.manageWorkspaceAgentsMd} @change=${(e: any) => { this.config.multiAgent.manageWorkspaceAgentsMd = e.target.checked; this.requestUpdate(); }}>
                        Manage AGENTS.md files in workspaces
                    </label>
                </div>
            </div>
        </div>

        <h4 style="color: #666; margin-bottom: 10px;">All Agents</h4>
        ${agents.map(agent => html`
          <div class="item-row" style="${!agent.enabled ? 'opacity: 0.5;' : ''}">
            <div class="item-info">
              <span class="item-title">
                ${agent.name} 
                ${agent.key === 'strongAgent' ? html`<span class="badge" style="background: #ffc107;">Main</span>` : ''}
                ${!agent.enabled ? html`<span style="color: #f44336; font-size: 0.7rem;">(Disabled)</span>` : ''}
              </span>
              <span class="item-sub">ID: ${agent.id} | Model: ${agent.modelRef} | Workspace: ${agent.workspaceMode || (sharedWorkspace.enabled ? 'shared' : 'private')} | Sandbox: ${agent.sandboxMode || 'default'}</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" @click=${() => this.editingAgentKey = agent.key}>Configure</button>
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
      if (!this.editingAgentKey) return null;
      if (this.editingAgentKey.startsWith('extra:')) {
          const idx = parseInt(this.editingAgentKey.split(':')[1]);
          return this.config.multiAgent.extraAgents[idx];
      }
      return this.config.multiAgent[this.editingAgentKey];
  }

  renderAgentEditor(key: string) {
    const agent = this.getEditingAgent();
    if (!agent) return html`Agent not found`;
    const isMain = this.isMainAgentEntry(key, agent);

    const endpoints = this.getConfigEndpoints();
    const roles = Object.keys(this.config.multiAgent.rolePolicies || {});
    const subagents = this.ensureSubagentsConfig(agent);
    const effectiveWorkspaceMode = agent.workspaceMode || (this.config.multiAgent.sharedWorkspace?.enabled ? 'shared' : 'private');
    const selectedEndpoint = this.resolveAgentEndpoint(agent);
    const effectiveEndpointKey = (typeof agent.endpointKey === 'string' && agent.endpointKey.length > 0)
      ? agent.endpointKey
      : (selectedEndpoint?.key || '');
    const endpointModelOptions = selectedEndpoint ? this.getEndpointModelOptions(selectedEndpoint) : [];
    const allowedAgentChoices = this.getAllowedAgentChoices(agent.id);
    const selectedAllowedAgents = Array.isArray(subagents.allowAgents) ? subagents.allowAgents : (subagents.allowAgents = []);
    const candidateModelRefs = Array.isArray(agent.candidateModelRefs) ? agent.candidateModelRefs : (agent.candidateModelRefs = []);
    const sandboxModeOverride = typeof agent.sandboxMode === 'string' ? agent.sandboxMode : '';
    const forceSandboxOff = sandboxModeOverride === 'off';

    return html`
        <div class="card">
            <div class="card-header">
                <h3>Edit Agent: ${agent.name}</h3>
                <button class="btn btn-ghost" @click=${() => this.editingAgentKey = null}>Back to List</button>
            </div>
            
            <div class="grid-2">
                <div class="form-group">
                    <label>Display Name</label>
                    <input type="text" .value=${agent.name} @input=${(e: any) => { agent.name = e.target.value; this.requestUpdate(); }}>
                </div>
                <div class="form-group">
                    <label>Agent ID</label>
                    <input type="text" .value=${agent.id} ?disabled=${isMain} @input=${(e: any) => { agent.id = e.target.value; this.requestUpdate(); }}>
                </div>
            </div>

            <div class="grid-2">
                <div class="form-group">
                    <label>Role Policy</label>
                    <select @change=${(e: any) => { agent.rolePolicyKey = e.target.value; this.requestUpdate(); }}>
                        ${roles.map(r => html`<option value=${r} ?selected=${agent.rolePolicyKey === r}>${r}</option>`)}
                    </select>
                </div>
                <div class="form-group">
                    <label>Endpoint</label>
                    <select @change=${(e: any) => {
                        agent.endpointKey = e.target.value;
                        const endpoint = endpoints.find((entry: any) => entry.key === agent.endpointKey);
                        this.syncAgentEndpointModelSelection(agent, endpoint);
                        this.requestUpdate();
                    }}>
                        <option value="">Select Endpoint</option>
                        ${endpoints.map((ep: any) => html`<option value=${ep.key} ?selected=${effectiveEndpointKey === ep.key}>${ep.key}</option>`)}
                    </select>
                </div>
            </div>

            <div class="grid-2">
                <div class="form-group">
                    <label>Workspace Mode</label>
                    <select @change=${(e: any) => { agent.workspaceMode = e.target.value; this.requestUpdate(); }}>
                        <option value="shared" ?selected=${effectiveWorkspaceMode === 'shared'}>shared</option>
                        <option value="private" ?selected=${effectiveWorkspaceMode === 'private'}>private</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Sandbox Mode Override</label>
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

            ${effectiveWorkspaceMode === 'private' ? html`
                <div class="form-group">
                    <label>Private Workspace Path</label>
                    <input type="text" .value=${agent.workspace || ''} placeholder="/home/node/.openclaw/workspace-${agent.id}" @input=${(e: any) => {
                        const value = e.target.value.trim();
                        if (value) {
                            agent.workspace = value;
                        } else {
                            delete agent.workspace;
                        }
                        this.requestUpdate();
                    }}>
                </div>
            ` : ''}

            ${effectiveWorkspaceMode === 'private' && this.config.multiAgent.sharedWorkspace?.enabled ? html`
            <div class="form-group">
                <label class="toggle-switch">
                    <input type="checkbox" ?checked=${!!agent.sharedWorkspaceAccess} @change=${(e: any) => { agent.sharedWorkspaceAccess = e.target.checked; this.requestUpdate(); }}>
                    Allow private workspace agent to access the shared workspace
                </label>
            </div>
            ` : ''}

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

            <div class="form-group">
                <label class="toggle-switch">
                    <input type="checkbox" ?checked=${!!agent.enabled} @change=${(e: any) => { agent.enabled = e.target.checked; this.requestUpdate(); }}>
                    Enable this Agent
                </label>
            </div>
        </div>
    `;
  }

  renderFeaturesConfig() {
      const telegram = (this.config?.telegram && typeof this.config.telegram === 'object') ? this.config.telegram : {};
      const voiceNotes = this.ensureVoiceNotesConfig();
      const whisperModelOptions = this.getVoiceWhisperModelOptions();
      const selectedWhisperModel = whisperModelOptions.includes(voiceNotes.whisperModel) ? voiceNotes.whisperModel : '__custom__';
      const telegramAllowFrom = Array.isArray(telegram.allowFrom) ? telegram.allowFrom : [];
      const telegramGroupAllowFrom = Array.isArray(telegram.groupAllowFrom) ? telegram.groupAllowFrom : [];
      const telegramGroups = Array.isArray(telegram.groups) ? telegram.groups : [];
      const telegramExecApprovals = (telegram.execApprovals && typeof telegram.execApprovals === 'object') ? telegram.execApprovals : { approvers: [], target: 'dm' };
      const telegramExecApprovers = Array.isArray(telegramExecApprovals.approvers) ? telegramExecApprovals.approvers : [];
    return html`
      <div class="grid-2">
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
        
        <div class="card">
          <div class="card-header"><h3>Telegram</h3></div>
          <div class="form-group">
             <label class="toggle-switch">
                <input type="checkbox" ?checked=${telegram.enabled} @change=${(e: any) => { this.ensureTelegramConfig().enabled = e.target.checked; this.requestUpdate(); }}>
                Enable Telegram Bot
             </label>
             <span class="help-text">Use the Telegram Setup action from Status or Ops to authenticate the live channel. The dashboard no longer stores Telegram token fields in toolkit config.</span>
           </div>
          <div class="form-group">
            <label>DM Policy</label>
            <select @change=${(e: any) => { this.ensureTelegramConfig().dmPolicy = e.target.value; this.requestUpdate(); }}>
              <option value="pairing" ?selected=${(telegram.dmPolicy || 'pairing') === 'pairing'}>pairing</option>
              <option value="allowlist" ?selected=${telegram.dmPolicy === 'allowlist'}>allowlist</option>
              <option value="open" ?selected=${telegram.dmPolicy === 'open'}>open</option>
              <option value="disabled" ?selected=${telegram.dmPolicy === 'disabled'}>disabled</option>
            </select>
          </div>
          <div class="form-group">
            <label>Allowed User IDs (comma separated)</label>
            <input type="text" .value=${telegramAllowFrom.join(',')} @input=${(e: any) => { this.ensureTelegramConfig().allowFrom = this.parseCommaSeparatedList(e.target.value); this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Group Policy</label>
            <select @change=${(e: any) => { this.ensureTelegramConfig().groupPolicy = e.target.value; this.requestUpdate(); }}>
              <option value="allowlist" ?selected=${(telegram.groupPolicy || 'allowlist') === 'allowlist'}>allowlist</option>
              <option value="open" ?selected=${telegram.groupPolicy === 'open'}>open</option>
              <option value="disabled" ?selected=${telegram.groupPolicy === 'disabled'}>disabled</option>
            </select>
          </div>
          <div class="form-group">
            <label>Allowed Group Sender IDs (comma separated)</label>
            <input type="text" .value=${telegramGroupAllowFrom.join(',')} @input=${(e: any) => { this.ensureTelegramConfig().groupAllowFrom = this.parseCommaSeparatedList(e.target.value); this.requestUpdate(); }}>
            <span class="help-text">Leave empty to fall back to the DM allowlist. Put group chat IDs under the groups list below, not here.</span>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
                <input type="checkbox" ?checked=${!!telegramExecApprovals.enabled} @change=${(e: any) => { this.ensureTelegramExecApprovalsConfig().enabled = e.target.checked; this.requestUpdate(); }}>
                Enable Telegram exec approvals
            </label>
          </div>
          <div class="form-group">
            <label>Exec Approver IDs (comma separated)</label>
            <input type="text" .value=${telegramExecApprovers.join(',')} @input=${(e: any) => { this.ensureTelegramExecApprovalsConfig().approvers = this.parseCommaSeparatedList(e.target.value); this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Exec Approval Target</label>
            <select @change=${(e: any) => { this.ensureTelegramExecApprovalsConfig().target = e.target.value; this.requestUpdate(); }}>
              <option value="dm" ?selected=${(telegramExecApprovals.target || 'dm') === 'dm'}>dm</option>
              <option value="channel" ?selected=${telegramExecApprovals.target === 'channel'}>channel</option>
              <option value="both" ?selected=${telegramExecApprovals.target === 'both'}>both</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0;">
            <div class="card-header" style="margin-bottom: 12px;">
              <h3>Allowed Groups</h3>
              <button class="btn btn-ghost" @click=${() => this.addTelegramGroup()}>+ Add Group</button>
            </div>
            ${telegramGroups.length === 0 ? html`
              <span class="help-text">No Telegram groups configured yet. Add a negative Telegram group ID here to enable trusted group routing.</span>
            ` : telegramGroups.map((group: any, index: number) => html`
              <div class="card" style="padding: 14px; margin-bottom: 12px;">
                <div class="form-group">
                  <label>Group ID</label>
                  <input type="text" .value=${group.id || ''} @input=${(e: any) => { group.id = e.target.value; this.requestUpdate(); }}>
                </div>
                <div class="form-group">
                  <label class="toggle-switch">
                    <input type="checkbox" ?checked=${!!group.requireMention} @change=${(e: any) => { group.requireMention = e.target.checked; this.requestUpdate(); }}>
                    Require mention
                  </label>
                </div>
                <div class="form-group">
                  <label>Allowed Sender IDs (comma separated)</label>
                  <input type="text" .value=${Array.isArray(group.allowFrom) ? group.allowFrom.join(',') : ''} @input=${(e: any) => { group.allowFrom = this.parseCommaSeparatedList(e.target.value); this.requestUpdate(); }}>
                </div>
                <div class="form-group">
                  <label>Group Policy Override</label>
                  <select @change=${(e: any) => { group.groupPolicy = e.target.value; this.requestUpdate(); }}>
                    <option value="" ?selected=${!group.groupPolicy}>Use top-level policy</option>
                    <option value="allowlist" ?selected=${group.groupPolicy === 'allowlist'}>allowlist</option>
                    <option value="open" ?selected=${group.groupPolicy === 'open'}>open</option>
                    <option value="disabled" ?selected=${group.groupPolicy === 'disabled'}>disabled</option>
                  </select>
                </div>
                <button class="btn btn-danger" @click=${() => this.removeTelegramGroup(index)}>Remove Group</button>
              </div>
            `)}
          </div>
        </div>
      </div>
    `;
  }

  // Helpers
  addExtraAgent() {
      if (!this.config.multiAgent.extraAgents) this.config.multiAgent.extraAgents = [];
      const newAgent = {
          enabled: true,
          id: 'new-agent-' + Date.now(),
          name: 'New Agent',
          rolePolicyKey: 'codingDelegate',
          modelSource: 'local',
          workspaceMode: 'private',
          sharedWorkspaceAccess: false,
          sandboxMode: 'off',
          modelRef: 'ollama/qwen2.5-coder:3b',
          candidateModelRefs: [],
          subagents: {
              requireAgentId: true,
              allowAgents: []
          }
      };
      this.config.multiAgent.extraAgents.push(newAgent);
      this.editingAgentKey = `extra:${this.config.multiAgent.extraAgents.length - 1}`;
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

      if (key.startsWith('extra:')) {
          const idx = parseInt(key.split(':')[1], 10);
          if (!Number.isNaN(idx)) {
              this.config.multiAgent.extraAgents.splice(idx, 1);
              if (this.editingAgentKey?.startsWith('extra:')) {
                  const editingIdx = parseInt(this.editingAgentKey.split(':')[1], 10);
                  if (!Number.isNaN(editingIdx)) {
                      if (editingIdx === idx) {
                          this.editingAgentKey = null;
                      } else if (editingIdx > idx) {
                          this.editingAgentKey = `extra:${editingIdx - 1}`;
                      }
                  }
              }
          }
      } else if (this.config.multiAgent && Object.prototype.hasOwnProperty.call(this.config.multiAgent, key)) {
          delete this.config.multiAgent[key];
      }

      if (this.editingAgentKey === key) {
          this.editingAgentKey = null;
      }

      this.requestUpdate();
  }

  addEndpoint() {
    const key = prompt('Endpoint Key:');
    if (key) {
        if (!this.config.endpoints) this.config.endpoints = [];
        this.config.endpoints.push({
            key,
            default: this.getConfigEndpoints().length === 0,
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

  removeEndpoint(idx: number) {
    if (confirm('Remove endpoint?')) {
        this.getConfigEndpoints().splice(idx, 1);
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
