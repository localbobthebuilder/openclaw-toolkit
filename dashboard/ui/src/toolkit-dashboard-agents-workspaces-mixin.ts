import { LitElement, html } from 'lit';
import { ToolkitDashboardAgentPlacementMixin } from './toolkit-dashboard-agent-placement-mixin';
import { ToolkitDashboardAgentBootstrapMixin } from './toolkit-dashboard-agent-bootstrap-mixin';
import { ToolkitDashboardAgentSubagentsMixin } from './toolkit-dashboard-agent-subagents-mixin';
import { ToolkitDashboardAgentToolsMixin } from './toolkit-dashboard-agent-tools-mixin';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentsWorkspacesMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentsWorkspacesMixin extends ToolkitDashboardAgentToolsMixin(ToolkitDashboardAgentSubagentsMixin(ToolkitDashboardAgentPlacementMixin(ToolkitDashboardAgentBootstrapMixin(Base)))) {
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

    const subagents = this.ensureSubagentsConfig(agent);
    const agentTemplateFiles = this.ensureEditingAgentTemplateFiles();
    const agentIdValidationError = this.getEditingAgentValidationError();
    const allowedAgentChoices = this.getAllowedAgentChoices(agent.id);
    const selectedAllowedAgents = Array.isArray(subagents.allowAgents) ? subagents.allowAgents : (subagents.allowAgents = []);
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

            ${this.renderAgentPlacementConfig(agent)}

            ${this.renderAgentSubagentsConfig(subagents, selectedAllowedAgents, allowedAgentChoices)}

            ${this.renderAgentToolsConfig(agent)}

            ${this.renderAgentBootstrapConfig(agent, agentTemplateFiles)}
        </div>
    `;
    }


  };
