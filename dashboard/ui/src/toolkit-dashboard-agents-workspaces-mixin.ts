import { LitElement, html } from 'lit';
import { ToolkitDashboardAgentConfigViewMixin } from './toolkit-dashboard-agent-config-view-mixin';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentsWorkspacesMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentsWorkspacesMixin extends ToolkitDashboardAgentConfigViewMixin(Base) {
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
            <button class="btn btn-primary" @click=${() => this.addAgent()}>+ Add Agent</button>
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

            ${this.renderAgentTelegramRoutingConfig(telegramRoutesForAgent)}
            
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
