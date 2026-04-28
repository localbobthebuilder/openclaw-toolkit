import { LitElement } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTopologySessionMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTopologySessionMixin extends Base {
    [key: string]: any;

    getTopologySessionsForAgent(agentId: string) {
      return this.topologyAgentSessions.filter((session: any) => session.agentId === agentId);
    }

    async getGatewayAuthToken() {
      if (!this.gatewayAuthTokenPromise) {
        this.gatewayAuthTokenPromise = fetch(this.getBaseUrl() + '/api/gateway-auth', { cache: 'no-store' })
          .then(async (response) => {
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(payload.details || payload.error || `Gateway auth lookup failed (${response.status})`);
            }
            const token = String(payload.token || '').trim();
            if (!token) {
              throw new Error('OpenClaw gateway token is empty.');
            }
            return token;
          });
      }
      return this.gatewayAuthTokenPromise;
    }

    async getTopologyAgentSessionUrl(sessionKey: string) {
      const token = await this.getGatewayAuthToken();
      const chatUrl = new URL(this.getOpenClawChatBaseUrl());
      chatUrl.searchParams.set('session', sessionKey);
      chatUrl.hash = `token=${encodeURIComponent(token)}`;
      return chatUrl.toString();
    }

    openTopologyAgentSession(sessionKey: string, url: string) {
      const opened = window.open(url, '_blank');
      if (opened) {
        this.monitorTopologyAgentSessionWindow(sessionKey, opened);
      }
      return opened;
    }

    monitorTopologyAgentSessionWindow(sessionKey: string, opened: Window) {
      const existingTimer = this.topologyAgentSessionPollTimers.get(sessionKey);
      if (existingTimer) {
        window.clearInterval(existingTimer);
      }
      this.topologyAgentSessionWindows.set(sessionKey, opened);
      const timer = window.setInterval(() => {
        if (!opened.closed) {
          return;
        }
        window.clearInterval(timer);
        this.topologyAgentSessionPollTimers.delete(sessionKey);
        this.topologyAgentSessionWindows.delete(sessionKey);
        if (this.topologyAgentSessions.some((session: any) => session.key === sessionKey)) {
          this.closeTopologyAgentSession(sessionKey, false);
        }
      }, 1500);
      this.topologyAgentSessionPollTimers.set(sessionKey, timer);
    }

    async createTopologyAgentSession(agentId: string) {
      const entry = this.getTopologyAgentEntryById(agentId);
      if (!entry || this.topologyAgentSessionBusyKey) {
        return;
      }
      this.topologyAgentSessionError = '';
      this.topologyAgentSessionBusyKey = `create:${agentId}`;
      const pendingWindow = window.open('about:blank', '_blank');
      if (pendingWindow) {
        pendingWindow.document.title = `${entry.name} - OpenClaw`;
        pendingWindow.document.body.innerHTML = '<p style="font-family: sans-serif; padding: 16px;">Creating OpenClaw agent session...</p>';
      }
      try {
        const label = `${entry.name} dashboard chat ${new Date().toLocaleTimeString()}`;
        const response = await fetch(this.getBaseUrl() + '/api/agent-sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, label })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.details || payload.error || `Session create failed (${response.status})`);
        }
        const key = String(payload.key || '').trim();
        if (!key) {
          throw new Error('OpenClaw did not return a session key.');
        }
        const chatUrl = await this.getTopologyAgentSessionUrl(key);
        let opened = pendingWindow;
        if (opened && !opened.closed) {
          opened.location.href = chatUrl;
          this.monitorTopologyAgentSessionWindow(key, opened);
        } else {
          opened = this.openTopologyAgentSession(key, chatUrl);
        }
        this.topologyAgentSessions = [
          {
            key,
            sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined,
            agentId,
            label,
            url: chatUrl,
            createdAt: Date.now()
          },
          ...this.topologyAgentSessions
        ];
        if (typeof this.loadTopologyAgentRuntimeToolState === 'function') {
          void this.loadTopologyAgentRuntimeToolState(agentId, { force: true, sessionKey: key });
        }
        this.setTopologyNotice(opened
          ? `Opened a persistent ${entry.name} session. Closing that chat tab will best-effort delete it.`
          : `Created ${entry.name} session. Popup was blocked; use the session chip/link to open it.`);
      } catch (err: any) {
        if (pendingWindow && !pendingWindow.closed) {
          pendingWindow.close();
        }
        this.topologyAgentSessionError = String(err?.message || err);
        this.setTopologyNotice(`Could not create agent session: ${this.topologyAgentSessionError}`);
      } finally {
        this.topologyAgentSessionBusyKey = null;
      }
    }

    async closeTopologyAgentSession(sessionKey: string, closeWindow = true) {
      if (!sessionKey || this.topologyAgentSessionBusyKey) {
        return;
      }
      this.topologyAgentSessionError = '';
      this.topologyAgentSessionBusyKey = `close:${sessionKey}`;
      const timer = this.topologyAgentSessionPollTimers.get(sessionKey);
      if (timer) {
        window.clearInterval(timer);
        this.topologyAgentSessionPollTimers.delete(sessionKey);
      }
      const deletedSession = this.topologyAgentSessions.find((session: any) => session.key === sessionKey) || null;
      const opened = this.topologyAgentSessionWindows.get(sessionKey);
      this.topologyAgentSessionWindows.delete(sessionKey);
      if (closeWindow && opened && !opened.closed) {
        opened.close();
      }
      try {
        const response = await fetch(this.getBaseUrl() + '/api/agent-sessions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: sessionKey })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.details || payload.error || `Session delete failed (${response.status})`);
        }
        this.topologyAgentSessions = this.topologyAgentSessions.filter((session: any) => session.key !== sessionKey);
        if (typeof this.loadTopologyAgentRuntimeToolState === 'function') {
          if (deletedSession?.agentId) {
            void this.loadTopologyAgentRuntimeToolState(deletedSession.agentId, { force: true });
          }
        }
        this.setTopologyNotice('Closed and deleted the dashboard-created agent session.');
      } catch (err: any) {
        this.topologyAgentSessionError = String(err?.message || err);
        this.setTopologyNotice(`Could not delete agent session: ${this.topologyAgentSessionError}`);
      } finally {
        this.topologyAgentSessionBusyKey = null;
      }
    }

    closeTrackedTopologyAgentWindows(agentIds: string[]) {
      const agentIdSet = new Set((Array.isArray(agentIds) ? agentIds : []).filter((value: any) => typeof value === 'string' && value.length > 0));
      if (agentIdSet.size === 0) {
        return;
      }

      for (const session of this.topologyAgentSessions) {
        if (!agentIdSet.has(session.agentId)) {
          continue;
        }
        const timer = this.topologyAgentSessionPollTimers.get(session.key);
        if (timer) {
          window.clearInterval(timer);
          this.topologyAgentSessionPollTimers.delete(session.key);
        }
        const opened = this.topologyAgentSessionWindows.get(session.key);
        this.topologyAgentSessionWindows.delete(session.key);
        if (opened && !opened.closed) {
          opened.close();
        }
      }
    }

    async clearTopologyAgentSessions(agentId: string) {
      const entry = this.getTopologyAgentEntryById(agentId);
      if (!entry || this.topologyAgentSessionBusyKey) {
        return;
      }
      if (!confirm(`Clear all stored sessions for ${entry.name} (${agentId})?\n\nThis empties that agent's sessions folder on disk and then attempts one gateway restart.`)) {
        return;
      }

      this.topologyAgentSessionError = '';
      this.topologyAgentSessionBusyKey = `clear:${agentId}`;
      try {
        const response = await fetch(this.getBaseUrl() + '/api/agent-sessions/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 207) {
          throw new Error(payload.details || payload.error || `Agent session clear failed (${response.status})`);
        }

        this.closeTrackedTopologyAgentWindows([agentId]);
        this.topologyAgentSessions = this.topologyAgentSessions.filter((session: any) => session.agentId !== agentId);
        if (typeof this.loadTopologyAgentRuntimeToolState === 'function') {
          void this.loadTopologyAgentRuntimeToolState(agentId, { force: true });
        }

        const result = Array.isArray(payload.results) ? payload.results[0] : null;
        const removedCount = Number(result?.removedEntries || 0);
        const restartedGateway = payload?.gatewayRestart?.restarted === true;
        const restartWarning = typeof payload?.gatewayRestart?.warning === 'string' ? payload.gatewayRestart.warning.trim() : '';
        this.setTopologyNotice(
          restartWarning
            ? `Cleared ${agentId} session files (${removedCount} entries). ${restartWarning}`
            : restartedGateway
              ? `Cleared ${agentId} session files (${removedCount} entries) and restarted the gateway.`
              : `Cleared ${agentId} session files (${removedCount} entries).`
        );
      } catch (err: any) {
        this.topologyAgentSessionError = String(err?.message || err);
        this.setTopologyNotice(`Could not clear ${agentId} sessions: ${this.topologyAgentSessionError}`);
      } finally {
        this.topologyAgentSessionBusyKey = null;
      }
    }

    async clearAllTopologyAgentSessions() {
      if (this.topologyAgentSessionBusyKey) {
        return;
      }
      if (!confirm('Clear all stored sessions for all known agents?\n\nThis empties every agent sessions folder on disk and then attempts one gateway restart.')) {
        return;
      }

      this.topologyAgentSessionError = '';
      this.topologyAgentSessionBusyKey = 'clear:all';
      try {
        const response = await fetch(this.getBaseUrl() + '/api/agent-sessions/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 207) {
          throw new Error(payload.details || payload.error || `Global session clear failed (${response.status})`);
        }

        const clearedAgentIds = Array.isArray(payload.agentIds) ? payload.agentIds.filter((value: any) => typeof value === 'string') : [];
        this.closeTrackedTopologyAgentWindows(clearedAgentIds);
        this.topologyAgentSessions = [];
        if (typeof this.loadTopologyAgentRuntimeToolState === 'function') {
          for (const agentId of clearedAgentIds) {
            void this.loadTopologyAgentRuntimeToolState(agentId, { force: true });
          }
        }

        const results = Array.isArray(payload.results) ? payload.results : [];
        const removedEntries = results.reduce((sum: number, entry: any) => sum + Number(entry?.removedEntries || 0), 0);
        const restartedGateway = payload?.gatewayRestart?.restarted === true;
        const restartWarning = typeof payload?.gatewayRestart?.warning === 'string' ? payload.gatewayRestart.warning.trim() : '';
        this.setTopologyNotice(
          restartWarning
            ? `Cleared all agent session folders (${removedEntries} entries removed). ${restartWarning}`
            : restartedGateway
              ? `Cleared all agent session folders (${removedEntries} entries removed) and restarted the gateway.`
              : `Cleared all agent session folders (${removedEntries} entries removed).`
        );
      } catch (err: any) {
        this.topologyAgentSessionError = String(err?.message || err);
        this.setTopologyNotice(`Could not clear all agent sessions: ${this.topologyAgentSessionError}`);
      } finally {
        this.topologyAgentSessionBusyKey = null;
      }
    }
  };
