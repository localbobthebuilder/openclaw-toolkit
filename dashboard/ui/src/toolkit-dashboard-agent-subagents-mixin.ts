import { LitElement, html } from 'lit';
import { renderCardSection, renderHelpText, renderTagList, renderToggleSwitch } from './toolkit-dashboard-ui-helpers';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentSubagentsMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentSubagentsMixin extends Base {
    [key: string]: any;

    renderAgentSubagentsConfig(subagents: any, selectedAllowedAgents: string[], allowedAgentChoices: Array<{ id: string; label: string }>) {
      return renderCardSection('Subagents', html`
        <div class="form-group">
          ${renderToggleSwitch('Enable spawning subagents from this agent', !!subagents.enabled, (checked) => {
            subagents.enabled = checked;
            this.requestUpdate();
          })}
        </div>
        <div class="form-group">
          ${renderToggleSwitch('Require explicit agent ID when spawning subagents', !!subagents.requireAgentId, (checked) => {
            subagents.requireAgentId = checked;
            this.requestUpdate();
          })}
        </div>
        <div class="form-group">
          <label>Allowed Agent IDs</label>
          ${renderTagList(selectedAllowedAgents, (agentId: string, idx: number) => html`
            <div class="tag">
              ${agentId}
              <span class="tag-remove" @click=${() => {
                selectedAllowedAgents.splice(idx, 1);
                this.requestUpdate();
              }}>×</span>
            </div>
          `)}
          <div style="margin-top: 10px;">
            <select @change=${(e: any) => {
              const value = e.target.value;
              if (value && !selectedAllowedAgents.includes(value)) {
                selectedAllowedAgents.push(value);
                this.requestUpdate();
              }
              e.target.value = '';
            }}>
              <option value="">${allowedAgentChoices.length === 0 ? 'No other configured agents available' : '+ Add Allowed Agent'}</option>
              ${allowedAgentChoices
                .filter((choice: any) => !selectedAllowedAgents.includes(choice.id))
                .map((choice: any) => html`<option value=${choice.id}>${choice.label}</option>`)}
            </select>
          </div>
          ${renderHelpText('Leave the list empty to keep the toolkit defaults.', 'margin-top: 6px;')}
        </div>
      `, undefined, '', 'margin-top: 20px; margin-bottom: 20px;');
    }
  };
