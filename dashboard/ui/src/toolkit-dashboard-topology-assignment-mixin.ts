import { LitElement } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTopologyAssignmentMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTopologyAssignmentMixin extends Base {
    [key: string]: any;

    getAgentDelegationTargets(agent: any) {
      const subagents = this.ensureSubagentsConfig(agent);
      return subagents.allowAgents;
    }

    selectTopologyAgent(agentId: string) {
      this.topologySelectedAgentId = agentId;
    }

    setTopologyAgentEnabled(agentId: string, enabled: boolean) {
      const entry = this.getTopologyAgentEntryById(agentId);
      if (!entry) {
        return;
      }
      entry.agent.enabled = enabled;
      if (!enabled && this.topologyLinkSourceAgentId === agentId) {
        this.topologyLinkSourceAgentId = null;
      }
      this.topologySelectedAgentId = agentId;
      this.setTopologyNotice(enabled
        ? `${entry.name} is enabled again and will be included in toolkit-managed OpenClaw config.`
        : `${entry.name} is now disabled and will stay in toolkit config only until re-enabled.`);
      this.requestUpdate();
    }

    setTopologyAgentDelegationEnabled(agentId: string, enabled: boolean) {
      const entry = this.getTopologyAgentEntryById(agentId);
      if (!entry) {
        return;
      }
      const subagents = this.ensureSubagentsConfig(entry.agent);
      subagents.enabled = enabled;
      if (!enabled && this.topologyLinkSourceAgentId === agentId) {
        this.topologyLinkSourceAgentId = null;
      }
      this.topologySelectedAgentId = agentId;
      this.setTopologyNotice(enabled
        ? `${entry.name} can delegate again using its configured allowed agents.`
        : `${entry.name} delegation is now turned off. Existing delegate targets were kept.`);
      this.requestUpdate();
    }

    selectTopologyDelegationSource(agentId: string) {
      if (this.topologyLinkSourceAgentId === agentId) {
        this.topologyLinkSourceAgentId = null;
        this.clearTopologyNotice();
        return;
      }
      this.topologyLinkSourceAgentId = agentId;
      const sourceEntry = this.getTopologyAgentEntryById(agentId);
      if (sourceEntry) {
        this.setTopologyNotice(`Wiring delegation from ${sourceEntry.name}. Click another agent to add or remove a delegation arrow.`);
      }
    }

    toggleTopologyDelegation(sourceAgentId: string, targetAgentId: string) {
      if (sourceAgentId === targetAgentId) {
        this.setTopologyNotice('An agent cannot delegate to itself.');
        return;
      }

      const sourceEntry = this.getTopologyAgentEntryById(sourceAgentId);
      const targetEntry = this.getTopologyAgentEntryById(targetAgentId);
      if (!sourceEntry || !targetEntry) {
        this.setTopologyNotice('Could not find one of the selected agents.');
        return;
      }

      const subagents = this.ensureSubagentsConfig(sourceEntry.agent);
      const allowedAgents = this.getAgentDelegationTargets(sourceEntry.agent);
      const existingIndex = allowedAgents.indexOf(targetAgentId);
      if (existingIndex >= 0) {
        allowedAgents.splice(existingIndex, 1);
        this.setTopologyNotice(`${sourceEntry.name} no longer delegates to ${targetEntry.name}.`);
        this.requestUpdate();
        return;
      }

      if (this.wouldCreateDelegationCycle(sourceAgentId, targetAgentId)) {
        this.setTopologyNotice(`Blocked circular delegation: ${targetEntry.name} already leads back to ${sourceEntry.name}.`);
        return;
      }

      subagents.enabled = true;
      allowedAgents.push(targetAgentId);
      this.setTopologyNotice(`${sourceEntry.name} can now delegate to ${targetEntry.name}.`);
      this.requestUpdate();
    }

    handleTopologyAgentClick(agentId: string) {
      this.topologySelectedAgentId = agentId;
      if (!this.topologyLinkSourceAgentId) {
        return;
      }
      if (this.topologyLinkSourceAgentId === agentId) {
        this.topologyLinkSourceAgentId = null;
        this.clearTopologyNotice();
        return;
      }
      this.toggleTopologyDelegation(this.topologyLinkSourceAgentId, agentId);
    }

    setAgentEndpointAssignment(agent: any, endpointKey: string | null) {
      const agentId = String(agent?.id || '').trim();
      if (agentId) {
        for (const endpoint of this.getConfigEndpoints()) {
          endpoint.agents = this.getEndpointAgentIds(endpoint).filter((candidateId: string) => candidateId !== agentId);
        }
        if (endpointKey && endpointKey.length > 0) {
          const targetEndpoint = this.getConfigEndpoints().find((candidate: any) => candidate.key === endpointKey);
          if (targetEndpoint) {
            targetEndpoint.agents = [...this.getEndpointAgentIds(targetEndpoint), agentId];
          }
        }
      }
      const endpoint = endpointKey ? this.getConfigEndpoints().find((candidate: any) => candidate.key === endpointKey) : null;
      this.syncAgentEndpointModelSelection(agent, endpoint);
    }

    assignTopologyAgentToEndpoint(agentKey: string, endpointKey: string | null) {
      const entry = this.getTopologyAgentEntryByKey(agentKey);
      if (!entry) return;
      this.setAgentEndpointAssignment(entry.agent, endpointKey);
      this.clearTopologyNotice();
      this.requestUpdate();
    }

    startTopologyDrag(agentKey: string) {
      this.topologyDraggedAgentKey = agentKey;
      this.clearTopologyNotice();
    }

    endTopologyDrag() {
      this.topologyDraggedAgentKey = null;
      this.topologyHoverEndpointKey = null;
    }

    handleTopologyDrop(endpointKey: string | null) {
      if (!this.topologyDraggedAgentKey) return;
      this.assignTopologyAgentToEndpoint(this.topologyDraggedAgentKey, endpointKey);
      this.topologyDraggedAgentKey = null;
      this.topologyHoverEndpointKey = null;
    }

    openTopologyAgentEditor(agentKey: string) {
      const entry = this.getTopologyAgentEntryByKey(agentKey);
      if (entry) {
        this.topologySelectedAgentId = entry.id;
      }
      this.startEditingAgent(agentKey);
      this.activeTab = 'config';
      this.configSection = 'agents';
    }

    getTopologySlots() {
      const slots = this.getSortedConfigEndpoints().map((endpoint: any) => ({
        key: endpoint.key,
        endpointKey: endpoint.key,
        title: this.getEndpointLabel(endpoint),
        subtitle: endpoint.default ? 'Default workbench' : 'Endpoint workbench',
        icon: endpoint.default ? '💻' : '🖥️',
        endpoint,
        agents: [] as any[]
      }));

      const roamingSlot = {
        key: '__roaming__',
        endpointKey: null,
        title: 'Roaming Bench',
        subtitle: 'Agents without a resolved endpoint',
        icon: '🧰',
        endpoint: null,
        agents: [] as any[]
      };

      for (const entry of this.getTopologyAgentEntries()) {
        const slot = entry.endpoint
          ? slots.find((candidate: any) => candidate.endpointKey === entry.endpoint.key)
          : roamingSlot;
        (slot || roamingSlot).agents.push(entry);
      }

      return [...slots, roamingSlot];
    }

    syncAgentModelSource(agent: any) {
      const primaryRef = typeof agent?.modelRef === 'string' && agent.modelRef.length > 0
        ? agent.modelRef
        : (Array.isArray(agent?.candidateModelRefs) && agent.candidateModelRefs.length > 0 ? agent.candidateModelRefs[0] : '');

      agent.modelSource = this.isLocalModelRef(primaryRef) ? 'local' : 'hosted';
    }

    syncAgentEndpointModelSelection(agent: any, endpoint: any) {
      if (!agent) {
        return;
      }

      if (!endpoint) {
        this.syncAgentModelSource(agent);
        return;
      }

      const allowedRefs = new Set(this.getEndpointModelOptions(endpoint).map((option: any) => option.ref));
      if (allowedRefs.size === 0) {
        this.syncAgentModelSource(agent);
        return;
      }

      const currentCandidates = Array.isArray(agent?.candidateModelRefs) ? agent.candidateModelRefs : [];
      if (!allowedRefs.has(agent?.modelRef)) {
        const firstCompatibleCandidate = currentCandidates.find((ref: string) => allowedRefs.has(ref));
        if (firstCompatibleCandidate) {
          agent.modelRef = firstCompatibleCandidate;
        }
      }

      this.syncAgentModelSource(agent);
    }

    syncAllAgentModelSources() {
      for (const { agent } of this.getManagedAgentEntries()) {
        this.syncAgentModelSource(agent);
      }
    }

    syncAllAgentSelections() {
      for (const { agent } of this.getManagedAgentEntries()) {
        const endpoint = this.resolveAgentEndpoint(agent);
        this.syncAgentEndpointModelSelection(agent, endpoint);
      }
    }
  };
