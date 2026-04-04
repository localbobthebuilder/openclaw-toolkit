import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

@customElement('toolkit-dashboard')
export class ToolkitDashboard extends LitElement {
  @state() private config: any = null;
  @state() private statusOutput: string = '';
  @state() private logs: string[] = [];
  @state() private isRunning: boolean = false;
  @state() private activeTab: string = 'status';
  private ws: WebSocket | null = null;

  static styles = css`
    :host {
      display: block;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #e0e0e0;
      background-color: #121212;
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      border-bottom: 1px solid #333;
      padding-bottom: 10px;
    }
    h1 { margin: 0; color: #00bcd4; font-size: 1.5rem; }
    .tabs { display: flex; gap: 10px; margin-bottom: 20px; }
    .tab {
      padding: 10px 20px;
      cursor: pointer;
      border: 1px solid #333;
      background: #1e1e1e;
      border-radius: 4px;
    }
    .tab.active {
      background: #00bcd4;
      color: #000;
      border-color: #00bcd4;
    }
    .content {
      background: #1e1e1e;
      padding: 20px;
      border-radius: 8px;
      border: 1px solid #333;
    }
    pre {
      background: #000;
      padding: 15px;
      border-radius: 4px;
      overflow-x: auto;
      white-space: pre-wrap;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 0.9rem;
      border: 1px solid #333;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-weight: bold;
      margin-right: 10px;
    }
    .btn-primary { background: #00bcd4; color: #000; }
    .btn-secondary { background: #333; color: #fff; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .config-section { margin-bottom: 20px; }
    .config-section h3 { border-bottom: 1px solid #444; padding-bottom: 5px; margin-top: 0; }
    label { display: block; margin-bottom: 5px; font-size: 0.85rem; color: #aaa; }
    input, select, textarea {
      width: 100%;
      background: #2a2a2a;
      border: 1px solid #444;
      color: #fff;
      padding: 8px;
      border-radius: 4px;
      box-sizing: border-box;
    }
    .log-container {
      height: 400px;
      overflow-y: auto;
      background: #000;
      padding: 10px;
      border-radius: 4px;
      display: flex;
      flex-direction: column;
    }
    .log-line { margin: 2px 0; font-family: monospace; font-size: 0.85rem; }
  `;

  async firstUpdated() {
    this.fetchConfig();
    this.fetchStatus();
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
        // Auto scroll to bottom
        setTimeout(() => {
          const container = this.shadowRoot?.querySelector('.log-container');
          if (container) container.scrollTop = container.scrollHeight;
        }, 0);
      } else if (msg.type === 'exit') {
        this.isRunning = false;
        this.logs = [...this.logs, `--- Process exited with code ${msg.code} ---`];
        this.fetchStatus();
      }
    };
    this.ws.onclose = () => {
      console.log('WS closed, reconnecting in 2s...');
      setTimeout(() => this.connectWS(), 2000);
    };
  }

  runCommand(command: string, args: string[] = []) {
    if (!this.ws || this.isRunning) return;
    this.isRunning = true;
    this.logs = [`Starting: ${command} ${args.join(' ')}...`];
    this.activeTab = 'logs';
    this.ws.send(JSON.stringify({ type: 'run-command', command, args }));
  }

  async saveConfig() {
    try {
      await fetch('http://127.0.0.1:18791/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.config)
      });
      alert('Config saved!');
    } catch (err) {
      alert('Failed to save config');
    }
  }

  render() {
    return html`
      <div class="container">
        <header>
          <h1>OpenClaw Toolkit Dashboard</h1>
          <button class="btn btn-secondary" @click=${this.fetchStatus}>Refresh Status</button>
        </header>

        <div class="tabs">
          <div class="tab ${this.activeTab === 'status' ? 'active' : ''}" @click=${() => this.activeTab = 'status'}>Status</div>
          <div class="tab ${this.activeTab === 'config' ? 'active' : ''}" @click=${() => this.activeTab = 'config'}>Configuration</div>
          <div class="tab ${this.activeTab === 'ops' ? 'active' : ''}" @click=${() => this.activeTab = 'ops'}>Operations</div>
          <div class="tab ${this.activeTab === 'logs' ? 'active' : ''}" @click=${() => this.activeTab = 'logs'}>Logs</div>
        </div>

        <div class="content">
          ${this.renderActiveTab()}
        </div>
      </div>
    `;
  }

  renderActiveTab() {
    switch (this.activeTab) {
      case 'status': return html`<h3>System Status</h3><pre>${this.statusOutput || 'Loading status...'}</pre>`;
      case 'config': return this.renderConfig();
      case 'ops': return html`
          <h3>Common Operations</h3>
          <p>Click a button to run the corresponding toolkit script. Logs will stream in the Logs tab.</p>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand('bootstrap')}>Bootstrap Setup</button>
            <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand('update')}>Update Repo</button>
            <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand('backup')}>Create Backup</button>
            <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand('verify')}>Run Verification</button>
            <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand('start')}>Start Services</button>
            <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand('stop')}>Stop Services</button>
          </div>
        `;
      case 'logs': return html`
          <h3>Live Terminal Output</h3>
          <div class="log-container">
            ${this.logs.map(log => html`<div class="log-line">${log}</div>`)}
            ${this.isRunning ? html`<div class="log-line" style="color: #00bcd4;">Running...</div>` : ''}
          </div>
        `;
      default: return html`No tab selected`;
    }
  }

  renderConfig() {
    if (!this.config) return html`Loading configuration...`;
    return html`
      <div class="config-grid">
        <div class="config-section">
          <h3>Gateway</h3>
          <label>Gateway Port</label>
          <input type="number" .value=${this.config.gatewayPort} @input=${(e: any) => this.config.gatewayPort = parseInt(e.target.value)}>
          
          <label>Gateway Bind</label>
          <select @change=${(e: any) => this.config.gatewayBind = e.target.value}>
            <option value="lan" ?selected=${this.config.gatewayBind === 'lan'}>LAN</option>
            <option value="localhost" ?selected=${this.config.gatewayBind === 'localhost'}>Localhost</option>
          </select>
        </div>
        
        <div class="config-section">
          <h3>Voice</h3>
          <label>Enabled</label>
          <select @change=${(e: any) => this.config.voiceNotes.enabled = e.target.value === 'true'}>
            <option value="true" ?selected=${this.config.voiceNotes.enabled}>Yes</option>
            <option value="false" ?selected=${!this.config.voiceNotes.enabled}>No</option>
          </select>
          <label>Whisper Model</label>
          <input type="text" .value=${this.config.voiceNotes.whisperModel} @input=${(e: any) => this.config.voiceNotes.whisperModel = e.target.value}>
        </div>
      </div>

      <div class="config-section">
        <h3>Agents</h3>
        <label>Multi-Agent Enabled</label>
        <select @change=${(e: any) => this.config.multiAgent.enabled = e.target.value === 'true'}>
          <option value="true" ?selected=${this.config.multiAgent.enabled}>Yes</option>
          <option value="false" ?selected=${!this.config.multiAgent.enabled}>No</option>
        </select>
      </div>

      <button class="btn btn-primary" @click=${this.saveConfig}>Save Changes</button>
      <p style="font-size: 0.8rem; color: #888; margin-top: 10px;">Note: Saving configuration writes to openclaw-bootstrap.config.json. Run "Bootstrap" to apply changes.</p>
    `;
  }
}
