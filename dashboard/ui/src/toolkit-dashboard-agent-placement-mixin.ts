import { LitElement, html } from 'lit';
import { THINKING_LEVEL_OPTIONS } from './toolkit-dashboard-constants';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentPlacementMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentPlacementMixin extends Base {
    [key: string]: any;

    renderAgentPlacementConfig(agent: any) {
      const endpoints = this.getSortedConfigEndpoints();
      const editorWorkspaceAgentId = this.normalizeAgentId(this.editingAgentInitialDraft?.id || agent.id);
      const primaryWorkspace = this.editingAgentWorkspaceId ? this.getWorkspaceById(this.editingAgentWorkspaceId) : null;
      const workspaceOptions = this.getWorkspaceAssignmentOptions(editorWorkspaceAgentId);
      const accessibleSharedWorkspaces = primaryWorkspace?.mode === 'private'
        ? this.getWorkspaceSharedAccessIds(primaryWorkspace).map((workspaceId: string) => this.getWorkspaceById(workspaceId)).filter(Boolean)
        : [];
      const selectedEndpoint = this.resolveAgentEndpoint(agent);
      const effectiveEndpointKey = selectedEndpoint?.key || '';
      const endpointModelOptions = selectedEndpoint ? this.getEndpointModelOptions(selectedEndpoint) : [];
      const forceSandboxOff = (typeof agent.sandboxMode === 'string' ? agent.sandboxMode : '') === 'off';
      const sandboxModeOverride = typeof agent.sandboxMode === 'string' ? agent.sandboxMode : '';
      const thinkingDefault = this.normalizeThinkingDefault(agent.thinkingDefault);
      const toolChoiceDefault = this.getConfiguredToolChoice(agent);

      return html`
        <div class="form-group">
          <label>Endpoint</label>
          <select @change=${(e: any) => {
            const endpointKey = e.target.value || null;
            this.setAgentEndpointAssignment(agent, endpointKey);
            this.requestUpdate();
          }}>
            <option value="">Select Endpoint</option>
            ${endpoints.map((ep: any) => html`<option value=${ep.key} ?selected=${effectiveEndpointKey === ep.key}>${ep.key}</option>`)}
          </select>
        </div>

        <div class="grid-2">
          <div class="card" style="margin-bottom: 0;">
            <div class="card-header"><h3>Home Workspace</h3></div>
            <div class="help-text" style="margin-top: 0;">This is the agent's home base. OpenClaw uses the configured workspace path directly, so it does not need to match the agent ID.</div>
            <select
              .value=${primaryWorkspace?.id || ''}
              style="margin-top: 10px;"
              @change=${(e: any) => this.setEditingAgentWorkspaceSelection(e.target.value || null)}>
              <option value="">No workspace assigned</option>
              ${workspaceOptions.map((option: any) => html`
                <option
                  value=${option.id}
                  ?selected=${primaryWorkspace?.id === option.id}
                  ?disabled=${option.disabled}>
                  ${option.disabled
                    ? `${option.label} - occupied by ${option.occupiedByLabel}`
                    : option.label}
                </option>
              `)}
            </select>
            <div class="help-text" style="margin-top: 10px;">This selection is saved with the rest of the agent editor changes when you save configuration.</div>
            ${primaryWorkspace ? html`
              <div class="help-text" style="margin-top: 10px;">${this.getWorkspaceHomeBaseDescription(primaryWorkspace)} at <code>${primaryWorkspace.path || '(unset path)'}</code>.</div>
            ` : ''}
            ${primaryWorkspace?.mode === 'private' && accessibleSharedWorkspaces.length > 0 ? html`
              <div class="help-text" style="margin-top: 10px;">Shared collaboration access: ${accessibleSharedWorkspaces.map((workspace: any) => workspace.name || workspace.id).join(', ')}. Because this reaches beyond the private home base, the toolkit keeps sandbox off for this agent.</div>
            ` : ''}
            ${primaryWorkspace?.mode === 'private' && accessibleSharedWorkspaces.length === 0 ? html`
              <div class="help-text" style="margin-top: 10px;">This private workspace currently has no shared collaboration workspaces attached, so the toolkit keeps the agent sandboxed to the home base.</div>
            ` : ''}
            ${primaryWorkspace?.mode === 'shared' ? html`
              <div class="help-text" style="margin-top: 10px;">Shared workspaces are collaboration areas rather than private boundaries, so the toolkit keeps sandbox off for agents living here.</div>
            ` : ''}
            <div style="margin-top: 12px;">
              <button class="btn btn-ghost" @click=${() => { this.editingWorkspaceId = primaryWorkspace?.id || null; this.configSection = 'workspaces'; }}>Open Workspaces Tab</button>
            </div>
          </div>
          <div class="card" style="margin-bottom: 0;">
            <div class="card-header"><h3>Sandbox Mode</h3></div>
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${forceSandboxOff} @change=${(e: any) => {
                if (e.target.checked) {
                  agent.sandboxMode = 'off';
                } else {
                  delete agent.sandboxMode;
                }
                this.requestUpdate();
              }}>
              Force sandbox off for this agent
            </label>
            <div class="help-text">Turn this off to use the global sandbox default instead of an explicit agent override.</div>
            ${sandboxModeOverride && sandboxModeOverride !== 'off'
              ? html`<div class="help-text" style="color: #ff9800;">This agent currently has custom sandbox mode "${sandboxModeOverride}". Using the toggle will replace that custom mode with the toolkit's off/default behavior.</div>`
              : ''}
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label>Primary Model</label>
            <select ?disabled=${!selectedEndpoint || endpointModelOptions.length === 0} @change=${(e: any) => {
              agent.modelRef = e.target.value;
              this.syncAgentModelSource(agent);
              this.requestUpdate();
            }}>
              <option value="">${selectedEndpoint ? 'Select Endpoint Model' : 'Choose an endpoint first'}</option>
              ${endpointModelOptions.map((option: any) => html`
                <option value=${option.ref} ?selected=${agent.modelRef === option.ref}>${option.kind === 'local' ? '[Local]' : '[Hosted]'} ${option.label}</option>
              `)}
            </select>
            ${selectedEndpoint && endpointModelOptions.length === 0 ? html`<p style="color: #f44336; font-size: 0.7rem; margin-top: 4px;">This endpoint has no models configured yet. Add local or hosted models on the Endpoints tab first.</p>` : ''}
            ${selectedEndpoint && endpointModelOptions.length > 0 ? html`<p style="color: #888; font-size: 0.75rem; margin-top: 4px;">Primary and candidate models are limited to the currently selected endpoint.</p>` : ''}
          </div>
          <div class="form-group">
            <label>Default Thinking</label>
            <select @change=${(e: any) => {
              agent.thinkingDefault = this.normalizeThinkingDefault(e.target.value);
              this.requestUpdate();
            }}>
              ${THINKING_LEVEL_OPTIONS.map((level) => html`
                <option value=${level} ?selected=${thinkingDefault === level}>${level}</option>
              `)}
            </select>
            <div class="help-text">Managed toolkit agents default to <code>high</code> instead of OpenClaw's normal <code>low</code>. Use <code>adaptive</code> for providers that support provider-managed thinking.</div>
          </div>
        </div>

        <div class="form-group">
          <label>Tool Use</label>
          <select .value=${toolChoiceDefault} @change=${(e: any) => this.setConfiguredToolChoice(agent, e.target.value)}>
            <option value="">Default</option>
            <option value="auto">Auto</option>
            <option value="required">Required</option>
            <option value="none">None</option>
          </select>
          <div class="help-text">This writes to the agent's OpenClaw <code>params.toolChoice</code>. Use <code>required</code> only for tool-first specialists because it can be too strict for agents that also need to answer normally.</div>
        </div>
      `;
    }
  };
