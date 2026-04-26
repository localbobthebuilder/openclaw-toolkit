import { LitElement, html } from 'lit';
import { renderHelpText } from './toolkit-dashboard-ui-helpers';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardStatusViewMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardStatusViewMixin extends Base {
    [key: string]: any;

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
