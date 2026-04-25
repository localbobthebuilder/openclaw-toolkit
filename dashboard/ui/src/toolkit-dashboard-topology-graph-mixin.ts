import { LitElement } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTopologyGraphMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTopologyGraphMixin extends Base {
    [key: string]: any;

    getAgentDelegationTargets(agent: any) {
      const subagents = this.ensureSubagentsConfig(agent);
      return subagents.allowAgents;
    }

    getTopologyPreviewSourceAgentId() {
      return this.topologyLinkSourceAgentId || this.topologyHoverAgentId;
    }

    getVisibleTopologyEdges() {
      if (this.topologyShowAllArrows) {
        return this.topologyEdges;
      }
      const previewSourceAgentId = this.getTopologyPreviewSourceAgentId();
      if (!previewSourceAgentId) {
        return [];
      }
      return this.topologyEdges.filter((edge: any) => edge.sourceId === previewSourceAgentId);
    }

    getTopologyEdgeColor(edge: any) {
      if (this.topologyHoverEdgeKey === edge.key) {
        return '#ff4fc3';
      }
      const isHoveredSource = this.topologyHoverAgentId === edge.sourceId;
      if (edge.active) {
        return '#00bcd4';
      }
      if (isHoveredSource) {
        return '#ff8a65';
      }
      if (edge.main) {
        return '#ffd54f';
      }
      return '#6ec6ff';
    }

    getTopologyProtectedLaneMetrics() {
      return {
        laneSpacing: 12,
        leftPadding: 18,
        rightPadding: 12,
        centerGap: 24
      };
    }

    getTopologySlotLaneCounts(slot: any, columnCount: number) {
      if (columnCount < 2) {
        return { leftLaneCount: 0, rightLaneCount: 0 };
      }

      const slotEntries = Array.isArray(slot?.agents) ? slot.agents : [];
      const columnByAgentId = new Map<string, number>();
      slotEntries.forEach((entry: any, index: number) => {
        columnByAgentId.set(String(entry?.id || ''), index % columnCount);
      });

      let leftLaneCount = 0;
      let rightLaneCount = 0;
      for (const entry of slotEntries) {
        for (const targetId of this.getAgentDelegationTargets(entry.agent)) {
          const targetColumn = columnByAgentId.get(String(targetId || ''));
          if (targetColumn === 0) {
            leftLaneCount += 1;
          } else if (targetColumn === 1) {
            rightLaneCount += 1;
          }
        }
      }

      return { leftLaneCount, rightLaneCount };
    }

    getTopologySlotColumnGap(slot: any, columnCount: number) {
      if (columnCount < 2) {
        return 16;
      }

      const { laneSpacing, leftPadding, rightPadding, centerGap } = this.getTopologyProtectedLaneMetrics();
      const { leftLaneCount, rightLaneCount } = this.getTopologySlotLaneCounts(slot, columnCount);
      const leftSpread = Math.max(0, leftLaneCount - 1) * laneSpacing;
      const rightSpread = Math.max(0, rightLaneCount - 1) * laneSpacing;
      const requiredGap = leftPadding + rightPadding + centerGap + leftSpread + rightSpread;
      return Math.min(220, Math.max(92, requiredGap));
    }

    hasDelegationEdge(sourceAgentId: string, targetAgentId: string) {
      const sourceEntry = this.getTopologyAgentEntryById(sourceAgentId);
      if (!sourceEntry) return false;
      return this.getAgentDelegationTargets(sourceEntry.agent).includes(targetAgentId);
    }

    getTopologyReachableAgents(startAgentId: string, visited = new Set<string>()) {
      if (visited.has(startAgentId)) {
        return visited;
      }
      visited.add(startAgentId);
      const sourceEntry = this.getTopologyAgentEntryById(startAgentId);
      if (!sourceEntry) {
        return visited;
      }
      for (const targetId of this.getAgentDelegationTargets(sourceEntry.agent)) {
        if (this.getTopologyAgentEntryById(targetId)) {
          this.getTopologyReachableAgents(targetId, visited);
        }
      }
      return visited;
    }

    wouldCreateDelegationCycle(sourceAgentId: string, targetAgentId: string) {
      if (!sourceAgentId || !targetAgentId) return false;
      if (sourceAgentId === targetAgentId) return true;
      const reachable = this.getTopologyReachableAgents(targetAgentId, new Set<string>());
      return reachable.has(sourceAgentId);
    }

    setTopologyNotice(message: string) {
      this.topologyNotice = message;
    }

    clearTopologyNotice() {
      this.topologyNotice = '';
    }
  };
