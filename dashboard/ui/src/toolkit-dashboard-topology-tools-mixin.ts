import { LitElement } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTopologyToolsMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTopologyToolsMixin extends Base {
    [key: string]: any;

    getTopologyAgentRuntimeToolState(agentId: string) {
      return this.topologyAgentRuntimeToolsByAgent?.[agentId] || null;
    }

    async loadTopologyAgentRuntimeToolState(agentId: string, options: { force?: boolean; sessionKey?: string } = {}) {
      const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
      if (!normalizedAgentId) {
        return null;
      }

      const cached = this.getTopologyAgentRuntimeToolState(normalizedAgentId);
      const requestedSessionKey = typeof options.sessionKey === 'string' ? options.sessionKey.trim() : '';
      const selectedSessionKey = requestedSessionKey || this.topologyRuntimeToolSessionByAgent?.[normalizedAgentId] || '';
      if (!options.force && cached && (!selectedSessionKey || cached.selectedSessionKey === selectedSessionKey)) {
        return cached;
      }

      this.topologyAgentRuntimeToolsLoadingAgentId = normalizedAgentId;
      this.topologyAgentRuntimeToolErrorByAgent = {
        ...(this.topologyAgentRuntimeToolErrorByAgent || {}),
        [normalizedAgentId]: ''
      };

      try {
        const url = new URL(`${window.location.origin}${this.getBaseUrl()}/api/agents/${encodeURIComponent(normalizedAgentId)}/tools-runtime`);
        if (selectedSessionKey) {
          url.searchParams.set('sessionKey', selectedSessionKey);
        }

        const response = await fetch(url.toString(), { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.details || payload.error || `Agent runtime tools lookup failed (${response.status})`);
        }

        this.topologyAgentRuntimeToolsByAgent = {
          ...(this.topologyAgentRuntimeToolsByAgent || {}),
          [normalizedAgentId]: payload
        };
        this.topologyRuntimeToolSessionByAgent = {
          ...(this.topologyRuntimeToolSessionByAgent || {}),
          [normalizedAgentId]: String(payload.selectedSessionKey || '')
        };
        return payload;
      } catch (err: any) {
        this.topologyAgentRuntimeToolErrorByAgent = {
          ...(this.topologyAgentRuntimeToolErrorByAgent || {}),
          [normalizedAgentId]: String(err?.message || err)
        };
        return null;
      } finally {
        if (this.topologyAgentRuntimeToolsLoadingAgentId === normalizedAgentId) {
          this.topologyAgentRuntimeToolsLoadingAgentId = null;
        }
      }
    }

    async selectTopologyRuntimeToolSession(agentId: string, sessionKey: string) {
      const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
      const normalizedSessionKey = typeof sessionKey === 'string' ? sessionKey.trim() : '';
      this.topologyRuntimeToolSessionByAgent = {
        ...(this.topologyRuntimeToolSessionByAgent || {}),
        [normalizedAgentId]: normalizedSessionKey
      };
      await this.loadTopologyAgentRuntimeToolState(normalizedAgentId, {
        force: true,
        sessionKey: normalizedSessionKey
      });
    }
  };
