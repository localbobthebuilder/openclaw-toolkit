import { LitElement } from 'lit';
import {
  VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES,
  VALID_WORKSPACE_MARKDOWN_FILES
} from './toolkit-dashboard-constants';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTopologyAgentsMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTopologyAgentsMixin extends Base {
    [key: string]: any;

    getManagedAgentEntries() {
      const agents = Array.isArray(this.config?.agents?.list) ? this.config.agents.list : [];
      const entries = agents
        .map((agent: any, idx: number) => ({ key: typeof agent?.key === 'string' && agent.key.trim().length > 0 ? agent.key : `agent:${idx}`, agent }))
        .filter((entry: any) => entry.agent?.id);
      entries.sort((left: any, right: any) => {
        const leftMain = this.isMainAgentEntry(left.key, left.agent) ? 0 : 1;
        const rightMain = this.isMainAgentEntry(right.key, right.agent) ? 0 : 1;
        if (leftMain !== rightMain) {
          return leftMain - rightMain;
        }
        return String(left.agent?.name || left.agent?.id || left.key).localeCompare(String(right.agent?.name || right.agent?.id || right.key));
      });
      return entries;
    }

    getAgentDisplayLabel(agent: any) {
      const agentId = typeof agent?.id === 'string' ? agent.id.trim() : '';
      const agentName = typeof agent?.name === 'string' ? agent.name.trim() : '';
      return agentName && agentName !== agentId ? `${agentName} (${agentId})` : (agentId || 'main');
    }

    getDefaultRoutingAgentEntry() {
      const agents = Array.isArray(this.config?.agents?.list) ? this.config.agents.list : [];
      const entries = agents
        .map((agent: any, idx: number) => ({ key: typeof agent?.key === 'string' && agent.key.trim().length > 0 ? agent.key : `agent:${idx}`, agent }))
        .filter((entry: any) => entry.agent?.id);

      return entries.find((entry: any) => entry.agent?.default === true)
        || entries[0]
        || { key: 'main', agent: { id: 'main', name: 'main' } };
    }

    getTelegramSetupStatusRecord(accountId: string, isDefault: boolean) {
      const status = this.telegramSetupStatus && typeof this.telegramSetupStatus === 'object'
        ? this.telegramSetupStatus
        : { defaultAccount: null, accounts: {} };
      if (isDefault) {
        return status.defaultAccount || null;
      }

      const accounts = status.accounts && typeof status.accounts === 'object' ? status.accounts : {};
      return accountId ? (accounts[accountId] || null) : null;
    }

    isMainAgentEntry(key: string, agent: any) {
      return key === 'strongAgent' || agent?.isMain === true;
    }

    canRemoveAgent(key: string, agent: any) {
      return !this.isMainAgentEntry(key, agent);
    }

    removeAgentReferences(agentId: string) {
      for (const { agent } of this.getManagedAgentEntries()) {
        const subagents = this.ensureSubagentsConfig(agent);
        subagents.allowAgents = subagents.allowAgents.filter((candidateId: string) => candidateId !== agentId);
      }

      for (const workspace of this.getWorkspaces()) {
        workspace.agents = this.getWorkspaceAgentIds(workspace).filter((candidateId: string) => candidateId !== agentId);
      }

      for (const endpoint of this.getConfigEndpoints()) {
        endpoint.agents = this.getEndpointAgentIds(endpoint).filter((candidateId: string) => candidateId !== agentId);
      }

      const telegramRouting = this.ensureTelegramRoutingConfig();
      if (telegramRouting) {
        telegramRouting.routes = this.getTelegramRouteList().filter((route: any) => String(route?.targetAgentId || '') !== agentId);
      }

      if (this.topologyLinkSourceAgentId === agentId) {
        this.topologyLinkSourceAgentId = null;
      }
      if (this.topologyHoverAgentId === agentId) {
        this.topologyHoverAgentId = null;
      }
      if (this.topologyHoverEdgeKey && this.topologyHoverEdgeKey.startsWith(`${agentId}->`)) {
        this.topologyHoverEdgeKey = null;
      }
      if (this.topologySelectedAgentId === agentId) {
        this.topologySelectedAgentId = null;
      }
    }

    getAllowedAgentChoices(currentAgentId?: string) {
      return this.getManagedAgentEntries()
        .filter(({ agent }: any) => agent.id !== currentAgentId)
        .map(({ agent }: any) => ({
          id: agent.id,
          label: agent.name ? `${agent.name} (${agent.id})` : agent.id
        }));
    }

    getAgentEnabledState(_key: string, agent: any) {
      return !!agent?.enabled;
    }

    getAgentEffectiveWorkspaceMode(agent: any) {
      return this.getWorkspaceForAgentId(agent?.id)?.mode || 'private';
    }

    getTopologyAgentEntries() {
      return this.getManagedAgentEntries().map(({ key, agent }: any) => ({
        key,
        agent,
        id: String(agent?.id || key),
        name: String(agent?.name || agent?.id || key),
        enabled: this.getAgentEnabledState(key, agent),
        isMain: this.isMainAgentEntry(key, agent),
        endpoint: this.resolveAgentEndpoint(agent),
        workspaceMode: this.getAgentEffectiveWorkspaceMode(agent),
        modelSource: agent?.modelSource || (this.isLocalModelRef(agent?.modelRef) ? 'local' : 'hosted')
      }));
    }

    getTopologyAgentEntryById(agentId: string | null | undefined) {
      if (!agentId) return null;
      return this.getTopologyAgentEntries().find((entry: any) => entry.id === agentId) || null;
    }

    getTopologyAgentEntryByKey(agentKey: string | null | undefined) {
      if (!agentKey) return null;
      return this.getTopologyAgentEntries().find((entry: any) => entry.key === agentKey) || null;
    }

    getTopologySelectedAgentEntry() {
      return this.getTopologyAgentEntryById(this.topologySelectedAgentId)
        || this.getTopologyAgentEntries()[0]
        || null;
    }

    getEffectiveAgentBootstrapMarkdown(agent: any, fileName: string) {
      const selectedTemplateKey = this.getMarkdownTemplateSelection(agent, fileName, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
      const agentTemplateFiles = this.ensureAgentTemplateFiles(agent);
      return {
        selectedTemplateKey,
        effectiveValue: selectedTemplateKey
          ? this.getMarkdownTemplateContent('agents', fileName, selectedTemplateKey)
          : (agentTemplateFiles[fileName] || '')
      };
    }

    getEffectiveWorkspaceBootstrapMarkdown(workspace: any, fileName: string) {
      if (!workspace || !VALID_WORKSPACE_MARKDOWN_FILES.includes(fileName as any)) {
        return {
          selectedTemplateKey: '',
          effectiveValue: ''
        };
      }

      const selectedTemplateKey = this.getMarkdownTemplateSelection(workspace, fileName, VALID_WORKSPACE_MARKDOWN_FILES);
      const workspaceTemplateFiles = this.ensureWorkspaceTemplateFiles(workspace);
      let effectiveValue = selectedTemplateKey
        ? this.getMarkdownTemplateContent('workspaces', fileName, selectedTemplateKey)
        : (workspaceTemplateFiles[fileName] || '');

      if (!effectiveValue && fileName === 'AGENTS.md') {
        effectiveValue = this.buildWorkspaceBootstrapPlaceholder(workspace, fileName);
      }

      return {
        selectedTemplateKey,
        effectiveValue
      };
    }

    getCombinedAgentBootstrapMarkdown(agent: any, fileName: string) {
      const workspace = this.getWorkspaceForAgentId(agent?.id);
      const workspaceMarkdown = this.getEffectiveWorkspaceBootstrapMarkdown(workspace, fileName);
      const agentMarkdown = this.getEffectiveAgentBootstrapMarkdown(agent, fileName);
      const sections: string[] = [];
      const sourceLabels: string[] = [];

      const workspaceValue = typeof workspaceMarkdown.effectiveValue === 'string'
        ? workspaceMarkdown.effectiveValue.trim()
        : '';
      if (workspaceValue) {
        const workspaceLabel = workspace?.name || workspace?.id || 'workspace';
        sections.push(`## Workspace ${fileName} (${workspaceLabel})`, '', workspaceValue);
        sourceLabels.push(
          workspaceMarkdown.selectedTemplateKey
            ? `Workspace template ${workspaceMarkdown.selectedTemplateKey}`
            : 'Workspace markdown'
        );
      }

      const agentValue = typeof agentMarkdown.effectiveValue === 'string'
        ? agentMarkdown.effectiveValue.trim()
        : '';
      if (agentValue) {
        const agentLabel = agent?.name || agent?.id || 'agent';
        sections.push(`## Agent ${fileName} (${agentLabel})`, '', agentValue);
        sourceLabels.push(
          agentMarkdown.selectedTemplateKey
            ? `Agent template ${agentMarkdown.selectedTemplateKey}`
            : 'Agent overlay markdown'
        );
      }

      return {
        sourceLabels,
        effectiveValue: sections.join('\n').trim()
      };
    }
  };
