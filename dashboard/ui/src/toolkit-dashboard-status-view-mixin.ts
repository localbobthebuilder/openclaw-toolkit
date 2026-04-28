import { LitElement, html } from 'lit';
import { renderHelpText } from './toolkit-dashboard-ui-helpers';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardStatusViewMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardStatusViewMixin extends Base {
    [key: string]: any;

    getStatusSection(title: string) {
      const sections = this.parseStatusOutput(this.statusOutput);
      return sections.find((section: any) => section.title === title) || null;
    }

    canStartFromGuidedSetup() {
      const managedImagesSection = this.getStatusSection('Managed Images');
      if (!managedImagesSection) {
        return false;
      }
      return managedImagesSection.status === 'online' && /ready/i.test(String(managedImagesSection.content || ''));
    }

    canVerifyFromGuidedSetup() {
      const gatewaySection = this.getStatusSection('Gateway');
      const containersSection = this.getStatusSection('Containers');
      if (!gatewaySection || !containersSection) {
        return false;
      }
      return gatewaySection.status === 'online' && containersSection.status === 'online';
    }

    shouldShowInitialSetupGuide() {
      if (!this.statusLoaded) {
        return false;
      }

      const sections = this.parseStatusOutput(this.statusOutput);
      if (sections.length === 0) {
        return false;
      }

      const managedImagesSection = sections.find((section: any) => section.title === 'Managed Images');
      const containersSection = sections.find((section: any) => section.title === 'Containers');
      const composeSection = sections.find((section: any) => section.title === 'Compose');
      const gatewaySection = sections.find((section: any) => section.title === 'Gateway');
      const imagesMatch = managedImagesSection?.content?.match(/(\d+)\s*\/\s*(\d+)\s*present/i);
      const presentImages = imagesMatch ? Number(imagesMatch[1]) : null;
      const expectedImages = imagesMatch ? Number(imagesMatch[2]) : null;
      const noManagedImages = presentImages === 0 && expectedImages !== null && expectedImages > 0;
      const noContainers = !!containersSection && (
        containersSection.status !== 'online' ||
        /bootstrap not run yet|not ready|not installed/i.test(String(containersSection.content || ''))
      );
      const noCompose = !!composeSection && (
        composeSection.status !== 'online' ||
        /bootstrap not run yet|not ready|not installed/i.test(String(composeSection.content || ''))
      );
      const gatewayUnavailable = !gatewaySection || gatewaySection.status !== 'online';
      return !!noManagedImages && (!!noContainers || !!noCompose || !!gatewayUnavailable);
    }

    renderInitialSetupGuide() {
      const canStart = this.canStartFromGuidedSetup() && !this.isRunning;
      const canVerify = this.canVerifyFromGuidedSetup() && !this.isRunning;
      return html`
        <div class="setup-guide">
          <h2>Guided Setup</h2>
          <p class="subtitle">This looks like a fresh or not-yet-built toolkit state. Build the managed images first, then start services and verify.</p>
          <div class="setup-steps">
            <div class="setup-step active">
              <div class="step-num">1</div>
              <div class="step-body">
                <div class="step-title">Run bootstrap</div>
                <div class="step-desc">Bootstrap clones or updates OpenClaw, builds the managed images, writes config, and prepares the gateway.</div>
              </div>
              <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runCommand('bootstrap')}>Bootstrap</button>
            </div>
            <div class="setup-step">
              <div class="step-num">2</div>
              <div class="step-body">
                <div class="step-title">Start services</div>
                <div class="step-desc">${canStart ? 'Once images exist, start Docker services and the OpenClaw gateway.' : 'Bootstrap must finish building the managed images before services can be started.'}</div>
              </div>
              <button class="btn btn-primary" ?disabled=${!canStart} @click=${() => this.runCommand('start')}>Start</button>
            </div>
            <div class="setup-step">
              <div class="step-num">3</div>
              <div class="step-body">
                <div class="step-title">Verify health</div>
                <div class="step-desc">${canVerify ? 'Run the managed verification and smoke tests after startup is healthy.' : 'Verification unlocks after the gateway and containers are up and reporting live status.'}</div>
              </div>
              <button class="btn btn-primary" ?disabled=${!canVerify} @click=${() => this.runCommand('verify')}>Verify</button>
            </div>
          </div>
        </div>
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
      const renderServicesSection = () => {
        const rawStatusOutput = this.statusOutput && this.statusOutput.trim().length > 0 ? this.statusOutput.trim() : '';
        const statusOutputLooksBroken = this.statusLoaded && sections.length === 0 && !!rawStatusOutput;

        if (sections.length === 0 && !statusOutputLooksBroken) {
      return html`
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
      `;
        }

        if (statusOutputLooksBroken) {
          return html`
        <div class="card status-services-section">
          <div class="card-header">
            <h3>Services</h3>
            <span class="badge badge-warning">probe error</span>
          </div>
          ${renderHelpText('The status probe returned text that the dashboard could not summarize into service cards. The raw output is shown below so you can see what failed.', 'margin-top: 0; margin-bottom: 16px;')}
          <div class="status-grid" style="grid-template-columns: 1fr;">
            <div class="status-card">
              <div class="status-card-header">
                <h4>
                  <span class="status-indicator status-offline"></span>
                  Status probe output
                </h4>
                <span class="badge badge-warning">raw</span>
              </div>
              <div class="status-content" style="white-space: pre-wrap;">${rawStatusOutput}</div>
            </div>
          </div>
        </div>
      `;
        }

        return html`
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
      };

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

        ${this.shouldShowInitialSetupGuide() ? this.renderInitialSetupGuide() : ''}
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
  };
