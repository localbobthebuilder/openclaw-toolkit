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
  @state() private editingEndpointKey: string | null = null;
  @state() private showModelSelector: boolean = false;
  @state() private selectorTarget: string | null = null; // 'tune' or 'candidate'
  private ws: WebSocket | null = null;

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
  `;

  async firstUpdated() {
    window.onerror = (msg) => { this.logs = [...this.logs, `ERR: ${msg}`]; this.requestUpdate(); };
    window.onunhandledrejection = (event) => { this.logs = [...this.logs, `REJ: ${event.reason}`]; this.requestUpdate(); };
    await this.fetchConfig();
    await this.fetchStatus();
    this.connectWS();
  }

  async fetchConfig() {
    try {
      const res = await fetch(this.getBaseUrl() + '/api/config');
      const data = await res.json();
      this.config = data;
      this.savedConfig = JSON.parse(JSON.stringify(data));
    } catch (err) {
      console.error('Failed to fetch config', err);
    }
  }

  async fetchStatus() {
    try {
      const res = await fetch(this.getBaseUrl() + '/api/status');
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
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.port === '18791' ? '127.0.0.1:18791' : window.location.host;
    this.ws = new WebSocket(`${protocol}//${host}`);
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
        this.fetchConfig(); 
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
      const res = await fetch(this.getBaseUrl() + '/api/config', {
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
      ${this.showModelSelector ? this.renderModelSelector() : ''}
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

  parseStatusOutput(output: string) {
      if (!output) return [];
      const sections: { title: string, content: string, status: 'online'|'offline' }[] = [];
      const parts = output.split(/\[(.*?)\]/g);
      
      for (let i = 1; i < parts.length; i += 2) {
          const title = parts[i];
          let content = parts[i+1]?.trim() || '';
          let status: 'online'|'offline' = 'online';
          
          try {
              const json = JSON.parse(content);
              if (json && typeof json === 'object') {
                  if (json.ok === false || json.status === 'error') status = 'offline';
                  content = Object.entries(json)
                      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`)
                      .join('\n');
              }
          } catch (e) {
              if (content.toLowerCase().includes('not ready') || 
                  content.toLowerCase().includes('failed') || 
                  content.toLowerCase().includes('error')) {
                  status = 'offline';
              }
          }
          
          sections.push({ title, content, status });
      }
      return sections;
  }

  renderStatus() {
    const sections = this.parseStatusOutput(this.statusOutput);
    const rebootMap: Record<string, string> = {
        'Docker': 'docker',
        'Gateway': 'gateway',
        'Tailscale Serve': 'tailscale',
        'Ollama': 'ollama'
    };

    return html`
      <header>
        <h2>System Health Dashboard</h2>
        <button class="btn btn-secondary" @click=${this.fetchStatus}>Refresh Monitoring</button>
      </header>
      
      ${sections.length > 0 ? html`
          <div class="status-grid">
              ${sections.map(s => html`
                  <div class="status-card">
                      <div class="status-card-header">
                          <h4>${s.title}</h4>
                          <div style="display: flex; align-items: center; gap: 12px;">
                              ${rebootMap[s.title] ? html`
                                  <button class="btn btn-ghost" style="padding: 4px 8px; font-size: 0.7rem;" 
                                          ?disabled=${this.isRunning}
                                          @click=${() => this.rebootService(rebootMap[s.title])}>
                                      Restart
                                  </button>
                              ` : ''}
                              <span class="status-indicator ${s.status === 'online' ? 'status-online' : 'status-offline'}"></span>
                          </div>
                      </div>
                      <div class="status-content">${s.content}</div>
                  </div>
              `)}
          </div>
      ` : html`
          <div class="card">
            <p style="color: #888; margin-bottom: 15px;">Gathering live data from Docker and local gateway...</p>
            <div class="log-container" style="height: auto; max-height: 400px; background: #0f0f0f;">
                ${this.statusOutput || 'Waiting for status report...'}
            </div>
          </div>
      `}
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
      </div>
    `;
  }

  renderEndpointsConfig() {
    if (this.editingEndpointKey) {
        return this.renderEndpointEditor(this.editingEndpointKey);
    }

    return html`
      <div class="card">
        <div class="card-header">
          <h3>Endpoints (Compute Resources)</h3>
          <button class="btn btn-ghost" @click=${() => this.addEndpoint()}>+ Add Endpoint</button>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Endpoints are machines running Ollama. Each machine has specific hardware-tuned models.</p>
        ${repeat(this.config.ollama.endpoints, (ep: any) => ep.key, (ep: any, idx) => html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${ep.key}</span>
              <span class="item-sub">${ep.hostBaseUrl} | ${ep.modelOverrides?.length || 0} tuned models</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" @click=${() => this.editingEndpointKey = ep.key}>Configure & Tune Models</button>
              <button class="btn btn-danger" @click=${() => this.removeEndpoint(idx)}>Remove</button>
            </div>
          </div>
        `)}
      </div>
    `;
  }

  renderEndpointEditor(key: string) {
      const ep = this.config.ollama.endpoints.find((e: any) => e.key === key);
      if (!ep) return html`Endpoint not found`;

      return html`
        <div class="card">
            <div class="card-header">
                <h3>Endpoint: ${ep.key}</h3>
                <button class="btn btn-ghost" @click=${() => this.editingEndpointKey = null}>Back to Endpoints</button>
            </div>

            <div class="grid-2">
                <div class="form-group">
                    <label>Base URL (Inside Docker)</label>
                    <input type="text" .value=${ep.baseUrl} @input=${(e: any) => { ep.baseUrl = e.target.value; this.requestUpdate(); }}>
                </div>
                <div class="form-group">
                    <label>Host Base URL (Direct Access)</label>
                    <input type="text" .value=${ep.hostBaseUrl} @input=${(e: any) => { ep.hostBaseUrl = e.target.value; this.requestUpdate(); }}>
                </div>
            </div>

            <h4 style="color: #666; margin-top: 20px;">Hardware-Tuned Models (Overrides)</h4>
            <p style="font-size: 0.8rem; color: #888; margin-bottom: 15px;">These models are fine-tuned for this machine's VRAM.</p>
            
            ${(ep.modelOverrides || []).map((mo: any, idx: number) => html`
                <div class="item-row">
                    <div class="item-info">
                        <span class="item-title">${mo.id}</span>
                        <span class="item-sub">Ctx: ${mo.contextWindow} | MaxTokens: ${mo.maxTokens || 8192}</span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary" @click=${() => this.tuneExistingModel(ep.key, mo.id)}>Re-Tune</button>
                        <button class="btn btn-danger" @click=${() => { ep.modelOverrides.splice(idx, 1); this.requestUpdate(); }}>Remove</button>
                    </div>
                </div>
            `)}

            <div style="margin-top: 20px;">
                <button class="btn btn-primary" @click=${() => { this.selectorTarget = 'tune'; this.showModelSelector = true; }}>+ Tune New Model from Catalog</button>
            </div>
        </div>
      `;
  }

  renderModelSelector() {
      const models = this.config.ollama.models;
      return html`
        <div class="modal-overlay">
            <div class="modal">
                <div class="card-header" style="padding: 20px;">
                    <h3>Select Model from Catalog</h3>
                    <button class="btn btn-ghost" @click=${() => this.showModelSelector = false}>Close</button>
                </div>
                <div class="modal-body">
                    ${models.map((m: any) => html`
                        <div class="selectable-item" @click=${() => this.handleModelSelected(m.id)}>
                            <div class="item-title">${m.name || m.id}</div>
                            <div class="item-sub">ID: ${m.id}</div>
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
    return html`
      <div class="card">
        <div class="card-header">
          <h3>Master Model Catalog</h3>
          <button class="btn btn-ghost" @click=${() => this.addModel()}>+ Add to Catalog</button>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">The catalog lists all models known to OpenClaw. Endpoints use these definitions as a base.</p>
        ${repeat(this.config.ollama.models, (m: any) => m.id, (m: any, idx) => html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${m.name || m.id}</span>
              <span class="item-sub">${m.id} | Min Ctx: ${m.minimumContextWindow || 24576}</span>
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
    const isExtra = key.startsWith('extra:');

    const endpoints = (this.config.ollama.endpoints || []).map((e: any) => e.key);
    const roles = Object.keys(this.config.multiAgent.rolePolicies || {});
    
    const selectedEndpoint = this.config.ollama.endpoints.find((e: any) => e.key === agent.endpointKey);
    const availableTunedModels = selectedEndpoint ? (selectedEndpoint.modelOverrides || []).map((mo: any) => mo.id) : [];

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
                        <option value="hosted" ?selected=${agent.modelSource === 'hosted'}>Hosted (Provider API)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Role Policy</label>
                    <select @change=${(e: any) => { agent.rolePolicyKey = e.target.value; this.requestUpdate(); }}>
                        ${roles.map(r => html`<option value=${r} ?selected=${agent.rolePolicyKey === r}>${r}</option>`)}
                    </select>
                </div>
            </div>

            ${agent.modelSource === 'local' ? html`
                <div class="grid-2">
                    <div class="form-group">
                        <label>Endpoint</label>
                        <select @change=${(e: any) => { agent.endpointKey = e.target.value; this.requestUpdate(); }}>
                            <option value="">Select Endpoint</option>
                            ${endpoints.map((ep: string) => html`<option value=${ep} ?selected=${agent.endpointKey === ep}>${ep}</option>`)}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Primary Model</label>
                        <select @change=${(e: any) => { agent.modelRef = 'ollama/' + e.target.value; this.requestUpdate(); }}>
                            <option value="">Select a Tuned Model</option>
                            ${availableTunedModels.map((m: string) => html`
                                <option value=${m} ?selected=${agent.modelRef === 'ollama/' + m}>${m}</option>
                            `)}
                        </select>
                        ${availableTunedModels.length === 0 && agent.endpointKey ? html`<p style="color: #f44336; font-size: 0.7rem; margin-top: 4px;">No hardware-tuned models found for this endpoint. Go to Endpoints to tune one.</p>` : ''}
                    </div>
                </div>
            ` : html`
                <div class="form-group">
                    <label>Model Reference (Hosted)</label>
                    <input type="text" .value=${agent.modelRef} @input=${(e: any) => { agent.modelRef = e.target.value; this.requestUpdate(); }}>
                </div>
            `}

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
                    ${agent.modelSource === 'local' ? html`
                        <select @change=${(e: any) => { 
                            const val = 'ollama/' + e.target.value;
                            if (e.target.value && !agent.candidateModelRefs.includes(val)) {
                                agent.candidateModelRefs.push(val);
                                this.requestUpdate();
                            }
                            e.target.value = '';
                        }}>
                            <option value="">+ Add Tuned Model</option>
                            ${availableTunedModels.map((m: string) => html`<option value=${m}>${m}</option>`)}
                        </select>
                    ` : html`
                        <button class="btn btn-ghost btn-small" @click=${() => {
                            const val = prompt('Enter hosted model ref (e.g. anthropic/claude-3-5-sonnet):');
                            if (val) {
                                if (!agent.candidateModelRefs) agent.candidateModelRefs = [];
                                agent.candidateModelRefs.push(val);
                                this.requestUpdate();
                            }
                        }}>+ Add Hosted Model Ref</button>
                    `}
                </div>
            </div>

            ${key !== 'strongAgent' ? html`
                <div class="form-group">
                    <label class="toggle-switch">
                        <input type="checkbox" ?checked=${agent.enabled} @change=${(e: any) => { agent.enabled = e.target.checked; this.requestUpdate(); }}>
                        Enable this Agent
                    </label>
                </div>
            ` : ''}
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
          modelRef: 'ollama/qwen2.5-coder:3b',
          candidateModelRefs: []
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
        if (!this.config.ollama.endpoints) this.config.ollama.endpoints = [];
        this.config.ollama.endpoints.push({ key, providerId: 'ollama', hostBaseUrl: 'http://127.0.0.1:11434', baseUrl: 'http://host.docker.internal:11434', modelOverrides: [] });
        this.requestUpdate();
    }
  }

  removeEndpoint(idx: number) {
    if (confirm('Remove endpoint?')) {
        this.config.ollama.endpoints.splice(idx, 1);
        this.requestUpdate();
    }
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
