import { LitElement } from 'lit';
import { VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES } from './toolkit-dashboard-constants';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTopologyCatalogMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTopologyCatalogMixin extends Base {
    [key: string]: any;

    getConfigEndpoints() {
      return this.getConfigEndpointsFrom(this.config);
    }

    getSortedConfigEndpoints() {
      return [...this.getConfigEndpoints()].sort((left: any, right: any) => {
        const leftDefault = left?.default ? 0 : 1;
        const rightDefault = right?.default ? 0 : 1;
        if (leftDefault !== rightDefault) {
          return leftDefault - rightDefault;
        }
        return String(left?.name || left?.key || '').localeCompare(String(right?.name || right?.key || ''));
      });
    }

    getDefaultEndpoint() {
      const endpoints = this.getSortedConfigEndpoints();
      return endpoints.find((endpoint: any) => !!endpoint?.default) || endpoints[0] || null;
    }

    canRemoveEndpoint(endpoint: any) {
      return !endpoint?.default;
    }

    getEndpointsForModelRef(modelRef: string | undefined) {
      if (typeof modelRef !== 'string' || modelRef.length === 0) {
        return [];
      }

      return this.getConfigEndpoints().filter((endpoint: any) =>
        this.getEndpointModelOptions(endpoint).some((option: any) => option.ref === modelRef)
      );
    }

    resolveAgentEndpoint(agent: any) {
      const agentId = String(agent?.id || '').trim();
      if (!agentId) {
        return null;
      }

      for (const endpoint of this.getConfigEndpoints()) {
        if (this.getEndpointAgentIds(endpoint).includes(agentId)) {
          return endpoint;
        }
      }

      return null;
    }

    getEndpointOllama(endpoint: any) {
      if (endpoint?.ollama && typeof endpoint.ollama === 'object') {
        return endpoint.ollama;
      }
      if (endpoint && (endpoint.baseUrl || endpoint.hostBaseUrl || endpoint.providerId || Array.isArray(endpoint.models))) {
        return endpoint;
      }
      return null;
    }

    ensureEndpointOllama(endpoint: any) {
      let runtime = this.getEndpointOllama(endpoint);
      if (runtime && runtime !== endpoint) {
        return runtime;
      }
      if (runtime === endpoint) {
        return endpoint;
      }

      const suffix = String(endpoint?.key || 'local').replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'local';
      endpoint.ollama = {
        enabled: true,
        providerId: suffix === 'local' ? 'ollama' : `ollama-${suffix}`,
        hostBaseUrl: 'http://127.0.0.1:11434',
        baseUrl: 'http://host.docker.internal:11434',
        apiKey: suffix === 'local' ? 'ollama-local' : `ollama-${suffix}`,
        autoPullMissingModels: true,
        models: []
      };
      return endpoint.ollama;
    }

    getEndpointModels(endpoint: any) {
      const runtime = this.getEndpointOllama(endpoint);
      if (Array.isArray(runtime?.models)) {
        return runtime.models;
      }
      return [];
    }

    getLegacyManagedAgentKeys() {
      return [
        'strongAgent',
        'researchAgent',
        'localChatAgent',
        'hostedTelegramAgent',
        'localReviewAgent',
        'localCoderAgent',
        'remoteReviewAgent',
        'remoteCoderAgent'
      ];
    }

    inferModelSourceFromAgent(agent: any) {
      const refs: string[] = [];
      if (typeof agent?.modelRef === 'string' && agent.modelRef.length > 0) {
        refs.push(agent.modelRef);
      }
      if (Array.isArray(agent?.candidateModelRefs)) {
        for (const ref of agent.candidateModelRefs) {
          if (typeof ref === 'string' && ref.length > 0 && !refs.includes(ref)) {
            refs.push(ref);
          }
        }
      }
      for (const ref of refs) {
        if (ref.startsWith('ollama/')) {
          return 'local';
        }
      }
      for (const ref of refs) {
        if (ref.includes('/')) {
          return 'hosted';
        }
      }
      return 'hosted';
    }

    sanitizeAgentRecord(agent: any, key?: string) {
      const clone = JSON.parse(JSON.stringify(agent || {}));
      if (key) clone.key = key;
      delete clone.modelSource;
      clone.enabled = this.normalizeBoolean(clone.enabled, true);
      clone.thinkingDefault = this.normalizeThinkingDefault(clone.thinkingDefault);
      this.normalizeParamsRecord(clone);
      delete clone.endpointKey;
      clone.markdownTemplateKeys = this.normalizeMarkdownTemplateSelections(clone, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
      delete clone.rolePolicyKey;
      clone.toolsetKeys = this.ensureAgentToolsetKeys(clone);
      const normalizedToolOverrides = this.normalizeAgentToolOverrides(clone);
      if (normalizedToolOverrides) {
        clone.toolOverrides = normalizedToolOverrides;
      } else {
        delete clone.toolOverrides;
      }
      if (!Array.isArray(clone.candidateModelRefs)) {
        clone.candidateModelRefs = [];
      }
      clone.subagents = this.ensureSubagentsConfig(clone);
      if (typeof clone.modelRef !== 'string') {
        clone.modelRef = '';
      }
      clone.modelSource = this.inferModelSourceFromAgent(clone);
      return clone;
    }

    buildPersistedConfig(config: any) {
      const clone = JSON.parse(JSON.stringify(config));
      const defaultTelegramAccountId = (clone.telegram?.defaultAccount && String(clone.telegram.defaultAccount).trim()) || 'default';
      clone.agents = clone.agents || { telegramRouting: {}, list: [] };
      clone.agents.telegramRouting = clone.agents.telegramRouting || {};
      clone.agents.telegramRouting.routes = this.normalizeTelegramRouteList(
        Array.isArray(clone.agents.telegramRouting.routes) ? clone.agents.telegramRouting.routes : [],
        defaultTelegramAccountId
      );
      clone.workspaces = Array.isArray(clone.workspaces) ? clone.workspaces.map((workspace: any) => this.normalizeWorkspaceRecord(workspace)) : [];
      this.ensureToolsetsConfig(clone);
      const normalizedEndpoints = this.getConfigEndpointsFrom(clone).map((endpoint: any) => this.normalizeEndpointRecord(endpoint));
      if (Array.isArray(clone.endpoints)) {
        // Canonicalize any flat endpoint.vramHeadroomMiB into endpoint.ollama.vramHeadroomMiB
        for (const ep of normalizedEndpoints) {
          if (ep && typeof ep === 'object') {
            if (typeof ep.vramHeadroomMiB !== 'undefined' && ep.vramHeadroomMiB !== null) {
              if (!ep.ollama || typeof ep.ollama !== 'object') {
                ep.ollama = {};
              }
              if (typeof ep.ollama.vramHeadroomMiB === 'undefined' || ep.ollama.vramHeadroomMiB === null) {
                const parsed = Number(ep.vramHeadroomMiB);
                if (Number.isFinite(parsed) && parsed >= 0) {
                  ep.ollama.vramHeadroomMiB = Math.round(parsed);
                }
              }
              delete ep.vramHeadroomMiB;
            }
            if (ep.ollama && typeof ep.ollama === 'object' && typeof ep.ollama.vramHeadroomMiB !== 'undefined' && ep.ollama.vramHeadroomMiB !== null) {
              const parsedRuntime = Number(ep.ollama.vramHeadroomMiB);
              if (Number.isFinite(parsedRuntime) && parsedRuntime >= 0) {
                ep.ollama.vramHeadroomMiB = Math.round(parsedRuntime);
              } else {
                delete ep.ollama.vramHeadroomMiB;
              }
            }
          }
        }
        clone.endpoints = normalizedEndpoints;
      }
      this.normalizeEndpointAgentAssignments(clone);
      this.normalizeWorkspaceAssignments(clone);
      if (Array.isArray(clone.agents?.list)) {
        clone.agents.list = clone.agents.list.map((agent: any) => {
          const normalized = this.sanitizeAgentRecord(agent, agent?.key);
          delete normalized.modelSource;
          delete normalized.workspaceMode;
          delete normalized.workspace;
          delete normalized.sharedWorkspaceAccess;
          delete normalized.rolePolicyKey;
          return normalized;
        });
      }
      clone.toolsets.list = this.getToolsetsList(clone).map((toolset: any) => this.createToolsetRecord(toolset));
      delete clone.toolPolicy;
      if (clone.telegram && typeof clone.telegram === 'object') {
        delete clone.telegram.botToken;
        delete clone.telegram.tokenFile;
        clone.telegram.defaultAccount = (typeof clone.telegram.defaultAccount === 'string' && clone.telegram.defaultAccount.trim())
          ? clone.telegram.defaultAccount.trim()
          : 'default';
        clone.telegram.accounts = Array.isArray(clone.telegram.accounts)
          ? clone.telegram.accounts.map((account: any) => {
              const normalized = this.normalizeTelegramAccountRecord(account);
              delete normalized.botToken;
              delete normalized.tokenFile;
              return normalized;
            }).filter((account: any) => typeof account.id === 'string' && account.id.trim().length > 0)
          : [];
      }
      for (const workspace of Array.isArray(clone.workspaces) ? clone.workspaces : []) {
        delete workspace.allowSharedWorkspaceAccess;
      }
      return clone;
    }

    sanitizeConfigModelNames(config: any) {
      const clone = JSON.parse(JSON.stringify(config));
      if (!clone) return clone;
      const defaultTelegramAccountId = (clone.telegram?.defaultAccount && String(clone.telegram.defaultAccount).trim()) || 'default';
      if (!clone.agents || typeof clone.agents !== 'object') {
        clone.agents = { telegramRouting: {}, list: [] };
      }
      clone.agents.telegramRouting = clone.agents.telegramRouting || {};
      clone.agents.telegramRouting.routes = this.normalizeTelegramRouteList(
        Array.isArray(clone.agents.telegramRouting.routes) ? clone.agents.telegramRouting.routes : [],
        defaultTelegramAccountId
      );
      if (!Array.isArray(clone.agents.list)) {
        clone.agents.list = [];
      }
      if (!Array.isArray(clone.workspaces)) {
        clone.workspaces = [];
      }
      this.ensureToolsetsConfig(clone);
      const normalizedEndpoints = this.getConfigEndpointsFrom(clone).map((endpoint: any) => this.normalizeEndpointRecord(endpoint));
      if (Array.isArray(clone.endpoints)) {
        clone.endpoints = normalizedEndpoints;
      }
      this.normalizeEndpointAgentAssignments(clone);
      clone.workspaces = clone.workspaces.map((workspace: any) => this.normalizeWorkspaceRecord(workspace));
      this.normalizeWorkspaceAssignments(clone);
      clone.agents.list = clone.agents.list.map((agent: any) => {
        const normalized = this.sanitizeAgentRecord(agent, agent?.key);
        delete normalized.workspaceMode;
        delete normalized.workspace;
        delete normalized.sharedWorkspaceAccess;
        return normalized;
      });
      clone.toolsets.list = this.getToolsetsList(clone).map((toolset: any) => this.createToolsetRecord(toolset));
      delete clone.toolPolicy;
      if (!clone.ollama) clone.ollama = {};
      if (!clone.skills || typeof clone.skills !== 'object') clone.skills = {};
      if (!clone.voiceNotes || typeof clone.voiceNotes !== 'object') clone.voiceNotes = {};
      if (typeof clone.skills.enableAll !== 'boolean') {
        clone.skills.enableAll = clone.skills.enableAll === false || clone.skills.enableAll === 'false' ? false : true;
      }
      if (typeof clone.voiceNotes.enabled !== 'boolean') {
        clone.voiceNotes.enabled = clone.voiceNotes.enabled === true || clone.voiceNotes.enabled === 'true';
      }
      if (typeof clone.voiceNotes.mode !== 'string' || !clone.voiceNotes.mode.trim()) {
        clone.voiceNotes.mode = 'local-whisper';
      }
      if (typeof clone.voiceNotes.gatewayImageTag !== 'string' || !clone.voiceNotes.gatewayImageTag.trim()) {
        clone.voiceNotes.gatewayImageTag = 'openclaw:local-voice';
      }
      if (typeof clone.voiceNotes.whisperModel !== 'string' || !clone.voiceNotes.whisperModel.trim()) {
        clone.voiceNotes.whisperModel = 'base';
      }
      if (clone.telegram && typeof clone.telegram === 'object') {
        delete clone.telegram.botToken;
        delete clone.telegram.tokenFile;
        clone.telegram.enabled = this.normalizeBoolean(clone.telegram.enabled, true);
        clone.telegram.defaultAccount = (typeof clone.telegram.defaultAccount === 'string' && clone.telegram.defaultAccount.trim())
          ? clone.telegram.defaultAccount.trim()
          : 'default';
        if (Array.isArray(clone.telegram.groups)) {
          clone.telegram.groups = clone.telegram.groups.map((group: any) => this.normalizeTelegramGroupRecord(group));
        } else {
          clone.telegram.groups = [];
        }
        if (Array.isArray(clone.telegram.accounts)) {
          clone.telegram.accounts = clone.telegram.accounts.map((account: any) => {
            const normalized = this.normalizeTelegramAccountRecord(account);
            delete normalized.botToken;
            delete normalized.tokenFile;
            return normalized;
          }).filter((account: any) => typeof account.id === 'string' && account.id.trim().length > 0);
        } else {
          clone.telegram.accounts = [];
        }
        if (clone.telegram.execApprovals && typeof clone.telegram.execApprovals === 'object') {
          clone.telegram.execApprovals = this.normalizeTelegramExecApprovalsRecord(clone.telegram.execApprovals);
        }
      }
      if (typeof clone.ollama.pullVramBudgetFraction !== 'number' || !Number.isFinite(clone.ollama.pullVramBudgetFraction) || clone.ollama.pullVramBudgetFraction <= 0 || clone.ollama.pullVramBudgetFraction > 1) {
        const parsedBudget = Number(clone.ollama.pullVramBudgetFraction);
        clone.ollama.pullVramBudgetFraction = Number.isFinite(parsedBudget) && parsedBudget > 0 && parsedBudget <= 1 ? parsedBudget : 0.7;
      }
      if (typeof clone.ollama.vramHeadroomMiB !== 'number' || !Number.isFinite(clone.ollama.vramHeadroomMiB) || clone.ollama.vramHeadroomMiB < 0) {
        const parsedHeadroom = Number(clone.ollama.vramHeadroomMiB);
        clone.ollama.vramHeadroomMiB = Number.isFinite(parsedHeadroom) && parsedHeadroom >= 0 ? Math.round(parsedHeadroom) : 1536;
      }

      const normalizeEndpoint = (endpoint: any) => {
        const normalized: any = {
          key: endpoint?.key || 'local',
          default: this.normalizeBoolean(endpoint?.default, false)
        };

        if (endpoint?.name) normalized.name = endpoint.name;
        if (endpoint?.telemetry) normalized.telemetry = endpoint.telemetry;
        normalized.agents = this.getEndpointAgentIds(endpoint);
        if (Array.isArray(endpoint?.hostedModels)) {
          normalized.hostedModels = this.sanitizeModelEntries(endpoint.hostedModels);
        }

        const rawRuntime = endpoint?.ollama || endpoint;
        const hasRuntime = !!endpoint?.ollama ||
          !!endpoint?.baseUrl ||
          !!endpoint?.hostBaseUrl ||
          !!endpoint?.providerId ||
          Array.isArray(endpoint?.models) ||
          (typeof rawRuntime?.vramHeadroomMiB !== 'undefined' && rawRuntime.vramHeadroomMiB !== null);

        if (hasRuntime) {
          const runtime: any = {};
          runtime.enabled = this.normalizeBoolean(rawRuntime?.enabled, true);
          if (rawRuntime?.providerId) runtime.providerId = rawRuntime.providerId;
          if (rawRuntime?.baseUrl) runtime.baseUrl = rawRuntime.baseUrl;
          if (rawRuntime?.hostBaseUrl) runtime.hostBaseUrl = rawRuntime.hostBaseUrl;
          if (rawRuntime?.apiKey) runtime.apiKey = rawRuntime.apiKey;
          runtime.autoPullMissingModels = this.normalizeBoolean(rawRuntime?.autoPullMissingModels, true);
          if (Array.isArray(rawRuntime?.models)) {
            runtime.models = this.sanitizeModelEntries(rawRuntime.models);
          }
          // Per-endpoint VRAM headroom override (MiB)
          if (typeof rawRuntime?.vramHeadroomMiB !== 'undefined') {
            const parsed = Number(rawRuntime.vramHeadroomMiB);
            if (Number.isFinite(parsed) && parsed >= 0) {
              runtime.vramHeadroomMiB = Math.round(parsed);
            }
          }
          normalized.ollama = runtime;
        }

        return normalized;
      };

      if (Array.isArray(clone.modelCatalog)) {
        clone.modelCatalog = this.sanitizeSharedCatalogEntries(clone.modelCatalog);
      } else if (Array.isArray(clone.ollama.models)) {
        clone.modelCatalog = this.sanitizeSharedCatalogEntries(clone.ollama.models);
        delete clone.ollama.models;
      }

      if (Array.isArray(clone.endpoints)) {
        clone.endpoints = clone.endpoints.map((endpoint: any) => normalizeEndpoint(endpoint));
      } else {
        clone.endpoints = [];
      }

      return clone;
    }

    getEndpointHostedModels(endpoint: any) {
      if (Array.isArray(endpoint?.hostedModels)) {
        return endpoint.hostedModels;
      }
      return [];
    }

    isHostedCatalogModel(model: any) {
      return typeof model?.modelRef === 'string' && model.modelRef.includes('/');
    }

    isLocalCatalogModel(model: any) {
      return typeof model?.id === 'string' && model.id.length > 0;
    }

    getEndpointLabel(endpoint: any) {
      if (endpoint?.name) {
        return `${endpoint.key} (${endpoint.name})`;
      }
      return String(endpoint?.key || 'endpoint');
    }

    getCatalogModelAssignments(model: any) {
      if (this.isLocalCatalogModel(model)) {
        return this.getConfigEndpoints().filter((endpoint: any) =>
          this.getEndpointModels(endpoint).some((entry: any) => String(entry?.id || '') === String(model.id))
        );
      }

      if (this.isHostedCatalogModel(model)) {
        return this.getConfigEndpoints().filter((endpoint: any) =>
          this.getEndpointHostedModels(endpoint).some((entry: any) => String(entry?.modelRef || '') === String(model.modelRef))
        );
      }

      return [];
    }

    cloneModelCatalogEntry(model: any) {
      const clone = JSON.parse(JSON.stringify(model));
      delete clone.name;
      delete clone.fallbackModelIds;
      return clone;
    }

    getSharedModelCatalog() {
      if (Array.isArray(this.config?.modelCatalog)) {
        return this.config.modelCatalog;
      }
      if (Array.isArray(this.config?.ollama?.models)) {
        return this.config.ollama.models;
      }
      return [];
    }

    getKnownLocalModelCatalog() {
      const models: any[] = [];
      const seen = new Set<string>();

      for (const model of this.getSharedModelCatalog()) {
        if (this.isLocalCatalogModel(model) && !seen.has(model.id)) {
          seen.add(model.id);
          models.push(model);
        }
      }

      for (const endpoint of this.getConfigEndpoints()) {
        for (const model of this.getEndpointModels(endpoint)) {
          if (this.isLocalCatalogModel(model) && !seen.has(model.id)) {
            seen.add(model.id);
            models.push(model);
          }
        }
      }

      return models;
    }

    getKnownHostedModelCatalog() {
      const models: any[] = [];
      const seen = new Set<string>();

      for (const endpoint of this.getConfigEndpoints()) {
        for (const model of this.getEndpointHostedModels(endpoint)) {
          if (this.isHostedCatalogModel(model) && !seen.has(model.modelRef)) {
            seen.add(model.modelRef);
            models.push(model);
          }
        }
      }

      for (const model of this.getSharedModelCatalog()) {
        if (this.isHostedCatalogModel(model) && !seen.has(model.modelRef)) {
          seen.add(model.modelRef);
          models.push(model);
        }
      }

      return models;
    }

    ensureSharedModelCatalog() {
      if (!Array.isArray(this.config?.modelCatalog)) {
        this.config.modelCatalog = [
          ...this.getKnownLocalModelCatalog().map((model: any) => this.cloneModelCatalogEntry(model)),
          ...this.getKnownHostedModelCatalog().map((model: any) => this.cloneModelCatalogEntry(model))
        ];
      }
      return this.config.modelCatalog;
    }

    getRemainingLocalModelIds(excludedModelId: string) {
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const model of this.getKnownLocalModelCatalog()) {
        const modelId = typeof model?.id === 'string' ? model.id.trim() : '';
        if (!modelId || modelId === excludedModelId || seen.has(modelId)) {
          continue;
        }
        seen.add(modelId);
        ids.push(modelId);
      }
      return ids;
    }

    getMutableManagedAgentsForModelEdits() {
      const agents: any[] = Array.isArray(this.config?.agents?.list) ? [...this.config.agents.list] : [];
      if (this.editingAgentDraft) {
        agents.push(this.editingAgentDraft);
      }
      return agents;
    }

    applyLocalModelRemovalToAgent(agent: any, removedModelRef: string, fallbackReplacementRef: string) {
      if (!agent || typeof agent !== 'object') {
        return { changed: false, becameModelLess: false };
      }

      const currentCandidates = Array.isArray(agent.candidateModelRefs)
        ? agent.candidateModelRefs.filter((ref: any) => typeof ref === 'string' && ref.length > 0)
        : [];
      const nextCandidates = currentCandidates.filter((ref: string) => ref !== removedModelRef);
      const nextModelRef = nextCandidates.find((ref: string) => typeof ref === 'string' && ref.length > 0) || fallbackReplacementRef;

      let changed = false;
      let becameModelLess = false;
      if (typeof agent.modelRef === 'string' && agent.modelRef === removedModelRef) {
        if (!nextModelRef) {
          agent.modelRef = '';
          changed = true;
          becameModelLess = true;
        } else {
          agent.modelRef = nextModelRef;
          changed = true;
        }
      }

      if (Array.isArray(agent.candidateModelRefs) && nextCandidates.length !== currentCandidates.length) {
        agent.candidateModelRefs = nextCandidates;
        changed = true;
      }

      if (changed) {
        this.syncAgentModelSource(agent);
      }

      return { changed, becameModelLess };
    }

    removeLocalCatalogModelFromConfig(idx: number, model: any) {
      const models = this.ensureSharedModelCatalog();
      const modelId = typeof model?.id === 'string' ? model.id.trim() : '';
      if (!modelId) {
        return false;
      }

      const removedModelRef = `ollama/${modelId}`;
      const remainingLocalIds = this.getRemainingLocalModelIds(modelId);
      const fallbackReplacementRef = remainingLocalIds.length > 0 ? `ollama/${remainingLocalIds[0]}` : '';
      const modelLessAgents = new Set<string>();

      for (const agent of this.getMutableManagedAgentsForModelEdits()) {
        const previewAgent = this.cloneValue(agent);
        const result = this.applyLocalModelRemovalToAgent(previewAgent, removedModelRef, fallbackReplacementRef);
        if (result.becameModelLess) {
          modelLessAgents.add(this.getAgentDisplayLabel(agent));
        }
      }

      if (modelLessAgents.size > 0) {
        const proceed = confirm(
          `Remove local model "${modelId}" even though it is the last local option for some agents?\n\nThese agents will become model-less: ${[...modelLessAgents].join(', ')}.\n\nYou can still save this change and assign new models later.`
        );
        if (!proceed) {
          return false;
        }
      }

      for (const agent of this.getMutableManagedAgentsForModelEdits()) {
        this.applyLocalModelRemovalToAgent(agent, removedModelRef, fallbackReplacementRef);
      }

      this.config.modelCatalog = models.filter((_: any, modelIdx: number) => modelIdx !== idx);
      if (Array.isArray(this.config?.ollama?.models)) {
        this.config.ollama.models = this.config.ollama.models.filter((entry: any) => String(entry?.id || '') !== modelId);
      }

      for (const endpoint of this.getConfigEndpoints()) {
        const runtime = this.getEndpointOllama(endpoint);
        if (runtime && Array.isArray(runtime.models)) {
          runtime.models = runtime.models.filter((entry: any) => String(entry?.id || '') !== modelId);
        }
      }

      this.requestUpdate();
      return true;
    }

    getOllamaModelCatalog() {
      return this.getKnownLocalModelCatalog();
    }

    isLocalModelRef(modelRef: string | undefined) {
      return typeof modelRef === 'string' && modelRef.startsWith('ollama/');
    }

    getEndpointModelOptions(endpoint: any) {
      const options: any[] = [];
      const seen = new Set<string>();

      for (const model of this.getEndpointModels(endpoint)) {
        const ref = `ollama/${model.id}`;
        if (!seen.has(ref)) {
          seen.add(ref);
          options.push({
            ref,
            label: model.id,
            kind: 'local'
          });
        }
      }

      for (const model of this.getEndpointHostedModels(endpoint)) {
        const ref = model.modelRef;
        if (typeof ref === 'string' && ref.length > 0 && !seen.has(ref)) {
          seen.add(ref);
          options.push({
            ref,
            label: ref,
            kind: 'hosted'
          });
        }
      }

      return options;
    }

    getAvailableFallbackModelIds(endpoint?: any) {
      if (endpoint) {
        return this.getEndpointModels(endpoint).map((model: any) => model.id);
      }
      return this.getKnownLocalModelCatalog().map((model: any) => model.id);
    }
  };
