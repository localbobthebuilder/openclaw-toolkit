import { LitElement, html } from 'lit';
import { renderHelpText } from './toolkit-dashboard-ui-helpers';
type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTelegramMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTelegramMixin extends Base {
    [key: string]: any;

  protected render() {
    return html`
      <div class="layout">
        <aside>
          <div class="brand">
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


  renderConfigurationChecklist() {
    const checklist = this.getConfigurationChecklist();
    const renderChecklistItem = (item: any, optional = false) => html`
      <div class="status-checklist-item ${item.state === 'success' || item.complete ? 'done' : 'active'} ${item.state === 'warning' ? 'warning' : item.state === 'error' ? 'error' : optional ? 'optional' : 'required'}">
        <div class="status-checklist-copy">
          <div class="status-checklist-title">
            <span class="status-indicator ${item.state === 'success' || item.complete ? 'status-online' : item.state === 'warning' || optional ? 'status-warning' : 'status-offline'}"></span>
            <span>${item.label}</span>
          </div>
          <div class="status-checklist-note">${item.note}</div>
        </div>
        <span class="badge ${item.state === 'warning' || (!item.complete && optional) ? 'badge-warning' : ''}">
          ${item.state === 'success' || item.complete
            ? 'configured'
            : item.state === 'warning'
              ? 'partial'
              : optional
                ? 'optional'
                : 'needs setup'}
        </span>
      </div>
    `;

    return html`
      <details class="topology-expander status-checklist-panel">
        <summary>
          Configuration checklist
          <span class="badge">${checklist.ready ? 'minimal ready' : `${checklist.missingRequired} required missing`}</span>
        </summary>
        <div class="topology-expander-body">
          <div class="help-text" style="margin-top: 0;">
            Bootstrap and runtime services are summarized above. This checklist tracks the dashboard-managed settings needed for minimal operation.
          </div>

          <div class="status-checklist-group">
            <h4>Required for minimal operation</h4>
            <div class="status-checklist">
              ${checklist.required.map((item: any) => renderChecklistItem(item, false))}
            </div>
          </div>

          <div class="status-checklist-group">
            <h4>Optional integrations</h4>
            <div class="status-checklist">
              ${checklist.optional.map((item: any) => renderChecklistItem(item, true))}
            </div>
          </div>
        </div>
      </details>
    `;
  }


  renderStatus() {
    const telegramLiveCheckState = this.getTelegramLiveCheckState();
    const sections = this.parseStatusOutput(this.statusOutput);
    const telegramStatusClass = telegramLiveCheckState.available ? 'online' : 'not-installed';
    const telegramStatusBadge = telegramLiveCheckState.available
      ? 'ready'
      : telegramLiveCheckState.reason === 'loading'
        ? 'loading'
        : telegramLiveCheckState.reason === 'services-down'
          ? 'blocked'
          : 'unavailable';
    const telegramStatusMessage = telegramLiveCheckState.available
      ? 'The live Telegram channel is ready.'
      : telegramLiveCheckState.reason === 'loading'
        ? 'Waiting for the status probe to complete.'
      : telegramLiveCheckState.reason === 'services-down'
          ? 'Telegram checks are blocked because Docker or the gateway is not fully ready.'
          : 'Telegram checks are not available yet.';
    const renderServicesSection = () => sections.length === 0 ? html`
      <div class="card status-services-section">
        <div class="card-header">
          <h3>Services</h3>
          <span class="badge">${telegramStatusBadge}</span>
        </div>
        ${renderHelpText('The dashboard is still collecting runtime service state from the local toolkit backend.', 'margin-top: 0; margin-bottom: 16px;')}
        <div class="status-grid" style="grid-template-columns: 1fr;">
          <div class="status-card">
            <div class="status-card-header">
              <h4>
                <span class="status-indicator status-online"></span>
                Collecting service status
              </h4>
              <span class="badge">loading</span>
            </div>
            <div class="status-content" style="white-space: normal;">The dashboard is fetching Docker, gateway, and bootstrap state from the local toolkit backend.</div>
          </div>
        </div>
      </div>
    ` : html`
      <div class="card status-services-section">
        <div class="card-header">
          <h3>Services</h3>
          <span class="badge">${telegramStatusBadge}</span>
        </div>
        ${renderHelpText('Live runtime services reported by the local toolkit backend.', 'margin-top: 0; margin-bottom: 16px;')}
        <div class="status-grid">
          <div class="status-card">
            <div class="status-card-header">
              <h4>
                <span class="status-indicator status-${telegramStatusClass}"></span>
                Telegram live checks
              </h4>
              <span class="badge">${telegramStatusBadge}</span>
            </div>
            <div class="status-content" style="white-space: normal;">
              ${telegramStatusMessage}
              <div style="margin-top: 12px;">
                <button class="btn btn-secondary" @click=${() => this.fetchStatus()}>Refresh Status</button>
              </div>
            </div>
          </div>
          ${sections.map((section: any) => html`
            <div class="status-card">
              <div class="status-card-header">
                <h4>
                  <span class="status-indicator status-${section.status}"></span>
                  ${section.title}
                </h4>
                <span class="badge">${section.status}</span>
              </div>
              <div class="status-content">${section.content}</div>
            </div>
          `)}
        </div>
      </div>
    `;

    if (!this.statusLoaded && sections.length === 0) {
      return html`
        <div class="card">
          <div class="card-header">
            <h3>System Status</h3>
            <button class="btn btn-secondary" @click=${() => this.fetchStatus()}>Refresh Status</button>
          </div>
          ${renderHelpText('Loading dashboard health checks...', 'margin-top: 0; margin-bottom: 16px;')}
        </div>

        ${renderServicesSection()}
        ${this.renderConfigurationChecklist()}
      `;
    }

    return html`
      <div class="card">
        <div class="card-header">
          <h3>System Status</h3>
          <button class="btn btn-secondary" @click=${() => this.fetchStatus()}>Refresh Status</button>
        </div>
        ${renderHelpText('Current dashboard health summary and service checks.', 'margin-top: 0;')}
      </div>

      ${renderServicesSection()}
      ${this.renderConfigurationChecklist()}

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
            <span class="help-text">
              Disabled keeps bootstrap on the lighter <code>openclaw:local</code> image. Enabling local Whisper builds <code>${voiceNotes.gatewayImageTag || 'openclaw:local-voice'}</code>, which is much larger because it includes Whisper/Torch.
            </span>
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
              ${whisperModelOptions.map((model: string) => html`<option value=${model}>${model}</option>`)}
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
      const telegramLiveCheckState = this.getTelegramLiveCheckState();
      const canTrustSetupStatus = setupComplete && setupStatus?.credentialSource === 'env';
      const setupState = (!telegramLiveCheckState.available && !canTrustSetupStatus)
        ? telegramLiveCheckState.reason
        : (setupComplete ? 'complete' : 'needed');
      const setupBadgeStyle = setupState === 'complete'
        ? 'background: #4caf50; color: #000;'
        : setupState === 'needed'
          ? 'background: #ff9800; color: #000;'
          : 'background: #607d8b; color: #fff;';
      const setupBadgeLabel = setupState === 'complete'
        ? 'Setup Complete'
        : setupState === 'needed'
          ? 'Setup Needed'
          : setupState === 'loading'
            ? 'Checking Status'
            : 'Status Unavailable';
      const setupButtonLabel = setupState === 'complete'
        ? 'Re-run Setup'
        : setupState === 'needed'
          ? 'Setup Account'
          : setupState === 'services-down'
            ? 'Start Services First'
            : 'Checking Status';
      const setupButtonDisabled = this.isRunning
        || (setupState === 'complete' || setupState === 'needed' ? !accountId : setupState !== 'services-down');
      const setupStatusText = setupState === 'complete'
        ? (setupStatus?.credentialSource === 'env'
          ? 'Live Telegram credentials were detected from TELEGRAM_BOT_TOKEN for this default account.'
          : 'Live Telegram credentials were detected for this account. You do not need to run setup again unless you want to reconnect or replace the bot.')
        : setupState === 'needed'
          ? 'Live Telegram credentials were not detected for this account yet. Save & Apply first, then run Setup Account to connect the real bot.'
          : setupState === 'services-down'
            ? 'Live Telegram credentials could not be checked because Docker or the gateway is not running. Start services first, then refresh or reopen the dashboard to verify the account state.'
            : setupState === 'loading'
              ? 'Waiting for system status so the dashboard can determine whether live Telegram credentials are available.'
              : 'Live Telegram credentials could not be checked yet because the system status is unavailable right now.';
      const setupStatusColor = setupState === 'complete'
        ? '#81c784'
        : setupState === 'needed'
          ? '#ff9800'
          : '#90a4ae';

      return html`
        <div class="card" style="padding: 14px; margin-bottom: 12px; border-color: ${isDefault ? '#5c6bc0' : '#333'};">
          <div class="card-header" style="margin-bottom: 12px;">
            <h3>
              ${options.title}
              ${isDefault ? html`<span class="badge" style="background: #ffc107;">Default</span>` : ''}
              <span class="badge" style=${setupBadgeStyle}>${setupBadgeLabel}</span>
            </h3>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button
                class="btn btn-ghost"
                ?disabled=${setupButtonDisabled}
                @click=${() => {
                  if (setupState === 'services-down') {
                    this.runCommand('start');
                    return;
                  }
                  this.runCommand('telegram-setup', ['-AccountId', accountId]);
                }}>${setupButtonLabel}</button>
              ${typeof options.removableIndex === 'number'
                ? html`<button class="btn btn-danger" @click=${() => this.removeTelegramAccount(options.removableIndex!)}>Remove Account</button>`
                : ''}
            </div>
          </div>
          ${options.subtitle ? html`<div class="help-text" style="margin-top: 0; margin-bottom: 12px;">${options.subtitle}</div>` : ''}
          <div class="help-text" style="margin-top: 0; margin-bottom: 12px; color: ${setupStatusColor};">${setupStatusText}</div>
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
  };
