import { LitElement, html } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentTelegramRoutingMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentTelegramRoutingMixin extends Base {
    [key: string]: any;

    renderAgentTelegramRoutingConfig(telegramRoutesForAgent: any[]) {
      if (!Array.isArray(telegramRoutesForAgent) || telegramRoutesForAgent.length === 0) {
        return html``;
      }

      return html`
        <div class="card" style="margin-bottom: 20px; border-color: #5c6bc0;">
          <div class="card-header">
            <h3>Telegram Routing</h3>
            <span class="badge">Inbound</span>
          </div>
          <div class="help-text" style="margin-top: 0; margin-bottom: 10px;">This agent is currently the managed Telegram target for:</div>
          ${telegramRoutesForAgent.map((route: any) => html`
            <div class="applied-toolset-card" style="margin-bottom: 10px;">
              <div class="applied-toolset-header">
                <strong>${String(route?.accountId || this.getDefaultTelegramAccountId())}</strong>
                <span class="badge">Telegram</span>
              </div>
              <div class="toolset-preview-rows">
                <div class="toolset-preview-row">
                  <div class="toolset-preview-label">Route</div>
                  <div class="toolset-preview-tags">
                    ${String(route?.matchType || '').toLowerCase() === 'trusted-dms' ? html`<div class="tag">Trusted DMs</div>` : ''}
                    ${String(route?.matchType || '').toLowerCase() === 'trusted-groups' ? html`<div class="tag">Trusted Groups</div>` : ''}
                    ${String(route?.matchType || '').toLowerCase() === 'group' ? html`<div class="tag">Group ${route?.peerId || '(missing id)'}</div>` : ''}
                    ${String(route?.matchType || '').toLowerCase() === 'direct' ? html`<div class="tag">DM ${route?.peerId || '(missing id)'}</div>` : ''}
                    ${!route?.matchType ? html`<div class="toolset-preview-empty">No inbound Telegram route details available.</div>` : ''}
                  </div>
                </div>
              </div>
            </div>
          `)}
          <div class="help-text" style="margin-top: 8px;">Change these routes on <strong>Configuration -&gt; Features -&gt; Telegram</strong>.</div>
        </div>
      `;
    }
  };
