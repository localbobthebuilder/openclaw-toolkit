import { LitElement, html } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentSubagentsMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentSubagentsMixin extends Base {
    [key: string]: any;

    renderAgentSubagentsConfig(subagents: any, selectedAllowedAgents: string[], allowedAgentChoices: Array<{ id: string; label: string }>) {
      return html`
        <div class="card" style="margin-top: 20px; margin-bottom: 20px;">
          <div class="card-header"><h3>Subagents</h3></div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${!!subagents.enabled} @change=${(e: any) => {
                subagents.enabled = e.target.checked;
                this.requestUpdate();
              }}>
              Enable spawning subagents from this agent
            </label>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${!!subagents.requireAgentId} @change=${(e: any) => { subagents.requireAgentId = e.target.checked; this.requestUpdate(); }}>
              Require explicit agent ID when spawning subagents
            </label>
          </div>
          <div class="form-group">
            <label>Allowed Agent IDs</label>
            <div class="tag-list">
              ${selectedAllowedAgents.map((agentId: string, idx: number) => html`
                <div class="tag">
                  ${agentId}
                  <span class="tag-remove" @click=${() => {
                    selectedAllowedAgents.splice(idx, 1);
                    this.requestUpdate();
                  }}>×</span>
                </div>
              `)}
            </div>
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
            <p style="color: #888; font-size: 0.75rem; margin-top: 6px;">Leave the list empty to keep the toolkit defaults.</p>
          </div>
        </div>
      `;
    }
  };
