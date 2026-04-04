import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

@customElement('toolkit-dashboard')
export class ToolkitDashboard extends LitElement {
  @state() private config: any = null;
  @state() private statusOutput: string = '';
  @state() private logs: string[] = [];
  @state() private isRunning: boolean = false;
  @state() private activeTab: string = 'status';
  @state() private configSection: string = 'general';
  private ws: WebSocket | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      min-height: 100vh;
      background-color: #0f0f0f;
    }
    .layout {
      display: grid;
      grid-template-columns: 240px 1fr;
      min-height: 100vh;
      width: 100vw;
    }
    aside {
      background: #1a1a1a;
      border-right: 1px solid #333;
      padding: 20px 0;
      display: flex;
      flex-direction: column;
    }
    .nav-item {
      padding: 12px 24px;
      cursor: pointer;
      color: #aaa;
      transition: all 0.2s;
      border-left: 3px solid transparent;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .nav-item:hover { background: #252525; color: #fff; }
    .nav-item.active {
      background: #2a2a2a;
      color: #00bcd4;
      border-left-color: #00bcd4;
    }
    main {
      padding: 30px;
      overflow-y: auto;
      max-height: 100vh;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
    }
    h1 { margin: 0; font-size: 1.4rem; color: #fff; display: flex; align-items: center; gap: 10px; }
    .badge {
      background: #00bcd4;
      color: #000;
      font-size: 0.7rem;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: bold;
    }
    .card {
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
      border-bottom: 1px solid #333;
      padding-bottom: 10px;
    }
    .card-header h3 { margin: 0; font-size: 1.1rem; color: #00bcd4; }
    
    .form-group { margin-bottom: 15px; }
    label { display: block; margin-bottom: 6px; font-size: 0.85rem; color: #888; }
    input, select, textarea {
      width: 100%;
      background: #2a2a2a;
      border: 1px solid #444;
      color: #fff;
      padding: 10px;
      border-radius: 4px;
      font-size: 0.9rem;
    }
    input:focus { border-color: #00bcd4; outline: none; }
    
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    
    .btn {
      padding: 10px 18px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9rem;
      transition: opacity 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-primary { background: #00bcd4; color: #000; }
    .btn-secondary { background: #333; color: #fff; }
    .btn-danger { background: #f44336; color: #fff; }
    .btn-ghost { background: transparent; color: #888; border: 1px solid #444; }
    .btn:hover { opacity: 0.8; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }

    pre {
      background: #050505;
      padding: 15px;
      border-radius: 6px;
      font-family: 'Cascadia Code', 'Consolas', monospace;
      font-size: 0.85rem;
      line-height: 1.4;
      border: 1px solid #222;
      overflow-x: auto;
    }

    .log-container {
      background: #000;
      height: 500px;
      overflow-y: auto;
      padding: 15px;
      border-radius: 6px;
      font-family: monospace;
      border: 1px solid #333;
    }
    .log-entry { margin-bottom: 2px; white-space: pre-wrap; word-break: break-all; }

    .item-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      background: #252525;
      border: 1px solid #333;
      border-radius: 4px;
      margin-bottom: 8px;
    }
    .item-info { display: flex; flex-direction: column; gap: 4px; }
    .item-title { font-weight: bold; color: #fff; }
    .item-sub { font-size: 0.75rem; color: #777; }
    
    .tabs { display: flex; gap: 10px; margin-bottom: 20px; }
    .tab {
      padding: 10px 20px;
      cursor: pointer;
      border: 1px solid #333;
      background: #1a1a1a;
      border-radius: 4px;
      font-size: 0.9rem;
      color: #888;
      transition: all 0.2s;
    }
    .tab:hover {
      background: #252525;
      color: #fff;
      border-color: #444;
    }
    .tab.active {
      background: #00bcd4;
      color: #000;
      border-color: #00bcd4;
      font-weight: 600;
    }
  `;

  async firstUpdated() {
    await this.fetchConfig();
    await this.fetchStatus();
    this.connectWS();
  }

  async fetchConfig() {
    try {
      const res = await fetch('http://127.0.0.1:18791/api/config');
      this.config = await res.json();
    } catch (err) {
      console.error('Failed to fetch config', err);
    }
  }

  async fetchStatus() {
    try {
      const res = await fetch('http://127.0.0.1:18791/api/status');
      const data = await res.json();
      this.statusOutput = data.output;
    } catch (err) {
      console.error('Failed to fetch status', err);
    }
  }

  connectWS() {
    this.ws = new WebSocket('ws://127.0.0.1:18791');
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'stdout' || msg.type === 'stderr') {
        this.logs = [...this.logs, msg.data];
        this.requestUpdate();
        setTimeout(() => {
          const container = this.shadowRoot?.querySelector('.log-container');
          if (container) container.scrollTop = container.scrollHeight;
        }, 0);
      } else if (msg.type === 'exit') {
        this.isRunning = false;
        this.logs = [...this.logs, `\n[FINISH] Process exited with code ${msg.code}`];
        this.fetchStatus();
      }
    };
  }

  runCommand(command: string, args: string[] = []) {
    if (!this.ws || this.isRunning) return;
    this.isRunning = true;
    this.logs = [`[START] Running: ${command} ${args.join(' ')}...\n`];
    this.activeTab = 'logs';
    this.ws.send(JSON.stringify({ type: 'run-command', command, args }));
  }

  async saveConfig() {
    try {
      const res = await fetch('http://127.0.0.1:18791/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.config)
      });
      if (res.ok) alert('Configuration saved successfully.');
      else throw new Error('Failed to save');
    } catch (err) {
      alert('Error saving configuration.');
    }
  }

  render() {
    return html`
      <div class="layout">
        <aside>
          <div style="padding: 0 24px 20px;">
            <h1>OpenClaw <span class="badge">Toolkit</span></h1>
          </div>
          
          <div class="nav-item ${this.activeTab === 'status' ? 'active' : ''}" @click=${() => this.activeTab = 'status'}>
            Status
          </div>
          <div class="nav-item ${this.activeTab === 'config' ? 'active' : ''}" @click=${() => this.activeTab = 'config'}>
            Configuration
          </div>
          <div class="nav-item ${this.activeTab === 'ops' ? 'active' : ''}" @click=${() => this.activeTab = 'ops'}>
            Operations
          </div>
          <div class="nav-item ${this.activeTab === 'logs' ? 'active' : ''}" @click=${() => this.activeTab = 'logs'}>
            Terminal Logs ${this.isRunning ? html`<span style="color: #00bcd4;">●</span>` : ''}
          </div>
        </aside>

        <main>
          ${this.renderContent()}
        </main>
      </div>
    `;
  }

  renderContent() {
    switch (this.activeTab) {
      case 'status': return this.renderStatus();
      case 'config': return this.renderConfig();
      case 'ops': return this.renderOps();
      case 'logs': return this.renderLogs();
      default: return html`Select a tab`;
    }
  }

  renderStatus() {
    return html`
      <header>
        <h2>System Health</h2>
        <button class="btn btn-secondary" @click=${this.fetchStatus}>Refresh</button>
      </header>
      <div class="card">
        <pre>${this.statusOutput || 'Gathers system status...'}</pre>
      </div>
    `;
  }

  renderLogs() {
    return html`
      <header>
        <h2>Process Output</h2>
        ${this.isRunning ? html`<button class="btn btn-danger" disabled>Stop Process</button>` : ''}
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
      { id: 'start', name: 'Start', desc: 'Launch Docker and OpenClaw' },
      { id: 'stop', name: 'Stop', desc: 'Stop all services' },
      { id: 'backup', name: 'Backup', desc: 'Create portable recovery snapshot' },
      { id: 'compact-storage', name: 'Compact Storage', desc: 'Shrink Docker data disk' }
    ];

    return html`
      <header><h2>Available Operations</h2></header>
      <div class="grid-2">
        ${ops.map(op => html`
          <div class="card">
            <h3>${op.name}</h3>
            <p style="color: #888; font-size: 0.85rem; margin: 10px 0 20px;">${op.desc}</p>
            <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand(op.id)}>Run Action</button>
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
          <div class="tab ${this.configSection === 'endpoints' ? 'active' : ''}" @click=${() => this.configSection = 'endpoints'}>Endpoints</div>
          <div class="tab ${this.configSection === 'models' ? 'active' : ''}" @click=${() => this.configSection = 'models'}>Models</div>
          <div class="tab ${this.configSection === 'agents' ? 'active' : ''}" @click=${() => this.configSection = 'agents'}>Agents</div>
          <div class="tab ${this.configSection === 'features' ? 'active' : ''}" @click=${() => this.configSection = 'features'}>Features</div>
        </div>
        <button class="btn btn-primary" @click=${this.saveConfig}>Save Config</button>
      </header>

      ${this.renderConfigSection()}
    `;
  }

  renderConfigSection() {
    switch (this.configSection) {
      case 'general': return this.renderGeneralConfig();
      case 'endpoints': return this.renderEndpointsConfig();
      case 'models': return this.renderModelsConfig();
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
          <label>Repository Path</label>
          <input type="text" .value=${this.config.repoPath} @input=${(e: any) => this.config.repoPath = e.target.value}>
        </div>
      </div>
    `;
  }

  renderEndpointsConfig() {
    return html`
      <div class="card">
        <div class="card-header">
          <h3>Ollama Endpoints</h3>
          <button class="btn btn-ghost" @click=${() => this.addEndpoint()}>+ Add Endpoint</button>
        </div>
        ${repeat(this.config.ollama.endpoints, (ep: any) => ep.key, (ep: any, idx) => html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${ep.key}</span>
              <span class="item-sub">${ep.hostBaseUrl} | Provider: ${ep.providerId}</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" @click=${() => this.editEndpoint(idx)}>Edit</button>
              <button class="btn btn-danger" @click=${() => this.removeEndpoint(idx)}>Remove</button>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  renderModelsConfig() {
    return html`
      <div class="card">
        <div class="card-header">
          <h3>Ollama Managed Models</h3>
          <button class="btn btn-ghost" @click=${() => this.addModel()}>+ Add Model</button>
        </div>
        ${repeat(this.config.ollama.models, (m: any) => m.id, (m: any, idx) => html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${m.name || m.id}</span>
              <span class="item-sub">ID: ${m.id} | Context: ${m.contextWindow || 'default'}</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" @click=${() => this.editModel(idx)}>Edit</button>
              <button class="btn btn-danger" @click=${() => this.removeModel(idx)}>Remove</button>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  renderAgentsConfig() {
    const agents = Object.keys(this.config.multiAgent)
      .filter(k => k.endsWith('Agent'))
      .map(k => ({ key: k, ...this.config.multiAgent[k] }));

    return html`
      <div class="card">
        <div class="card-header"><h3>Active Agents</h3></div>
        <div class="form-group">
          <label>Enable Multi-Agent</label>
          <select @change=${(e: any) => this.config.multiAgent.enabled = e.target.value === 'true'}>
            <option value="true" ?selected=${this.config.multiAgent.enabled}>Yes</option>
            <option value="false" ?selected=${!this.config.multiAgent.enabled}>No</option>
          </select>
        </div>
        ${agents.map(agent => html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${agent.name} (${agent.id})</span>
              <span class="item-sub">Model: ${agent.modelRef} | Source: ${agent.modelSource}</span>
            </div>
            <button class="btn btn-secondary" @click=${() => this.editAgent(agent.key)}>Configure</button>
          </div>
        `)}
      </div>
    `;
  }

  renderFeaturesConfig() {
    return html`
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h3>Voice Notes</h3></div>
          <div class="form-group">
            <label>Enabled</label>
            <select @change=${(e: any) => this.config.voiceNotes.enabled = e.target.value === 'true'}>
              <option value="true" ?selected=${this.config.voiceNotes.enabled}>Yes</option>
              <option value="false" ?selected=${!this.config.voiceNotes.enabled}>No</option>
            </select>
          </div>
          <div class="form-group">
            <label>Whisper Model</label>
            <input type="text" .value=${this.config.voiceNotes.whisperModel} @input=${(e: any) => this.config.voiceNotes.whisperModel = e.target.value}>
          </div>
        </div>
        
        <div class="card">
          <div class="card-header"><h3>Telegram</h3></div>
          <div class="form-group">
            <label>Enabled</label>
            <select @change=${(e: any) => this.config.telegram.enabled = e.target.value === 'true'}>
              <option value="true" ?selected=${this.config.telegram.enabled}>Yes</option>
              <option value="false" ?selected=${!this.config.telegram.enabled}>No</option>
            </select>
          </div>
          <div class="form-group">
            <label>Allow From (ID)</label>
            <input type="text" .value=${this.config.telegram.allowFrom.join(',')} @input=${(e: any) => this.config.telegram.allowFrom = e.target.value.split(',')}>
          </div>
        </div>
      </div>
    `;
  }

  // Helper actions
  addEndpoint() {
    const key = prompt('Endpoint Key (e.g. cloud-pc):');
    if (!key) return;
    this.config.ollama.endpoints.push({
      key,
      providerId: 'ollama',
      baseUrl: 'http://localhost:11434',
      hostBaseUrl: 'http://localhost:11434',
      apiKey: 'ollama-local',
      autoPullMissingModels: true
    });
    this.requestUpdate();
  }

  removeEndpoint(idx: number) {
    if (confirm('Are you sure?')) {
      this.config.ollama.endpoints.splice(idx, 1);
      this.requestUpdate();
    }
  }

  editEndpoint(idx: number) {
    const ep = this.config.ollama.endpoints[idx];
    const url = prompt('Base URL:', ep.baseUrl);
    if (url) ep.baseUrl = ep.hostBaseUrl = url;
    this.requestUpdate();
  }

  addModel() {
    const id = prompt('Model ID (e.g. deepseek-v3:latest):');
    if (!id) return;
    this.config.ollama.models.push({
      id,
      name: id,
      input: ['text'],
      minimumContextWindow: 2048
    });
    this.requestUpdate();
  }

  removeModel(idx: number) {
    if (confirm('Are you sure?')) {
      this.config.ollama.models.splice(idx, 1);
      this.requestUpdate();
    }
  }

  editModel(idx: number) {
    const m = this.config.ollama.models[idx];
    const ctx = prompt('Context Window:', m.contextWindow || 32768);
    if (ctx) m.contextWindow = parseInt(ctx);
    this.requestUpdate();
  }

  editAgent(key: string) {
    const agent = this.config.multiAgent[key];
    const ref = prompt('Model Reference (e.g. ollama/model-id):', agent.modelRef);
    if (ref) agent.modelRef = ref;
    this.requestUpdate();
  }
}
