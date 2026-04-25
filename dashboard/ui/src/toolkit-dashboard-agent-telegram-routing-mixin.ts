import { LitElement, html } from 'lit';
import { renderCardSection, renderHelpText, renderPreviewCard, renderTagList } from './toolkit-dashboard-ui-helpers';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentTelegramRoutingMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentTelegramRoutingMixin extends Base {
    [key: string]: any;

    renderAgentTelegramRoutingConfig(telegramRoutesForAgent: any[]) {
      if (!Array.isArray(telegramRoutesForAgent) || telegramRoutesForAgent.length === 0) {
        return html``;
      }

      return renderCardSection('Telegram Routing', html`
        ${renderHelpText('This agent is currently the managed Telegram target for:', 'margin-top: 0; margin-bottom: 10px;')}
        ${telegramRoutesForAgent.map((route: any) => renderPreviewCard(
          String(route?.accountId || this.getDefaultTelegramAccountId()),
          [{
            label: 'Route',
            body: renderTagList([
              String(route?.matchType || '').toLowerCase() === 'trusted-dms' ? 'Trusted DMs' : null,
              String(route?.matchType || '').toLowerCase() === 'trusted-groups' ? 'Trusted Groups' : null,
              String(route?.matchType || '').toLowerCase() === 'group' ? `Group ${route?.peerId || '(missing id)'}` : null,
              String(route?.matchType || '').toLowerCase() === 'direct' ? `DM ${route?.peerId || '(missing id)'}` : null
            ].filter((entry): entry is string => !!entry), (item) => html`<div class="tag">${item}</div>`, html`<div class="toolset-preview-empty">No inbound Telegram route details available.</div>`)
          }],
          undefined,
          html`<span class="badge">Telegram</span>`,
          'margin-bottom: 10px;'
        ))}
        ${renderHelpText(html`Change these routes on <strong>Configuration -&gt; Features -&gt; Telegram</strong>.`, 'margin-top: 8px;')}
      `, html`<span class="badge">Inbound</span>`, '', 'margin-bottom: 20px; border-color: #5c6bc0;');
    }
  };
