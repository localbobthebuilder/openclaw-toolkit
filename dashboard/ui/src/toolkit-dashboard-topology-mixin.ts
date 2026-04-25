import { LitElement, html } from 'lit';
import {
  VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES,
  VALID_WORKSPACE_MARKDOWN_FILES
} from './toolkit-dashboard-constants';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTopologyMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTopologyMixin extends Base {
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

  sanitizeModelEntries(models: any[] | undefined) {
    if (!Array.isArray(models)) return [];
    return models.map((model: any) => {
      const clone = JSON.parse(JSON.stringify(model));
      delete clone.name;
      delete clone.vramEstimateMiB;
      this.normalizeParamsRecord(clone);
      this.setOrderedFallbackModelIds(clone, this.getOrderedFallbackModelIds(clone));
      return clone;
    });
  }

  sanitizeSharedCatalogEntries(models: any[] | undefined) {
    return this.sanitizeModelEntries(models).map((model: any) => {
      delete model.fallbackModelIds;
      return model;
    });
  }

  isReasoningCapableModel(model: any) {
    return this.normalizeBoolean(model?.reasoning, false);
  }

  getOrderedFallbackModelIds(model: any) {
    const fallbackIds: string[] = [];
    if (Array.isArray(model?.fallbackModelIds)) {
      for (const rawFallbackId of model.fallbackModelIds) {
        const fallbackId = String(rawFallbackId || '').trim();
        if (fallbackId && !fallbackIds.includes(fallbackId)) {
          fallbackIds.push(fallbackId);
        }
      }
    }
    return fallbackIds;
  }

  setOrderedFallbackModelIds(model: any, fallbackIds: string[]) {
    const normalized: string[] = [];
    const selfId = typeof model?.id === 'string' ? model.id.trim() : '';
    for (const rawFallbackId of Array.isArray(fallbackIds) ? fallbackIds : []) {
      const fallbackId = String(rawFallbackId || '').trim();
      if (!fallbackId || fallbackId === selfId || normalized.includes(fallbackId)) {
        continue;
      }
      normalized.push(fallbackId);
    }

    if (normalized.length > 0) {
      model.fallbackModelIds = normalized;
    } else {
      delete model.fallbackModelIds;
    }
    for (const key of Object.keys(model || {})) {
      if (key.startsWith('fallbackModel') && key !== 'fallbackModelIds') {
        delete model[key];
      }
    }
  }

  describeOrderedLocalFallbacks(model: any) {
    const fallbackIds = this.getOrderedFallbackModelIds(model);
    if (fallbackIds.length === 0) {
      return 'No local fallbacks';
    }
    return `Fallback order: ${fallbackIds.map((fallbackId: string) => `ollama/${fallbackId}`).join(' -> ')}`;
  }

  renderOrderedLocalFallbackEditor(model: any, availableModelIds: string[]) {
    const fallbackIds = this.getOrderedFallbackModelIds(model);
    const availableFallbackIds = availableModelIds.filter((fallbackId: string) => fallbackId !== String(model?.id || '') && !fallbackIds.includes(fallbackId));
    return html`
      <div class="form-group fallback-editor">
        <label>Ordered Local Fallbacks</label>
        <div class="help-text" style="margin-top: 0;">OpenClaw tries fallbacks top-to-bottom. The toolkit also uses this order when it needs to step down to a smaller local model.</div>
        ${fallbackIds.length > 0 ? html`
          <div class="fallback-list">
            ${fallbackIds.map((fallbackId: string, index: number) => html`
              <div class="fallback-row">
                <span class="fallback-label">${index + 1}. ollama/${fallbackId}</span>
                <span class="fallback-actions">
                  <button class="btn btn-ghost" style="padding: 4px 8px;" ?disabled=${index === 0} @click=${() => {
                    const nextFallbackIds = [...fallbackIds];
                    [nextFallbackIds[index - 1], nextFallbackIds[index]] = [nextFallbackIds[index], nextFallbackIds[index - 1]];
                    this.setOrderedFallbackModelIds(model, nextFallbackIds);
                    this.requestUpdate();
                  }}>Up</button>
                  <button class="btn btn-ghost" style="padding: 4px 8px;" ?disabled=${index === fallbackIds.length - 1} @click=${() => {
                    const nextFallbackIds = [...fallbackIds];
                    [nextFallbackIds[index], nextFallbackIds[index + 1]] = [nextFallbackIds[index + 1], nextFallbackIds[index]];
                    this.setOrderedFallbackModelIds(model, nextFallbackIds);
                    this.requestUpdate();
                  }}>Down</button>
                  <button class="btn btn-danger" style="padding: 4px 8px;" @click=${() => {
                    this.setOrderedFallbackModelIds(model, fallbackIds.filter((_: string, candidateIndex: number) => candidateIndex !== index));
                    this.requestUpdate();
                  }}>Remove</button>
                </span>
              </div>
            `)}
          </div>
        ` : html`<div class="item-sub" style="margin-top: 10px;">No local fallbacks configured.</div>`}
        ${availableFallbackIds.length > 0 ? html`
          <select class="fallback-select" @change=${(e: any) => {
            const value = String(e.target.value || '').trim();
            if (value) {
              this.setOrderedFallbackModelIds(model, [...fallbackIds, value]);
              this.requestUpdate();
            }
            e.target.value = '';
          }}>
            <option value="">+ Add fallback at the end</option>
            ${availableFallbackIds.map((fallbackId: string) => html`<option value=${fallbackId}>${fallbackId}</option>`)}
          </select>
        ` : ''}
      </div>
    `;
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

  addToolset() {
    const nextToolsets = [...this.getToolsetsList()];
    let counter = nextToolsets.length + 1;
    let key = `toolset-${counter}`;
    while (this.getToolsetByKey(key)) {
      counter += 1;
      key = `toolset-${counter}`;
    }
    nextToolsets.push(this.createToolsetRecord({ key, name: `Toolset ${counter}`, allow: [], deny: [] }));
    this.ensureToolsetsConfig(this.config);
    this.config.toolsets.list = nextToolsets;
    this.requestUpdate();
  }

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
