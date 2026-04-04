import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

@customElement('toolkit-dashboard')
export class ToolkitDashboard extends LitElement {
  @state() private config: any = null;
  @state() private savedConfig: any = null;
  @state() private statusOutput: string = '';
  @state() private logs: string[] = [];
  @state() private isRunning: boolean = false;
  @state() private activeTab: string = 'status';
  @state() private configSection: string = 'general';
  @state() private editingAgentKey: string | null = null;
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
    .unsaved-banner {
      background: #ff9800;
      color: #000;
      padding: 10px 20px;
      border-radius: 4px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: bold;
    }
    .toggle-switch {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
    }
    .toggle-switch input { width: auto; }
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
      this.savedConfig = JSON.parse(JSON.stringify(this.config));
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

  get hasUnsavedChanges() {
    if (!this.config || !this.savedConfig) return false;
    return JSON.stringify(this.config) !== JSON.stringify(this.savedConfig);
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
      if (res.ok) {
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
          <div class="nav-item ${this.activeTab === 'config' ? 'active' : ''}" @click=${() => this.activeTab = 'config'}>Configuration</div>
          <div class="nav-item ${this.activeTab === 'ops' ? 'active' : ''}" @click=${() => this.activeTab = 'ops'}>Operations</div>
          <div class="nav-item ${this.activeTab === 'logs' ? 'active' : ''}" @click=${() => this.activeTab = 'logs'}>
            Terminal Logs ${this.isRunning ? html`<span style="color: #00bcd4;">●</span>` : ''}
          </div>
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
      { id: 'stop', name: 'Stop', desc: 'Stop all services' }
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
              <span class="item-sub">${ep.hostBaseUrl}</span>
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
          <h3>Managed Models</h3>
          <button class="btn btn-ghost" @click=${() => this.addModel()}>+ Add Model</button>
        </div>
        ${repeat(this.config.ollama.models, (m: any) => m.id, (m: any, idx) => html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${m.name || m.id}</span>
              <span class="item-sub">${m.id} | ${m.contextWindow || 'auto'} ctx</span>
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
    if (this.editingAgentKey) {
        return this.renderAgentEditor(this.editingAgentKey);
    }

    const builtInAgents = Object.keys(this.config.multiAgent)
      .filter(k => k.endsWith('Agent'))
      .map(k => ({ key: k, ...this.config.multiAgent[k] }));

    return html`
      <div class="card">
        <div class="card-header">
            <h3>Agents Configuration</h3>
            <button class="btn btn-ghost" @click=${() => this.addExtraAgent()}>+ Add Custom Agent</button>
        </div>
        
        <div class="form-group" style="margin-bottom: 25px;">
            <label class="toggle-switch">
                <input type="checkbox" ?checked=${this.config.multiAgent.enabled} @change=${(e: any) => this.config.multiAgent.enabled = e.target.checked}>
                Enable Multi-Agent Orchestration
            </label>
        </div>

        <h4 style="color: #666; margin-bottom: 10px;">Built-in Roles</h4>
        ${builtInAgents.map(agent => html`
          <div class="item-row" style="${!agent.enabled && agent.key !== 'strongAgent' ? 'opacity: 0.5;' : ''}">
            <div class="item-info">
              <span class="item-title">
                ${agent.name} 
                ${agent.key === 'strongAgent' ? html`<span class="badge" style="background: #ffc107;">Main</span>` : ''}
                ${!agent.enabled && agent.key !== 'strongAgent' ? html`<span style="color: #f44336; font-size: 0.7rem;">(Disabled)</span>` : ''}
              </span>
              <span class="item-sub">ID: ${agent.id} | Model: ${agent.modelRef}</span>
            </div>
            <button class="btn btn-secondary" @click=${() => this.editingAgentKey = agent.key}>Configure</button>
          </div>
        `)}

        ${this.config.multiAgent.extraAgents && this.config.multiAgent.extraAgents.length > 0 ? html`
            <h4 style="color: #666; margin-top: 25px; margin-bottom: 10px;">Custom Agents</h4>
            ${this.config.multiAgent.extraAgents.map((agent: any, idx: number) => html`
                <div class="item-row">
                    <div class="item-info">
                        <span class="item-title">${agent.name}</span>
                        <span class="item-sub">ID: ${agent.id} | Model: ${agent.modelRef}</span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary" @click=${() => this.editingAgentKey = `extra:${idx}`}>Configure</button>
                        <button class="btn btn-danger" @click=${() => this.removeExtraAgent(idx)}>Remove</button>
                    </div>
                </div>
            `)}
        ` : ''}
      </div>
    `;
  }

  renderAgentEditor(key: string) {
    let agent: any;
    let isExtra = false;
    let extraIdx = -1;

    if (key.startsWith('extra:')) {
        isExtra = true;
        extraIdx = parseInt(key.split(':')[1]);
        agent = this.config.multiAgent.extraAgents[extraIdx];
    } else {
        agent = this.config.multiAgent[key];
    }

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
                    <input type="text" .value=${agent.id} ?disabled=${!isExtra} @input=${(e: any) => { agent.id = e.target.value; this.requestUpdate(); }}>
                </div>
            </div>

            <div class="grid-2">
                <div class="form-group">
                    <label>Model Source</label>
                    <select @change=${(e: any) => { agent.modelSource = e.target.value; this.requestUpdate(); }}>
                        <option value="local" ?selected=${agent.modelSource === 'local'}>Local (Ollama)</option>
                        <option value="hosted" ?selected=${agent.modelSource === 'hosted'}>Hosted (Gemini/OpenAI/Anthropic)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Model Reference</label>
                    <input type="text" .value=${agent.modelRef} @input=${(e: any) => { agent.modelRef = e.target.value; this.requestUpdate(); }}>
                </div>
            </div>

            ${agent.modelSource === 'local' ? html`
                <div class="form-group">
                    <label>Endpoint Key</label>
                    <input type="text" .value=${agent.endpointKey} @input=${(e: any) => { agent.endpointKey = e.target.value; this.requestUpdate(); }}>
                </div>
            ` : ''}

            <div class="form-group">
                <label>Role Policy Key</label>
                <input type="text" .value=${agent.rolePolicyKey} @input=${(e: any) => { agent.rolePolicyKey = e.target.value; this.requestUpdate(); }}>
            </div>

            ${key !== 'strongAgent' ? html`
                <div class="form-group">
                    <label class="toggle-switch">
                        <input type="checkbox" ?checked=${agent.enabled} @change=${(e: any) => { agent.enabled = e.target.checked; this.requestUpdate(); }}>
                        Enable this Agent
                    </label>
                </div>
            ` : ''}

            <div class="form-group">
                <label>Candidate Models (One per line)</label>
                <textarea rows="4" @input=${(e: any) => { agent.candidateModelRefs = e.target.value.split('\n').filter((l: string) => l.trim()); this.requestUpdate(); }}>${(agent.candidateModelRefs || []).join('\n')}</textarea>
            </div>
        </div>
    `;
  }

  renderFeaturesConfig() {
    return html`
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h3>Voice</h3></div>
          <div class="form-group">
            <label class="toggle-switch">
                <input type="checkbox" ?checked=${this.config.voiceNotes.enabled} @change=${(e: any) => { this.config.voiceNotes.enabled = e.target.checked; this.requestUpdate(); }}>
                Enable Voice Transcription
            </label>
          </div>
          <div class="form-group">
            <label>Whisper Model</label>
            <input type="text" .value=${this.config.voiceNotes.whisperModel} @input=${(e: any) => this.config.voiceNotes.whisperModel = e.target.value}>
          </div>
        </div>
        
        <div class="card">
          <div class="card-header"><h3>Telegram</h3></div>
          <div class="form-group">
             <label class="toggle-switch">
                <input type="checkbox" ?checked=${this.config.telegram.enabled} @change=${(e: any) => { this.config.telegram.enabled = e.target.checked; this.requestUpdate(); }}>
                Enable Telegram Bot
            </label>
          </div>
          <div class="form-group">
            <label>Allowed User IDs (comma separated)</label>
            <input type="text" .value=${(this.config.telegram.allowFrom || []).join(',')} @input=${(e: any) => this.config.telegram.allowFrom = e.target.value.split(',').map((s: string) => s.trim())}>
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
          name: 'New Custom Agent',
          rolePolicyKey: 'codingDelegate',
          modelSource: 'local',
          modelRef: 'ollama/qwen2.5-coder:3b'
      };
      this.config.multiAgent.extraAgents.push(newAgent);
      this.editingAgentKey = `extra:${this.config.multiAgent.extraAgents.length - 1}`;
  }

  removeExtraAgent(idx: number) {
      if (confirm('Remove this custom agent?')) {
          this.config.multiAgent.extraAgents.splice(idx, 1);
          this.requestUpdate();
      }
  }

  addEndpoint() {
    const key = prompt('Endpoint Key:');
    if (key) {
        this.config.ollama.endpoints.push({ key, providerId: 'ollama', hostBaseUrl: 'http://127.0.0.1:11434', baseUrl: 'http://host.docker.internal:11434' });
        this.requestUpdate();
    }
  }

  removeEndpoint(idx: number) {
    if (confirm('Remove endpoint?')) {
        this.config.ollama.endpoints.splice(idx, 1);
        this.requestUpdate();
    }
  }

  editEndpoint(idx: number) {
      const ep = this.config.ollama.endpoints[idx];
      const url = prompt('Host Base URL:', ep.hostBaseUrl);
      if (url) ep.hostBaseUrl = url;
      this.requestUpdate();
  }

  addModel() {
      const id = prompt('Model ID:');
      if (id) {
          this.config.ollama.models.push({ id, name: id, input: ['text'], minimumContextWindow: 24576 });
          this.requestUpdate();
      }
  }

  removeModel(idx: number) {
      if (confirm('Remove model?')) {
          this.config.ollama.models.splice(idx, 1);
          this.requestUpdate();
      }
  }

  editModel(idx: number) {
      const m = this.config.ollama.models[idx];
      const name = prompt('Name:', m.name);
      if (name) m.name = name;
      this.requestUpdate();
  }
}
