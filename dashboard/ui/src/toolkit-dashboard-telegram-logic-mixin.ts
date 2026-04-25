import { LitElement } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTelegramLogicMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTelegramLogicMixin extends Base {
    [key: string]: any;

  parseStatusOutput(output: string) {
      if (!output) return [];
      const sections: { title: string, content: string, status: 'online'|'offline'|'not-installed' }[] = [];
      const parts = output.split(/\[(.*?)\]/g);
      
      for (let i = 1; i < parts.length; i += 2) {
          const title = parts[i];
          let content = parts[i+1]?.trim() || '';
          let status: 'online'|'offline'|'not-installed' = 'online';
          
          try {
              const json = JSON.parse(content);
              if (json && typeof json === 'object') {
                  if (json.ok === false || json.status === 'error') status = 'offline';
                  content = Object.entries(json)
                      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`)
                      .join('\n');
              }
          } catch (e) {
               if (content.toLowerCase().includes('not installed') ||
                    content.toLowerCase().includes('not enabled') ||
                    content.toLowerCase().includes('not initialized') ||
                    content.toLowerCase().includes('setup incomplete') ||
                    content.toLowerCase().includes('missing bot token') ||
                    content.toLowerCase().includes('timed out') ||
                    content.toLowerCase().includes('not configured yet') ||
                    content.toLowerCase().includes('not authenticated') ||
                    content.toLowerCase().includes('not verified yet') ||
                    content.toLowerCase().includes('sign in required') ||
                    content.toLowerCase().includes('not cloned yet') ||
                    content.toLowerCase().includes('bootstrap not run yet')) {
                   status = 'not-installed';
                } else if (content.toLowerCase().includes('not ready') || 
                    content.toLowerCase().includes('not running') ||
                   content.toLowerCase().includes('failed') || 
                   content.toLowerCase().includes('not responding') ||
                   content.toLowerCase().includes('error')) {
                  status = 'offline';
              }
          }
          
          sections.push({ title, content, status });
      }
      return sections;
  }

  getTelegramLiveCheckState() {
      if (!this.statusLoaded) {
          return { available: false, reason: 'loading' as const };
      }

      const sections = this.parseStatusOutput(this.statusOutput);
      if (sections.length === 0) {
          return { available: false, reason: 'unknown' as const };
      }

      const dockerSection = sections.find(s => s.title === 'Docker');
      const gatewaySection = sections.find(s => s.title === 'Gateway');
      const wsl2Section = sections.find(s => s.title === 'WSL2');
      const virtSection = sections.find(s => s.title === 'Virtualization');
      const bootstrapSection = sections.find(s => s.title === 'Bootstrap');
      const managedImagesSection = sections.find(s => s.title === 'Managed Images');
      const scriptFailed = sections.length === 0 && !!this.statusOutput;
      const managedImageCounts = managedImagesSection?.content.match(/(\d+)\s*\/\s*(\d+)\s*present/i);
      const managedImagesPresentCount = managedImageCounts ? Number(managedImageCounts[1]) : 0;
      const managedImagesExpectedCount = managedImageCounts ? Number(managedImageCounts[2]) : 0;
      const bootstrapAssetsIncomplete = !scriptFailed && managedImagesExpectedCount > 0 && managedImagesPresentCount < managedImagesExpectedCount;
      const dockerNotInstalled = scriptFailed || dockerSection?.status === 'not-installed';
      const wsl2NotInstalled = !scriptFailed && (wsl2Section?.status === 'not-installed' || wsl2Section?.status === 'offline');
      const virtNotReady = !scriptFailed && virtSection?.status === 'not-installed';
      const dockerNotReady = !scriptFailed && dockerSection?.status === 'offline';
      const repoNotCloned = !scriptFailed && (!bootstrapSection || bootstrapSection.status === 'not-installed');
      const gatewayDown = !scriptFailed && (!gatewaySection || gatewaySection.status === 'offline');
      const bootstrapProvisioning = bootstrapAssetsIncomplete && gatewayDown;
      const isNewInstall = dockerNotInstalled || wsl2NotInstalled || virtNotReady || repoNotCloned || bootstrapProvisioning;
      const isServicesDown = !isNewInstall && (dockerNotReady || gatewayDown);

      if (isServicesDown) {
          return { available: false, reason: 'services-down' as const };
      }

      return { available: true, reason: 'ready' as const };
  }

  ensureTelegramConfig() {
      if (!this.config.telegram || typeof this.config.telegram !== 'object') {
          this.config.telegram = {};
      }
      if (typeof this.config.telegram.enabled !== 'boolean') {
          this.config.telegram.enabled = true;
      }
      if (typeof this.config.telegram.defaultAccount !== 'string' || !this.config.telegram.defaultAccount.trim()) {
          this.config.telegram.defaultAccount = 'default';
      } else {
          this.config.telegram.defaultAccount = this.config.telegram.defaultAccount.trim();
      }
      if (!Array.isArray(this.config.telegram.allowFrom)) {
          this.config.telegram.allowFrom = [];
      }
      if (!Array.isArray(this.config.telegram.groupAllowFrom)) {
          this.config.telegram.groupAllowFrom = [];
      }
      if (!Array.isArray(this.config.telegram.groups)) {
          this.config.telegram.groups = [];
      }
      if (!Array.isArray(this.config.telegram.accounts)) {
          this.config.telegram.accounts = [];
      }
      this.config.telegram.groups = this.config.telegram.groups.map((group: any) => this.normalizeTelegramGroupRecord(group));
      this.config.telegram.accounts = this.config.telegram.accounts.map((account: any) => this.normalizeTelegramAccountRecord(account));
      return this.config.telegram;
  }

  ensureVoiceNotesConfig() {
      if (!this.config.voiceNotes || typeof this.config.voiceNotes !== 'object') {
          this.config.voiceNotes = {};
      }
      if (typeof this.config.voiceNotes.enabled !== 'boolean') {
          this.config.voiceNotes.enabled = false;
      }
      if (!this.config.voiceNotes.mode) {
          this.config.voiceNotes.mode = 'local-whisper';
      }
      if (!this.config.voiceNotes.gatewayImageTag) {
          this.config.voiceNotes.gatewayImageTag = 'openclaw:local-voice';
      }
      if (typeof this.config.voiceNotes.whisperModel !== 'string' || !this.config.voiceNotes.whisperModel.trim()) {
          this.config.voiceNotes.whisperModel = 'base';
      }
      return this.config.voiceNotes;
  }

  getVoiceWhisperModelOptions() {
      return Array.from(new Set(this.voiceWhisperModels as string[])).sort((a: string, b: string) => a.localeCompare(b));
  }

  ensureTelegramExecApprovalsConfig(target?: any) {
      const telegramTarget = target && typeof target === 'object' ? target : this.ensureTelegramConfig();
      if (!telegramTarget.execApprovals || typeof telegramTarget.execApprovals !== 'object') {
          telegramTarget.execApprovals = {};
      }
      telegramTarget.execApprovals = this.normalizeTelegramExecApprovalsRecord(telegramTarget.execApprovals);
      return telegramTarget.execApprovals;
  }

  parseCommaSeparatedList(value: string) {
      return value.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  }

  getDefaultTelegramAccountId() {
      const telegram = this.ensureTelegramConfig();
      const value = typeof telegram.defaultAccount === 'string' ? telegram.defaultAccount.trim() : '';
      return value || 'default';
  }

  setDefaultTelegramAccountId(nextValue: string) {
      const telegram = this.ensureTelegramConfig();
      const previousValue = this.getDefaultTelegramAccountId();
      const normalizedValue = typeof nextValue === 'string' && nextValue.trim() ? nextValue.trim() : 'default';
      telegram.defaultAccount = normalizedValue;
      this.renameTelegramRouteAccountId(previousValue, normalizedValue);
      this.ensureTelegramRoutingConfig();
      this.requestUpdate();
  }

  normalizeTelegramExecApprovalsRecord(execApprovals: any) {
      const normalized = JSON.parse(JSON.stringify(execApprovals || {}));
      normalized.enabled = this.normalizeBoolean(normalized.enabled, false);
      if (!Array.isArray(normalized.approvers)) {
          normalized.approvers = [];
      }
      if (!normalized.target) {
          normalized.target = 'dm';
      }
      return normalized;
  }

  normalizeSingleTelegramRouteRule(route: any, defaultAccountId: string) {
      const normalized = JSON.parse(JSON.stringify(route || {}));
      normalized.accountId = typeof normalized.accountId === 'string' && normalized.accountId.trim()
        ? normalized.accountId.trim()
        : defaultAccountId;
      normalized.targetAgentId = typeof normalized.targetAgentId === 'string' ? normalized.targetAgentId.trim() : '';
      normalized.matchType = typeof normalized.matchType === 'string' ? normalized.matchType.trim().toLowerCase() : '';
      normalized.peerId = typeof normalized.peerId === 'string' ? normalized.peerId.trim() : '';
      if (!['trusted-dms', 'trusted-groups', 'direct', 'group'].includes(normalized.matchType)) {
        return null;
      }
      if (['direct', 'group'].includes(normalized.matchType) && !normalized.peerId) {
        return null;
      }
      if (!normalized.targetAgentId) {
        return null;
      }
      return normalized;
  }

  expandTelegramRouteEntries(route: any, defaultAccountId: string) {
      const source = JSON.parse(JSON.stringify(route || {}));
      const accountId = typeof source.accountId === 'string' && source.accountId.trim()
        ? source.accountId.trim()
        : defaultAccountId;
      const targetAgentId = typeof source.targetAgentId === 'string' ? source.targetAgentId.trim() : '';
      const matchType = typeof source.matchType === 'string' ? source.matchType.trim().toLowerCase() : '';
      const peerId = typeof source.peerId === 'string' ? source.peerId.trim() : '';

      if (matchType) {
        const normalized = this.normalizeSingleTelegramRouteRule({
          accountId,
          targetAgentId,
          matchType,
          peerId
        }, defaultAccountId);
        return normalized ? [normalized] : [];
      }
      return [];
  }

  getTelegramRouteKey(route: any) {
      const accountId = typeof route?.accountId === 'string' ? route.accountId.trim() : '';
      const matchType = typeof route?.matchType === 'string' ? route.matchType.trim().toLowerCase() : '';
      const peerId = typeof route?.peerId === 'string' ? route.peerId.trim() : '';
      return `${accountId}|${matchType}|${peerId}`;
  }

  normalizeTelegramRouteList(routes: any[], defaultAccountId: string) {
      const normalizedRoutes = new Map<string, any>();
      for (const route of Array.isArray(routes) ? routes : []) {
          for (const normalizedRoute of this.expandTelegramRouteEntries(route, defaultAccountId)) {
              if (!normalizedRoute?.accountId || !normalizedRoute?.matchType || !normalizedRoute?.targetAgentId) continue;
              normalizedRoutes.set(this.getTelegramRouteKey(normalizedRoute), normalizedRoute);
          }
      }
      return Array.from(normalizedRoutes.values());
  }

  ensureTelegramRoutingConfig() {
      const telegramRouting = this.getTelegramRoutingRoot();
      const defaultAccountId = this.getDefaultTelegramAccountId();
      telegramRouting.routes = this.normalizeTelegramRouteList(Array.isArray(telegramRouting.routes) ? telegramRouting.routes : [], defaultAccountId);
      return telegramRouting;
  }

  getTelegramRouteList() {
      return this.ensureTelegramRoutingConfig().routes;
  }

  getTelegramRouteRecord(accountId: string, matchType: string, peerId = '') {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : this.getDefaultTelegramAccountId();
      const normalizedMatchType = typeof matchType === 'string' ? matchType.trim().toLowerCase() : '';
      const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';
      return this.getTelegramRouteList().find((route: any) =>
        String(route?.accountId || '') === normalizedAccountId
        && String(route?.matchType || '').toLowerCase() === normalizedMatchType
        && String(route?.peerId || '') === normalizedPeerId
      ) || null;
  }

  getTelegramRoutesForAgent(agentId: string) {
      const normalizedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
      if (!normalizedAgentId) return [];
      return this.getTelegramRouteList().filter((route: any) => String(route?.targetAgentId || '') === normalizedAgentId);
  }

  getTelegramRouteListForAccount(accountId: string) {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : this.getDefaultTelegramAccountId();
      return this.getTelegramRouteList().filter((route: any) => String(route?.accountId || '') === normalizedAccountId);
  }

  upsertTelegramRouteRecord(route: any) {
      const normalized = this.normalizeSingleTelegramRouteRule(route, this.getDefaultTelegramAccountId());
      if (!normalized) return null;
      const routeKey = this.getTelegramRouteKey(normalized);
      const telegramRouting = this.ensureTelegramRoutingConfig();
      const nextRoutes = this.getTelegramRouteList()
        .filter((candidate: any) => this.getTelegramRouteKey(candidate) !== routeKey);
      nextRoutes.push(normalized);
      telegramRouting.routes = this.normalizeTelegramRouteList(nextRoutes, this.getDefaultTelegramAccountId());
      return normalized;
  }

  setTelegramManagedRouteTarget(accountId: string, matchType: string, targetAgentId: string, peerId = '') {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : this.getDefaultTelegramAccountId();
      const normalizedMatchType = typeof matchType === 'string' ? matchType.trim().toLowerCase() : '';
      const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';
      const normalizedTargetAgentId = typeof targetAgentId === 'string' ? targetAgentId.trim() : '';
      if (!normalizedTargetAgentId) {
        this.removeTelegramRouteRule(normalizedAccountId, normalizedMatchType, normalizedPeerId);
        return null;
      }

      return this.upsertTelegramRouteRecord({
        accountId: normalizedAccountId,
        targetAgentId: normalizedTargetAgentId,
        matchType: normalizedMatchType,
        peerId: normalizedPeerId
      });
  }

  addTelegramSpecificRoute(accountId: string) {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : this.getDefaultTelegramAccountId();
      const defaultTargetAgentId = String(this.getDefaultRoutingAgentEntry()?.agent?.id || '').trim();
      if (!defaultTargetAgentId) return;
      let route = {
        accountId: normalizedAccountId,
        targetAgentId: defaultTargetAgentId,
        matchType: 'group',
        peerId: ''
      };
      let suffix = 1;
      let candidatePeerId = '-1000000000000';
      while (this.getTelegramRouteRecord(normalizedAccountId, 'group', candidatePeerId)) {
        suffix += 1;
        candidatePeerId = `-100000000000${suffix}`;
      }
      route.peerId = candidatePeerId;
      this.upsertTelegramRouteRecord(route);
      this.requestUpdate();
  }

  removeTelegramRouteRule(accountId: string, matchType: string, peerId = '') {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : '';
      const normalizedMatchType = typeof matchType === 'string' ? matchType.trim().toLowerCase() : '';
      const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';
      if (!normalizedAccountId || !normalizedMatchType) return;
      const telegramRouting = this.ensureTelegramRoutingConfig();
      telegramRouting.routes = this.getTelegramRouteList().filter((route: any) =>
        !(String(route?.accountId || '') === normalizedAccountId
          && String(route?.matchType || '').toLowerCase() === normalizedMatchType
          && String(route?.peerId || '') === normalizedPeerId));
  }

  removeTelegramRouteRecord(accountId: string) {
      const normalizedAccountId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : '';
      if (!normalizedAccountId) return;
      const telegramRouting = this.ensureTelegramRoutingConfig();
      telegramRouting.routes = this.getTelegramRouteList().filter((route: any) => String(route?.accountId || '') !== normalizedAccountId);
  }

  renameTelegramRouteAccountId(oldId: string, newId: string) {
      const normalizedOldId = typeof oldId === 'string' ? oldId.trim() : '';
      const normalizedNewId = typeof newId === 'string' ? newId.trim() : '';
      if (!normalizedOldId || !normalizedNewId || normalizedOldId === normalizedNewId) return;

      const telegramRouting = this.ensureTelegramRoutingConfig();
      telegramRouting.routes = this.getTelegramRouteList()
        .filter((route: any) => {
          if (String(route?.accountId || '') !== normalizedOldId) return true;
          route.accountId = normalizedNewId;
          return true;
        })
        .map((route: any) => this.normalizeSingleTelegramRouteRule(route, this.getDefaultTelegramAccountId()))
        .filter(Boolean);
      telegramRouting.routes = this.normalizeTelegramRouteList(telegramRouting.routes, this.getDefaultTelegramAccountId());
  }

  normalizeTelegramAccountRecord(account: any) {
      const normalized = JSON.parse(JSON.stringify(account || {}));
      normalized.id = typeof normalized.id === 'string' ? normalized.id.trim() : '';
      normalized.enabled = this.normalizeBoolean(normalized.enabled, true);
      if (!normalized.dmPolicy) {
          normalized.dmPolicy = 'pairing';
      }
      if (!normalized.groupPolicy) {
          normalized.groupPolicy = 'allowlist';
      }
      if (!Array.isArray(normalized.allowFrom)) {
          normalized.allowFrom = [];
      }
      if (!Array.isArray(normalized.groupAllowFrom)) {
          normalized.groupAllowFrom = [];
      }
      if (Array.isArray(normalized.groups)) {
          normalized.groups = normalized.groups.map((group: any) => this.normalizeTelegramGroupRecord(group));
      } else {
          normalized.groups = [];
      }
      normalized.execApprovals = this.normalizeTelegramExecApprovalsRecord(normalized.execApprovals);
      return normalized;
  }

  addTelegramAccount() {
      const telegram = this.ensureTelegramConfig();
      const existingIds = new Set((Array.isArray(telegram.accounts) ? telegram.accounts : []).map((account: any) => String(account?.id || '')));
      let suffix = (Array.isArray(telegram.accounts) ? telegram.accounts.length : 0) + 1;
      let suggestedId = `telegram-bot-${suffix}`;
      while (existingIds.has(suggestedId) || suggestedId === this.getDefaultTelegramAccountId()) {
          suffix += 1;
          suggestedId = `telegram-bot-${suffix}`;
      }
      telegram.accounts.push(this.normalizeTelegramAccountRecord({
          id: suggestedId,
          enabled: true,
          dmPolicy: 'pairing',
          allowFrom: [],
          groupPolicy: 'allowlist',
          groupAllowFrom: [],
          groups: [],
          execApprovals: {
              enabled: false,
              approvers: [],
              target: 'dm'
          }
      }));
      this.requestUpdate();
  }

  removeTelegramAccount(index: number) {
      const telegram = this.ensureTelegramConfig();
      const account = Array.isArray(telegram.accounts) ? telegram.accounts[index] : null;
      const accountId = typeof account?.id === 'string' ? account.id.trim() : '';
      if (Array.isArray(telegram.accounts)) {
          telegram.accounts.splice(index, 1);
      }
      if (accountId) {
          this.removeTelegramRouteRecord(accountId);
      }
      this.requestUpdate();
  }

  addTelegramGroup(target?: any) {
      const telegramTarget = target && typeof target === 'object' ? target : this.ensureTelegramConfig();
      if (!Array.isArray(telegramTarget.groups)) {
          telegramTarget.groups = [];
      }
      telegramTarget.groups.push({
          id: '',
          enabled: true,
          requireMention: true,
          allowFrom: []
      });
      this.requestUpdate();
  }

  removeTelegramGroup(index: number, target?: any) {
      const telegramTarget = target && typeof target === 'object' ? target : this.ensureTelegramConfig();
      if (Array.isArray(telegramTarget.groups)) {
          telegramTarget.groups.splice(index, 1);
      }
      this.requestUpdate();
  }

  getTelegramDmPolicyDescription(policy: string) {
      switch ((policy || '').trim()) {
        case 'allowlist':
          return 'Only numeric Telegram user IDs listed in Allowed User IDs can start DMs with this bot. An empty allowlist effectively blocks all DMs.';
        case 'open':
          return 'Any Telegram user can DM this bot. Use this only when you intentionally want a public-facing bot.';
        case 'disabled':
          return 'Block all Telegram direct messages for this account.';
        case 'pairing':
        default:
          return 'First-time DM senders must pair or be approved before this bot accepts their direct messages. This is the safest default for owner-operated bots.';
      }
  }

  getTelegramGroupPolicyDescription(policy: string) {
      switch ((policy || '').trim()) {
        case 'open':
          return 'Anyone inside an allowed Telegram group can talk to this bot. Group IDs still need to be listed under Allowed Groups unless you intentionally open that surface.';
        case 'disabled':
          return 'Disable Telegram group interaction for this account even if groups are configured below.';
        case 'allowlist':
        default:
          return 'Only approved senders inside allowed Telegram groups can trigger this bot. If Allowed Group Sender IDs is empty, OpenClaw falls back to the DM allowlist.';
      }
  }

  getTelegramExecApprovalTargetDescription(target: string) {
      switch ((target || '').trim()) {
        case 'channel':
          return 'Post exec approval prompts back into the originating Telegram chat or topic instead of approver DMs.';
        case 'both':
          return 'Send exec approval prompts to both approver DMs and the originating Telegram chat or topic.';
        case 'dm':
        default:
          return 'Send exec approval prompts only to the approver DMs. This is the quietest and safest default.';
      }
  }



  };
