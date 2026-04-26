import { LitElement, html } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardShellViewMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardShellViewMixin extends Base {
    [key: string]: any;

    renderLogs() {
      return html`
        <header>
          <h2>Process Output</h2>
          ${this.isRunning ? html`
            <button class="btn btn-danger" @click=${() => this.cancelCommand()}>⏹ Cancel</button>
          ` : ''}
        </header>
        <div class="log-container">
          ${this.logs.map((line: string) => html`<div class="log-entry">${line}</div>`)}
        </div>
      `;
    }


    renderOps() {
      const ops = [
        { id: 'prereqs', name: 'Check Prerequisites', desc: 'Audit Windows, Docker, and WSL setup' },
        { id: 'bootstrap', name: 'Bootstrap', desc: 'Full installation/hardening' },
        { id: 'update', name: 'Update', desc: 'Update OpenClaw repo and rebuild' },
        { id: 'verify', name: 'Verify', desc: 'Run smoke tests and health checks' },
        { id: 'agent-smoke', name: 'Agent Smoke Test', desc: 'Run the managed agent behavior smoke for shared-workspace file/git, research, review, and coder flows' },
        { id: 'start', name: 'Start', desc: 'Start all services and OpenClaw' },
        { id: 'onboard', name: 'Interactive Onboarding', desc: 'Launch openclaw onboard in a separate PowerShell window so you can answer prompts and make onboarding choices' },
        { id: 'telegram-setup', name: 'Telegram Setup', desc: 'Launch the interactive Telegram channel setup wizard in a separate PowerShell window without storing any token in toolkit config' },
        { id: 'telegram-ids', name: 'Telegram Seen IDs', desc: 'Scan recent Telegram gateway logs for user and group IDs when you need values for allowlists or group routing' },
        { id: 'cleanup-containers', name: 'Preview Container Cleanup', desc: 'List stale OpenClaw Docker containers, such as exited sandbox workers, without removing anything' },
        { id: 'cleanup-containers', args: ['-Remove'], name: 'Cleanup Container Leftovers', desc: 'Remove stopped OpenClaw Docker leftovers. Running gateway containers are skipped.', confirmText: 'Remove stopped OpenClaw Docker leftovers?\n\nThis targets exited OpenClaw sandbox workers and stopped containers from the OpenClaw Docker Compose project. Running gateway containers are skipped.' },
        { id: 'reset-config', name: 'Reset Configuration', desc: 'Restore the managed bootstrap config to the toolkit starter defaults. The current config is backed up first as openclaw-bootstrap.config.json.bak.', confirmText: 'Reset the managed bootstrap config to the toolkit starter defaults?\n\nThis overwrites openclaw-bootstrap.config.json and saves the previous file as openclaw-bootstrap.config.json.bak.' },
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
              <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runOperation(op)}>Run Action</button>
            </div>
          `)}
        </div>
      `;
    }


    renderConfig() {
      if (!this.config) return html`<p>Loading config...</p>`;

      return html`
        <div class="config-page" style=${`--config-toolbar-sticky-offset: ${this.configToolbarStickyOffset || 0}px;`}>
          <header class="config-toolbar">
            <div class="config-toolbar-tabs">
              <button type="button" class="config-toolbar-tab ${this.configSection === 'general' ? 'active' : ''}" @click=${() => this.configSection = 'general'}>General</button>
              <button type="button" class="config-toolbar-tab ${this.configSection === 'sandbox' ? 'active' : ''}" @click=${() => this.configSection = 'sandbox'}>Sandbox</button>
              <button type="button" class="config-toolbar-tab ${this.configSection === 'endpoints' ? 'active' : ''}" @click=${() => this.configSection = 'endpoints'}>Endpoints</button>
              <button type="button" class="config-toolbar-tab ${this.configSection === 'models' ? 'active' : ''}" @click=${() => this.configSection = 'models'}>Models Catalog</button>
              <button type="button" class="config-toolbar-tab ${this.configSection === 'markdownTemplates' ? 'active' : ''}" @click=${() => this.configSection = 'markdownTemplates'}>Template Markdowns</button>
              <button type="button" class="config-toolbar-tab ${this.configSection === 'toolsets' ? 'active' : ''}" @click=${() => this.configSection = 'toolsets'}>Toolsets</button>
              <button type="button" class="config-toolbar-tab ${this.configSection === 'agents' ? 'active' : ''}" @click=${() => this.configSection = 'agents'}>Agents</button>
              <button type="button" class="config-toolbar-tab ${this.configSection === 'workspaces' ? 'active' : ''}" @click=${() => this.configSection = 'workspaces'}>Workspaces</button>
              <button type="button" class="config-toolbar-tab ${this.configSection === 'features' ? 'active' : ''}" @click=${() => this.configSection = 'features'}>Features</button>
            </div>
            <div class="config-toolbar-actions">
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
        </div>
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
  };
