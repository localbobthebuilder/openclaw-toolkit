import { LitElement, html } from 'lit';
import {
  AVAILABLE_TOOL_OPTIONS,
  THINKING_LEVEL_OPTIONS
} from './toolkit-dashboard-constants';
import { ToolkitDashboardAgentBootstrapMixin } from './toolkit-dashboard-agent-bootstrap-mixin';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentsWorkspacesMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentsWorkspacesMixin extends ToolkitDashboardAgentBootstrapMixin(Base) {
    [key: string]: any;

    renderAgentsConfig() {
    if (this.editingAgentKey) {
        return this.renderAgentEditor(this.editingAgentKey);
    }

    const agents = this.getManagedAgentEntries().map(({ key, agent }: any) => ({
      key,
      ...agent,
      enabled: this.getAgentEnabledState(key, agent),
      appliedToolsets: this.getAgentAppliedToolsets(agent).map((toolset: any) => toolset.name || toolset.key)
    }));

    return html`
      <div class="card">
        <div class="card-header">
            <h3>Agents Configuration</h3>
            <button class="btn btn-ghost" @click=${() => this.addAgent()}>+ Add Agent</button>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Agents are first-class toolkit records. Endpoints own machine placement, and workspaces own the agent home base: the primary workspace the agent lives in by default. Private workspaces are the privacy boundary; shared workspaces are the collaboration area.</p>

        <h4 style="color: #666; margin-bottom: 10px;">All Agents</h4>
        ${agents.map((agent: any) => html`
          <div class="item-row" style="${!agent.enabled ? 'opacity: 0.5;' : ''}">
            <div class="item-info">
              <span class="item-title">
                ${agent.name} 
                ${this.isMainAgentEntry(agent.key, agent) ? html`<span class="badge" style="background: #ffc107;">Main</span>` : ''}
                ${!agent.enabled ? html`<span style="color: #f44336; font-size: 0.7rem;">(Disabled)</span>` : ''}
              </span>
              <span class="item-sub">ID: ${agent.id} | Home Base: ${this.getWorkspaceDisplayLabel(this.getWorkspaceForAgentId(agent.id))} | Sandbox: ${this.getAgentEffectiveSandboxMode(agent)} | Model: ${agent.modelRef || '(unset)'} | Toolsets: ${agent.appliedToolsets.join(' -> ') || 'Minimal'}</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" @click=${() => this.startEditingAgent(agent.key)}>Configure</button>
              ${this.canRemoveAgent(agent.key, agent) ? html`
                <button class="btn btn-danger" @click=${() => this.removeAgentByKey(agent.key)}>Remove</button>
              ` : ''}
            </div>
          </div>
        `)}
      </div>
    `;
    }

    getEditingAgent() {
      return this.editingAgentDraft;
    }

    setEditingAgentWorkspaceSelection(workspaceId: string | null) {
    this.editingAgentWorkspaceId = workspaceId;
    this.requestUpdate();
    }


    renderAgentEditor(key: string) {
    const agent = this.getEditingAgent();
    if (!agent) return html`Agent not found`;
    const isMain = this.isMainAgentEntry(key, agent);

    const endpoints = this.getSortedConfigEndpoints();
    const subagents = this.ensureSubagentsConfig(agent);
    const agentTemplateFiles = this.ensureEditingAgentTemplateFiles();
    const agentIdValidationError = this.getEditingAgentValidationError();
    const editorWorkspaceAgentId = this.normalizeAgentId(this.editingAgentInitialDraft?.id || agent.id);
    const primaryWorkspace = this.editingAgentWorkspaceId ? this.getWorkspaceById(this.editingAgentWorkspaceId) : null;
    const workspaceOptions = this.getWorkspaceAssignmentOptions(editorWorkspaceAgentId);
    const accessibleSharedWorkspaces = primaryWorkspace?.mode === 'private'
      ? this.getWorkspaceSharedAccessIds(primaryWorkspace).map((workspaceId: string) => this.getWorkspaceById(workspaceId)).filter(Boolean)
      : [];
    const selectedEndpoint = this.resolveAgentEndpoint(agent);
    const effectiveEndpointKey = selectedEndpoint?.key || '';
    const endpointModelOptions = selectedEndpoint ? this.getEndpointModelOptions(selectedEndpoint) : [];
    const allowedAgentChoices = this.getAllowedAgentChoices(agent.id);
    const selectedAllowedAgents = Array.isArray(subagents.allowAgents) ? subagents.allowAgents : (subagents.allowAgents = []);
    const candidateModelRefs = Array.isArray(agent.candidateModelRefs) ? agent.candidateModelRefs : (agent.candidateModelRefs = []);
    const toolsetKeys = this.ensureAgentToolsetKeys(agent);
    const appliedToolsets = this.getAgentAppliedToolsets(agent);
    const effectiveToolState = this.getEffectiveAgentToolState(agent);
    const directToolOverrides = this.normalizeAgentToolOverrides(agent) || { allow: [], deny: [] };
    const directAllowedTools = this.normalizeToolNameList(directToolOverrides.allow);
    const directDeniedTools = this.normalizeToolNameList(directToolOverrides.deny);
    const availableAgentToolsets = this.getToolsetsList().filter((toolset: any) => toolset.key !== 'minimal' && !toolsetKeys.includes(toolset.key));
    const availableDirectAllowOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !directAllowedTools.includes(option.id));
    const availableDirectDenyOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !directDeniedTools.includes(option.id));
    const sandboxModeOverride = typeof agent.sandboxMode === 'string' ? agent.sandboxMode : '';
    const thinkingDefault = this.normalizeThinkingDefault(agent.thinkingDefault);
    const toolChoiceDefault = this.getConfiguredToolChoice(agent);
    const forceSandboxOff = sandboxModeOverride === 'off';
    const telegramRoutesForAgent = this.getTelegramRoutesForAgent(String(agent.id || ''));

    return html`
        <div class="card">
            <div class="card-header">
                <h3>Edit Agent: ${agent.name}</h3>
                <button class="btn btn-ghost" @click=${() => this.closeEditingAgentEditor()}>Back to List</button>
            </div>

            <div class="card" style="margin-bottom: 20px; border-color: ${agent.enabled ? '#00bcd4' : '#f44336'};">
                <div class="card-header"><h3>Agent Status</h3></div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label class="toggle-switch" style="font-size: 1rem; font-weight: 700; color: #fff;">
                        <input type="checkbox" ?checked=${!!agent.enabled} @change=${(e: any) => { agent.enabled = e.target.checked; this.requestUpdate(); }}>
                        Enable this Agent
                    </label>
                    <div class="help-text">${agent.enabled ? 'This agent is available for toolkit-managed OpenClaw configuration.' : 'Disabled agents stay in toolkit config only and are not propagated into live OpenClaw config.'}</div>
                </div>
            </div>

            ${telegramRoutesForAgent.length > 0 ? html`
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
                <div class="help-text" style="margin-top: 8px;">Change these routes on <strong>Configuration -> Features -> Telegram</strong>.</div>
              </div>
            ` : ''}
            
            <div class="grid-2">
                <div class="form-group">
                    <label>Display Name</label>
                    <input type="text" .value=${agent.name} @input=${(e: any) => { agent.name = e.target.value; this.requestUpdate(); }}>
                </div>
                <div class="form-group">
                    <label>Agent ID</label>
                    <input type="text" .value=${agent.id} ?disabled=${isMain} @input=${(e: any) => {
                        agent.id = e.target.value;
                        this.requestUpdate();
                    }}>
                    ${agentIdValidationError ? html`<div class="help-text" style="color: #f44336;">${agentIdValidationError}</div>` : ''}
                </div>
            </div>

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

            <div class="form-group">
                <label>Candidate Models</label>
                <div class="tag-list">
                    ${(agent.candidateModelRefs || []).map((ref: string, idx: number) => html`
                        <div class="tag">
                            ${ref}
                            <span class="tag-remove" @click=${() => { agent.candidateModelRefs.splice(idx, 1); this.requestUpdate(); }}>×</span>
                        </div>
                    `)}
                </div>
                <div style="margin-top: 10px;">
                    <select ?disabled=${!selectedEndpoint || endpointModelOptions.length === 0} @change=${(e: any) => {
                        const value = e.target.value;
                        if (value) {
                            if (!agent.candidateModelRefs) agent.candidateModelRefs = [];
                            if (!agent.candidateModelRefs.includes(value)) {
                                agent.candidateModelRefs.push(value);
                                this.syncAgentModelSource(agent);
                                this.requestUpdate();
                            }
                            e.target.value = '';
                        }
                    }}>
                        <option value="">${selectedEndpoint ? '+ Add Endpoint Model' : 'Choose an endpoint first'}</option>
                        ${endpointModelOptions
                            .filter((option: any) => !candidateModelRefs.includes(option.ref))
                            .map((option: any) => html`<option value=${option.ref}>${option.kind === 'local' ? '[Local]' : '[Hosted]'} ${option.label}</option>`)}
                    </select>
                </div>
            </div>

            <div class="card" style="margin-top: 20px; margin-bottom: 20px;">
                <div class="card-header"><h3>Toolsets</h3></div>
                <div class="help-text" style="margin-top: 0; margin-bottom: 14px;">The global <code>minimal</code> toolset is always applied first. Toolsets lower in the list win when the same tool is both allowed and denied.</div>

                <div class="form-group">
                    <label>Applied Toolsets</label>
                    <div class="applied-toolset-list">
                        ${appliedToolsets.map((toolset: any) => {
                          const isMinimal = toolset.key === 'minimal';
                          const agentToolsetIndex = isMinimal ? -1 : toolsetKeys.indexOf(toolset.key);
                          const allowedTools = this.normalizeToolNameList(toolset.allow);
                          const deniedTools = this.normalizeToolNameList(toolset.deny);
                          return html`
                            <div class="applied-toolset-card">
                              <div class="applied-toolset-header">
                                <strong>${toolset.name || toolset.key}</strong>
                                ${isMinimal ? html`<span class="badge">Global</span>` : ''}
                                ${!isMinimal ? html`
                                  <button class="btn btn-ghost" style="padding: 2px 6px;" ?disabled=${agentToolsetIndex <= 0} @click=${() => this.moveAgentToolset(agent, agentToolsetIndex, -1)}>Up</button>
                                  <button class="btn btn-ghost" style="padding: 2px 6px;" ?disabled=${agentToolsetIndex < 0 || agentToolsetIndex >= toolsetKeys.length - 1} @click=${() => this.moveAgentToolset(agent, agentToolsetIndex, 1)}>Down</button>
                                  <button class="btn btn-danger" style="padding: 2px 6px;" @click=${() => { agent.toolsetKeys.splice(agentToolsetIndex, 1); this.requestUpdate(); }}>Remove</button>
                                ` : ''}
                              </div>
                              <div class="toolset-preview-rows">
                                <div class="toolset-preview-row">
                                  <div class="toolset-preview-label">Allow</div>
                                  ${allowedTools.length === 0
                                    ? html`<div class="toolset-preview-empty">No allowed tools.</div>`
                                    : html`
                                      <div class="toolset-preview-tags">
                                        ${allowedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                                      </div>
                                    `}
                                </div>
                                <div class="toolset-preview-row">
                                  <div class="toolset-preview-label">Deny</div>
                                  ${deniedTools.length === 0
                                    ? html`<div class="toolset-preview-empty">No denied tools.</div>`
                                    : html`
                                      <div class="toolset-preview-tags">
                                        ${deniedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                                      </div>
                                    `}
                                </div>
                              </div>
                            </div>
                          `;
                        })}
                    </div>
                    <div style="margin-top: 10px;">
                        <select @change=${(e: any) => {
                          const value = e.target.value;
                          if (value) {
                            this.addAgentToolset(agent, value);
                            e.target.value = '';
                          }
                        }}>
                            <option value="">${availableAgentToolsets.length === 0 ? 'No other toolsets available' : '+ Add toolset'}</option>
                            ${availableAgentToolsets.map((toolset: any) => html`
                              <option value=${toolset.key}>${toolset.name || toolset.key} - ${this.getToolsetPreviewText(toolset)}</option>
                            `)}
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label>Direct Tool Overrides</label>
                    <div class="applied-toolset-card">
                      <div class="applied-toolset-header">
                        <strong>Direct Tool Overrides</strong>
                        <span class="badge">Final Layer</span>
                      </div>
                      <div class="toolset-preview-rows">
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Allow</div>
                          ${directAllowedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No direct allow overrides.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${directAllowedTools.map((toolId: string) => html`
                                  <div class="tag">
                                    ${this.renderToolLabel(toolId)}
                                    <span class="tag-remove" @click=${() => this.removeAgentToolOverride(agent, 'allow', toolId)}>×</span>
                                  </div>
                                `)}
                              </div>
                            `}
                          <div style="margin-top: 6px;">
                            <select @change=${(e: any) => {
                              const value = e.target.value;
                              if (value) {
                                this.addAgentToolOverride(agent, 'allow', value);
                                e.target.value = '';
                              }
                            }}>
                              <option value="">+ Add allowed tool override</option>
                              ${availableDirectAllowOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`)}
                            </select>
                          </div>
                        </div>
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Deny</div>
                          ${directDeniedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No direct deny overrides.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${directDeniedTools.map((toolId: string) => html`
                                  <div class="tag">
                                    ${this.renderToolLabel(toolId)}
                                    <span class="tag-remove" @click=${() => this.removeAgentToolOverride(agent, 'deny', toolId)}>×</span>
                                  </div>
                                `)}
                              </div>
                            `}
                          <div style="margin-top: 6px;">
                            <select @change=${(e: any) => {
                              const value = e.target.value;
                              if (value) {
                                this.addAgentToolOverride(agent, 'deny', value);
                                e.target.value = '';
                              }
                            }}>
                              <option value="">+ Add denied tool override</option>
                              ${availableDirectDenyOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`)}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="help-text" style="margin-top: 8px;">These direct per-agent tool picks merge after all applied toolsets, so they are the easiest way to make one-off tweaks.</div>
                </div>

                <div class="form-group">
                    <label>Combined Toolset</label>
                    <div class="applied-toolset-card">
                      <div class="applied-toolset-header">
                        <strong>Combined Toolset</strong>
                        <span class="badge">Final</span>
                      </div>
                      <div class="toolset-preview-rows">
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Allow</div>
                          ${effectiveToolState.allowedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No tools allowed yet.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${effectiveToolState.allowedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                              </div>
                            `}
                        </div>
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Deny</div>
                          ${effectiveToolState.deniedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No explicit denies.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${effectiveToolState.deniedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                              </div>
                            `}
                        </div>
                      </div>
                    </div>
                </div>

                ${effectiveToolState.explicitTools ? html`
                  <div class="help-text" style="margin-top: 0;">This agent also has a raw <code>tools</code> block in config. Those direct OpenClaw overrides still apply after the combined toolkit toolset shown above.</div>
                ` : ''}
            </div>

            ${this.renderAgentBootstrapConfig(agent, agentTemplateFiles)}
        </div>
    `;
    }


  };
