import { LitElement, html } from 'lit';
import {
  AVAILABLE_TOOL_OPTIONS,
  MINIMAL_CHAT_ONLY_ALLOW,
  MINIMAL_CHAT_ONLY_DENY,
  THINKING_LEVEL_OPTIONS,
  TOOL_CHOICE_OPTIONS,
  VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES,
  VALID_WORKSPACE_MARKDOWN_FILES
} from './toolkit-dashboard-constants';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardConfigMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardConfigMixin extends Base {
    [key: string]: any;

  normalizeBoolean(value: any, defaultValue: boolean) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
      if (!normalized.length) return defaultValue;
    }
    if (value == null) {
      return defaultValue;
    }
    return Boolean(value);
  }

  getModelNumberInputValue(value: any, fallbackValue?: number) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(Math.round(value));
    }
    if (typeof fallbackValue === 'number' && Number.isFinite(fallbackValue)) {
      return String(Math.round(fallbackValue));
    }
    return '';
  }

  updateModelNumericField(model: any, field: string, rawValue: any, options: { min?: number; fallbackValue?: number; deleteWhenBlank?: boolean } = {}) {
    const trimmed = String(rawValue ?? '').trim();
    if (!trimmed.length) {
      if (options.deleteWhenBlank) {
        delete model[field];
      }
      else if (typeof options.fallbackValue === 'number' && Number.isFinite(options.fallbackValue)) {
        model[field] = Math.round(options.fallbackValue);
      }
      this.requestUpdate();
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const minValue = typeof options.min === 'number' && Number.isFinite(options.min) ? options.min : 0;
    model[field] = Math.max(minValue, Math.round(parsed));
    this.requestUpdate();
  }

  normalizeThinkingDefault(value: any) {
    let normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    switch (normalized) {
      case 'x-high':
      case 'x_high':
      case 'extra-high':
      case 'extra high':
      case 'extra_high':
        normalized = 'xhigh';
        break;
      case 'highest':
      case 'max':
        normalized = 'high';
        break;
      default:
        break;
    }

    return THINKING_LEVEL_OPTIONS.includes(normalized as typeof THINKING_LEVEL_OPTIONS[number])
      ? normalized
      : 'high';
  }

  normalizeToolChoiceValue(value: any) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return TOOL_CHOICE_OPTIONS.includes(normalized as typeof TOOL_CHOICE_OPTIONS[number])
      ? normalized
      : '';
  }

  normalizeParamsRecord(target: any) {
    if (!target || typeof target !== 'object') {
      return null;
    }

    const source = target.params;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      delete target.params;
      return null;
    }

    const nextParams: Record<string, any> = JSON.parse(JSON.stringify(source));
    const normalizedToolChoice = this.normalizeToolChoiceValue(
      nextParams.toolChoice !== undefined ? nextParams.toolChoice : nextParams.tool_choice
    );
    delete nextParams.toolChoice;
    delete nextParams.tool_choice;
    if (normalizedToolChoice) {
      nextParams.toolChoice = normalizedToolChoice;
    }

    if (Object.keys(nextParams).length > 0) {
      target.params = nextParams;
      return nextParams;
    }

    delete target.params;
    return null;
  }

  getConfiguredToolChoice(target: any) {
    const params = this.normalizeParamsRecord(target);
    if (!params) {
      return '';
    }
    return this.normalizeToolChoiceValue(params.toolChoice);
  }

  setConfiguredToolChoice(target: any, value: any) {
    if (!target || typeof target !== 'object') {
      return;
    }
    const normalized = this.normalizeToolChoiceValue(value);
    const params = this.normalizeParamsRecord(target) || {};
    delete params.toolChoice;
    if (normalized) {
      params.toolChoice = normalized;
    }
    if (Object.keys(params).length > 0) {
      target.params = params;
    } else {
      delete target.params;
    }
    this.requestUpdate();
  }

  ensureSubagentsConfig(agent: any) {
    if (!agent.subagents || typeof agent.subagents !== 'object') {
      agent.subagents = {};
    }
    agent.subagents.enabled = this.normalizeBoolean(agent.subagents.enabled, true);
    agent.subagents.requireAgentId = this.normalizeBoolean(agent.subagents.requireAgentId, true);
    if (!Array.isArray(agent.subagents.allowAgents)) {
      agent.subagents.allowAgents = [];
    }
    return agent.subagents;
  }

  normalizeToolNameList(toolNames: any) {
    const values = Array.isArray(toolNames) ? toolNames : [];
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const rawToolName of values) {
      const toolName = String(rawToolName || '').trim();
      if (!toolName || seen.has(toolName)) {
        continue;
      }
      seen.add(toolName);
      normalized.push(toolName);
    }
    return normalized;
  }

  normalizeToolsetKey(value: any) {
    return typeof value === 'string' ? value.trim() : '';
  }

  mapLegacyToolProfileKey(profile: any) {
    const normalized = typeof profile === 'string' ? profile.trim().toLowerCase() : '';
    switch (normalized) {
      case 'research':
        return 'research';
      case 'review':
        return 'review';
      case 'codingdelegate':
        return 'codingDelegate';
      default:
        return '';
    }
  }

  createDefaultMinimalToolsetRecord(overrides?: { allow?: any; deny?: any }) {
    return this.createToolsetRecord({
      key: 'minimal',
      name: 'Minimal',
      allow: Array.isArray(overrides?.allow) && overrides!.allow.length > 0 ? overrides!.allow : MINIMAL_CHAT_ONLY_ALLOW,
      deny: Array.isArray(overrides?.deny) && overrides!.deny.length > 0 ? overrides!.deny : MINIMAL_CHAT_ONLY_DENY
    });
  }

  createToolsetRecord(toolset: any) {
    const key = this.normalizeToolsetKey(toolset?.key);
    return {
      key,
      name: typeof toolset?.name === 'string' && toolset.name.trim().length > 0 ? toolset.name.trim() : key,
      allow: this.normalizeToolNameList(toolset?.allow),
      deny: this.normalizeToolNameList(toolset?.deny)
    };
  }

  ensureAgentToolsetKeys(agent: any, config: any = this.config) {
    if (!agent || typeof agent !== 'object') {
      return [];
    }

    const availableToolsetKeys = new Set(
      Array.isArray(config?.toolsets?.list)
        ? config.toolsets.list.map((toolset: any) => this.normalizeToolsetKey(toolset?.key)).filter((key: string) => key.length > 0)
        : []
    );
    const toolsetKeys = this.normalizeToolNameList(agent.toolsetKeys).filter((key) => key !== 'minimal');
    if (toolsetKeys.length === 0) {
      const mappedKey = this.mapLegacyToolProfileKey(agent.toolProfile);
      if (mappedKey && availableToolsetKeys.has(mappedKey)) {
        toolsetKeys.push(mappedKey);
      }
    }

    agent.toolsetKeys = toolsetKeys;
    delete agent.toolProfile;
    return agent.toolsetKeys;
  }

  normalizeAgentToolOverrides(agent: any) {
    const source = agent?.toolOverrides && typeof agent.toolOverrides === 'object' ? agent.toolOverrides : null;
    if (!source) {
      return null;
    }

    const normalized = {
      allow: this.normalizeToolNameList(source.allow),
      deny: this.normalizeToolNameList(source.deny)
    };
    if (normalized.allow.length === 0 && normalized.deny.length === 0) {
      return null;
    }
    return normalized;
  }

  ensureAgentToolOverrides(agent: any) {
    const normalized = this.normalizeAgentToolOverrides(agent);
    if (normalized) {
      agent.toolOverrides = normalized;
      return agent.toolOverrides;
    }

    agent.toolOverrides = {
      allow: [],
      deny: []
    };
    return agent.toolOverrides;
  }

  pruneAgentToolOverrides(agent: any) {
    const normalized = this.normalizeAgentToolOverrides(agent);
    if (normalized) {
      agent.toolOverrides = normalized;
      return normalized;
    }

    delete agent.toolOverrides;
    return null;
  }

  ensureToolsetsConfig(config: any = this.config) {
    if (!config || typeof config !== 'object') {
      return { list: [] };
    }

    if (!config.toolsets || typeof config.toolsets !== 'object') {
      config.toolsets = { list: [] };
    }
    if (!Array.isArray(config.toolsets.list)) {
      config.toolsets.list = [];
    }

    const normalizedToolsets: any[] = [];
    const seenKeys = new Set<string>();
    for (const toolset of config.toolsets.list) {
      const normalized = this.createToolsetRecord(toolset);
      if (!normalized.key || seenKeys.has(normalized.key)) {
        continue;
      }
      seenKeys.add(normalized.key);
      normalizedToolsets.push(normalized);
    }

    const legacyGlobalAllow = this.normalizeToolNameList(config?.toolPolicy?.globalAlsoAllow ?? config?.toolPolicy?.globalAllow);
    const legacyGlobalDeny = this.normalizeToolNameList(config?.toolPolicy?.globalDeny);
    if (!seenKeys.has('minimal')) {
      normalizedToolsets.unshift(this.createDefaultMinimalToolsetRecord({
        allow: legacyGlobalAllow,
        deny: legacyGlobalDeny
      }));
      seenKeys.add('minimal');
    }

    const legacyResearchAllow = this.normalizeToolNameList(config?.toolPolicy?.researchAlsoAllow ?? config?.toolPolicy?.researchAllow);
    const legacyResearchDeny = this.normalizeToolNameList(config?.toolPolicy?.researchDeny);
    if ((legacyResearchAllow.length > 0 || legacyResearchDeny.length > 0) && !seenKeys.has('research')) {
      normalizedToolsets.push(this.createToolsetRecord({
        key: 'research',
        name: 'Research',
        allow: legacyResearchAllow,
        deny: legacyResearchDeny
      }));
      seenKeys.add('research');
    }

    config.toolsets.list = normalizedToolsets;
    if (Array.isArray(config?.agents?.list)) {
      config.agents.list.forEach((agent: any) => this.ensureAgentToolsetKeys(agent));
    }
    return config.toolsets;
  }

  getToolsetsList(config: any = this.config) {
    this.ensureToolsetsConfig(config);
    return Array.isArray(config?.toolsets?.list) ? config.toolsets.list : [];
  }

  getToolsetByKey(key: string, config: any = this.config) {
    const normalizedKey = this.normalizeToolsetKey(key);
    if (!normalizedKey) {
      return null;
    }
    return this.getToolsetsList(config).find((toolset: any) => toolset.key === normalizedKey) || null;
  }

  getToolOption(toolId: string) {
    return AVAILABLE_TOOL_OPTIONS.find((tool) => tool.id === toolId) || null;
  }

  getToolDisplayLabel(toolId: string) {
    const tool = this.getToolOption(toolId);
    if (!tool) {
      return toolId;
    }
    return tool.note ? `${tool.id} (${tool.note})` : tool.id;
  }

  renderToolLabel(toolId: string) {
    const tool = this.getToolOption(toolId);
    if (!tool) {
      return html`${toolId}`;
    }

    return html`
      <span class="tool-label">
        <span>${tool.id}</span>
        ${tool.note ? html`<span class="tool-note-badge">${tool.note}</span>` : ''}
      </span>
    `;
  }

  formatToolIdList(toolIds: string[], emptyLabel = 'none') {
    if (!toolIds.length) {
      return emptyLabel;
    }
    return toolIds.map((toolId) => this.getToolDisplayLabel(toolId)).join(', ');
  }

  getToolsetPreviewText(toolset: any) {
    const allow = this.normalizeToolNameList(toolset?.allow);
    const deny = this.normalizeToolNameList(toolset?.deny);
    if (allow.length === 0 && deny.length === 0) {
      return 'Allow: none | Deny: none';
    }
    return `Allow: ${this.formatToolIdList(allow)} | Deny: ${this.formatToolIdList(deny)}`;
  }

  getAgentAppliedToolsets(agent: any, config: any = this.config) {
    const applied: any[] = [];
    const seenKeys = new Set<string>();
    const minimal = this.getToolsetByKey('minimal', config);
    if (minimal) {
      applied.push(minimal);
      seenKeys.add('minimal');
    }

    for (const toolsetKey of this.ensureAgentToolsetKeys(agent)) {
      const toolset = this.getToolsetByKey(toolsetKey, config);
      if (!toolset || seenKeys.has(toolset.key)) {
        continue;
      }
      applied.push(toolset);
      seenKeys.add(toolset.key);
    }

    return applied;
  }

  getEffectiveAgentToolState(agent: any, config: any = this.config) {
    const appliedToolsets = this.getAgentAppliedToolsets(agent, config);
    const toolStates = new Map<string, 'allow' | 'deny'>();
    for (const toolset of appliedToolsets) {
      for (const toolId of this.normalizeToolNameList(toolset?.allow)) {
        toolStates.set(toolId, 'allow');
      }
      for (const toolId of this.normalizeToolNameList(toolset?.deny)) {
        toolStates.set(toolId, 'deny');
      }
    }

    const toolOverrides = this.normalizeAgentToolOverrides(agent);
    if (toolOverrides) {
      for (const toolId of this.normalizeToolNameList(toolOverrides.allow)) {
        toolStates.set(toolId, 'allow');
      }
      for (const toolId of this.normalizeToolNameList(toolOverrides.deny)) {
        toolStates.set(toolId, 'deny');
      }
    }

    const explicitTools = agent?.tools && typeof agent.tools === 'object' ? agent.tools : null;

    const knownToolIds = new Set<string>(AVAILABLE_TOOL_OPTIONS.map((tool) => tool.id));
    const allowedTools: string[] = [];
    const deniedTools: string[] = [];
    for (const tool of AVAILABLE_TOOL_OPTIONS) {
      const state = toolStates.get(tool.id);
      if (state === 'allow') {
        allowedTools.push(tool.id);
      } else if (state === 'deny') {
        deniedTools.push(tool.id);
      }
    }
    for (const [toolId, state] of toolStates.entries()) {
      if (knownToolIds.has(toolId)) {
        continue;
      }
      if (state === 'allow') {
        allowedTools.push(toolId);
      } else if (state === 'deny') {
        deniedTools.push(toolId);
      }
    }

    return { appliedToolsets, toolOverrides, allowedTools, deniedTools, explicitTools };
  }

  addToolToToolset(toolset: any, listName: 'allow' | 'deny', toolId: string) {
    const normalizedToolId = this.normalizeToolsetKey(toolId);
    if (!normalizedToolId) {
      return;
    }
    toolset.allow = this.normalizeToolNameList(toolset.allow);
    toolset.deny = this.normalizeToolNameList(toolset.deny);
    toolset.allow = toolset.allow.filter((candidate: string) => candidate !== normalizedToolId);
    toolset.deny = toolset.deny.filter((candidate: string) => candidate !== normalizedToolId);
    toolset[listName].push(normalizedToolId);
    this.requestUpdate();
  }

  removeToolFromToolset(toolset: any, listName: 'allow' | 'deny', toolId: string) {
    toolset[listName] = this.normalizeToolNameList(toolset[listName]).filter((candidate: string) => candidate !== toolId);
    this.requestUpdate();
  }

  addAgentToolset(agent: any, toolsetKey: string) {
    const normalizedKey = this.normalizeToolsetKey(toolsetKey);
    if (!normalizedKey || normalizedKey === 'minimal') {
      return;
    }
    const toolsetKeys = this.ensureAgentToolsetKeys(agent);
    if (!toolsetKeys.includes(normalizedKey)) {
      toolsetKeys.push(normalizedKey);
      this.requestUpdate();
    }
  }

  moveAgentToolset(agent: any, index: number, delta: number) {
    const toolsetKeys = this.ensureAgentToolsetKeys(agent);
    const nextIndex = index + delta;
    if (index < 0 || index >= toolsetKeys.length || nextIndex < 0 || nextIndex >= toolsetKeys.length) {
      return;
    }
    const [movedKey] = toolsetKeys.splice(index, 1);
    toolsetKeys.splice(nextIndex, 0, movedKey);
    this.requestUpdate();
  }

  addAgentToolOverride(agent: any, listName: 'allow' | 'deny', toolId: string) {
    const normalizedToolId = this.normalizeToolsetKey(toolId);
    if (!normalizedToolId) {
      return;
    }
    const toolOverrides = this.ensureAgentToolOverrides(agent);
    toolOverrides.allow = this.normalizeToolNameList(toolOverrides.allow).filter((candidate: string) => candidate !== normalizedToolId);
    toolOverrides.deny = this.normalizeToolNameList(toolOverrides.deny).filter((candidate: string) => candidate !== normalizedToolId);
    toolOverrides[listName].push(normalizedToolId);
    this.requestUpdate();
  }

  removeAgentToolOverride(agent: any, listName: 'allow' | 'deny', toolId: string) {
    const toolOverrides = this.ensureAgentToolOverrides(agent);
    toolOverrides[listName] = this.normalizeToolNameList(toolOverrides[listName]).filter((candidate: string) => candidate !== toolId);
    this.pruneAgentToolOverrides(agent);
    this.requestUpdate();
  }

  renameToolsetKey(toolset: any, rawNextKey: any) {
    const currentKey = this.normalizeToolsetKey(toolset?.key);
    const nextKey = this.normalizeToolsetKey(rawNextKey);
    if (!currentKey || !nextKey || currentKey === 'minimal') {
      return;
    }
    if (currentKey === nextKey) {
      toolset.key = nextKey;
      return;
    }
    const existing = this.getToolsetByKey(nextKey);
    if (existing && existing !== toolset) {
      alert(`Toolset key "${nextKey}" is already in use.`);
      return;
    }

    toolset.key = nextKey;
    for (const agent of Array.isArray(this.config?.agents?.list) ? this.config.agents.list : []) {
      const toolsetKeys = this.ensureAgentToolsetKeys(agent);
      const index = toolsetKeys.indexOf(currentKey);
      if (index >= 0) {
        toolsetKeys[index] = nextKey;
      }
      agent.toolsetKeys = this.normalizeToolNameList(toolsetKeys);
    }
    this.requestUpdate();
  }

  removeToolset(toolsetKey: string) {
    const normalizedKey = this.normalizeToolsetKey(toolsetKey);
    if (!normalizedKey || normalizedKey === 'minimal') {
      return;
    }
    const toolsets = this.getToolsetsList();
    this.config.toolsets.list = toolsets.filter((toolset: any) => toolset.key !== normalizedKey);
    for (const agent of Array.isArray(this.config?.agents?.list) ? this.config.agents.list : []) {
      agent.toolsetKeys = this.ensureAgentToolsetKeys(agent).filter((candidate: string) => candidate !== normalizedKey);
    }
    this.requestUpdate();
  }

  normalizeTelegramGroupRecord(group: any) {
    const normalized = JSON.parse(JSON.stringify(group || {}));
    normalized.enabled = this.normalizeBoolean(normalized.enabled, true);
    normalized.requireMention = this.normalizeBoolean(normalized.requireMention, true);
    if (!Array.isArray(normalized.allowFrom)) {
      normalized.allowFrom = [];
    }
    return normalized;
  }

  normalizeWorkspaceRecord(workspace: any) {
    const normalized = JSON.parse(JSON.stringify(workspace || {}));
    normalized.mode = normalized.mode === 'private' ? 'private' : 'shared';
    normalized.enableAgentToAgent = this.normalizeBoolean(normalized.enableAgentToAgent, false);
    normalized.manageWorkspaceAgentsMd = this.normalizeBoolean(normalized.manageWorkspaceAgentsMd, false);
    normalized.markdownTemplateKeys = this.normalizeMarkdownTemplateSelections(normalized, VALID_WORKSPACE_MARKDOWN_FILES);
    if (!Array.isArray(normalized.agents)) {
      normalized.agents = [];
    }
    normalized.agents = normalized.agents
      .map((agentId: any) => String(agentId || '').trim())
      .filter((agentId: string) => agentId.length > 0);
    if (normalized.mode === 'private') {
      if (!Array.isArray(normalized.sharedWorkspaceIds)) {
        normalized.sharedWorkspaceIds = [];
      }
      normalized.sharedWorkspaceIds = normalized.sharedWorkspaceIds
        .map((workspaceId: any) => String(workspaceId || '').trim())
        .filter((workspaceId: string) => workspaceId.length > 0);
    } else {
      normalized.sharedWorkspaceIds = [];
    }
    delete normalized.rolePolicyKey;
    delete normalized.allowSharedWorkspaceAccess;
    return normalized;
  }

  normalizeEndpointRecord(endpoint: any) {
    const normalized = JSON.parse(JSON.stringify(endpoint || {}));
    normalized.default = this.normalizeBoolean(normalized.default, false);
    if (!Array.isArray(normalized.hostedModels)) {
      normalized.hostedModels = [];
    }
    if (!Array.isArray(normalized.agents)) {
      normalized.agents = [];
    }
    normalized.agents = normalized.agents
      .map((agentId: any) => String(agentId || '').trim())
      .filter((agentId: string) => agentId.length > 0);
    return normalized;
  }

  getConfigEndpointsFrom(config: any) {
    if (Array.isArray(config?.endpoints)) {
      return config.endpoints;
    }
    return [];
  }

  getEndpointAgentIds(endpoint: any) {
    if (!endpoint || typeof endpoint !== 'object') {
      return [];
    }
    if (!Array.isArray(endpoint.agents)) {
      endpoint.agents = [];
    }
    endpoint.agents = endpoint.agents
      .map((agentId: any) => String(agentId || '').trim())
      .filter((agentId: string) => agentId.length > 0);
    return endpoint.agents;
  }

  normalizeEndpointAgentAssignments(config: any) {
    const endpoints = this.getConfigEndpointsFrom(config).map((endpoint: any) => this.normalizeEndpointRecord(endpoint));
    if (Array.isArray(config?.endpoints)) {
      config.endpoints = endpoints;
    }

    const agents = Array.isArray(config?.agents?.list) ? config.agents.list : [];
    const validAgentIds = new Set(
      agents
        .map((agent: any) => String(agent?.id || '').trim())
        .filter((agentId: string) => agentId.length > 0)
    );

    const assignedAgentIds = new Set<string>();
    for (const endpoint of endpoints) {
      const cleanedAgentIds: string[] = [];
      for (const agentId of this.getEndpointAgentIds(endpoint)) {
        if (!validAgentIds.has(agentId) || assignedAgentIds.has(agentId)) {
          continue;
        }
        cleanedAgentIds.push(agentId);
        assignedAgentIds.add(agentId);
      }
      endpoint.agents = cleanedAgentIds;
    }

    for (const agent of agents) {
      delete agent.endpointKey;
    }

    return config;
  }

  getEmptyTemplateState() {
    return {
      agents: {},
      workspaces: {},
      libraries: {
        agents: {},
        workspaces: {}
      }
    };
  }

  cloneTemplateState(templates: any) {
    const base = templates && typeof templates === 'object' ? templates : this.getEmptyTemplateState();
    const clone = JSON.parse(JSON.stringify(base));
    if (!clone.agents || typeof clone.agents !== 'object') clone.agents = {};
    if (!clone.workspaces || typeof clone.workspaces !== 'object') clone.workspaces = {};
    if (!clone.libraries || typeof clone.libraries !== 'object') {
      clone.libraries = { agents: {}, workspaces: {} };
    }
    if (!clone.libraries.agents || typeof clone.libraries.agents !== 'object') clone.libraries.agents = {};
    if (!clone.libraries.workspaces || typeof clone.libraries.workspaces !== 'object') clone.libraries.workspaces = {};
    return clone;
  }

  normalizeMarkdownTemplateSelections(record: any, validFileNames: readonly string[]) {
    if (!record || typeof record !== 'object') {
      return {};
    }
    if (!record.markdownTemplateKeys || typeof record.markdownTemplateKeys !== 'object') {
      record.markdownTemplateKeys = {};
    }
    const normalized: Record<string, string> = {};
    for (const fileName of validFileNames) {
      const key = typeof record.markdownTemplateKeys[fileName] === 'string'
        ? record.markdownTemplateKeys[fileName].trim()
        : '';
      if (key) {
        normalized[fileName] = key;
      }
    }
    record.markdownTemplateKeys = normalized;
    return normalized;
  }

  getMarkdownTemplateSelection(record: any, fileName: string, validFileNames: readonly string[]) {
    const selections = this.normalizeMarkdownTemplateSelections(record, validFileNames);
    return typeof selections[fileName] === 'string' ? selections[fileName] : '';
  }

  setMarkdownTemplateSelection(record: any, fileName: string, templateKey: string | null, validFileNames: readonly string[]) {
    const selections = this.normalizeMarkdownTemplateSelections(record, validFileNames);
    const normalizedKey = typeof templateKey === 'string' ? templateKey.trim() : '';
    if (normalizedKey) {
      selections[fileName] = normalizedKey;
    } else {
      delete selections[fileName];
    }
    record.markdownTemplateKeys = selections;
  }

  ensureTemplateLibrariesRoot() {
    if (!this.templateFiles?.libraries || typeof this.templateFiles.libraries !== 'object') {
      this.templateFiles = this.cloneTemplateState(this.templateFiles);
    }
    if (!this.templateFiles.libraries.agents || typeof this.templateFiles.libraries.agents !== 'object') {
      this.templateFiles.libraries.agents = {};
    }
    if (!this.templateFiles.libraries.workspaces || typeof this.templateFiles.libraries.workspaces !== 'object') {
      this.templateFiles.libraries.workspaces = {};
    }
    return this.templateFiles.libraries;
  }

  ensureMarkdownTemplateLibrary(scope: 'agents' | 'workspaces', fileName: string) {
    const libraries = this.ensureTemplateLibrariesRoot();
    if (!libraries[scope][fileName] || typeof libraries[scope][fileName] !== 'object') {
      libraries[scope][fileName] = {};
    }
    return libraries[scope][fileName];
  }

  getMarkdownTemplateKeys(scope: 'agents' | 'workspaces', fileName: string) {
    return Object.keys(this.ensureMarkdownTemplateLibrary(scope, fileName)).sort((left, right) => left.localeCompare(right));
  }

  getMarkdownTemplateContent(scope: 'agents' | 'workspaces', fileName: string, templateKey: string | null | undefined) {
    const normalizedKey = typeof templateKey === 'string' ? templateKey.trim() : '';
    if (!normalizedKey) {
      return '';
    }
    const library = this.ensureMarkdownTemplateLibrary(scope, fileName);
    return typeof library[normalizedKey] === 'string' ? library[normalizedKey] : '';
  }

  getSelectedTemplateMarkdownFile() {
    return this.markdownTemplateScope === 'agents'
      ? this.markdownTemplateAgentFile
      : this.markdownTemplateWorkspaceFile;
  }

  setSelectedTemplateMarkdownFile(fileName: string) {
    if (this.markdownTemplateScope === 'agents') {
      this.markdownTemplateAgentFile = fileName;
    } else {
      this.markdownTemplateWorkspaceFile = fileName;
    }
  }

  getMarkdownTemplateFileOptions(scope: 'agents' | 'workspaces') {
    return scope === 'agents' ? [...VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES] : [...VALID_WORKSPACE_MARKDOWN_FILES];
  }

  clearMarkdownTemplateSelectionMatches(scope: 'agents' | 'workspaces', fileName: string, templateKey: string) {
    const validFileNames = scope === 'agents' ? VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES : VALID_WORKSPACE_MARKDOWN_FILES;
    const collection = scope === 'agents'
      ? (Array.isArray(this.config?.agents?.list) ? this.config.agents.list : [])
      : (Array.isArray(this.config?.workspaces) ? this.config.workspaces : []);

    for (const record of collection) {
      if (this.getMarkdownTemplateSelection(record, fileName, validFileNames) === templateKey) {
        this.setMarkdownTemplateSelection(record, fileName, null, validFileNames);
      }
    }

    if (scope === 'agents' && this.editingAgentDraft && this.getMarkdownTemplateSelection(this.editingAgentDraft, fileName, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES) === templateKey) {
      this.setMarkdownTemplateSelection(this.editingAgentDraft, fileName, null, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
    }
  }

  addMarkdownTemplate(scope: 'agents' | 'workspaces', fileName: string) {
    const key = prompt(`New ${scope === 'agents' ? 'agent' : 'workspace'} ${fileName} template key:`);
    const normalizedKey = typeof key === 'string' ? key.trim() : '';
    if (!normalizedKey) {
      return;
    }
    const library = this.ensureMarkdownTemplateLibrary(scope, fileName);
    if (library[normalizedKey]) {
      alert(`Template "${normalizedKey}" already exists for ${fileName}.`);
      return;
    }
    library[normalizedKey] = '';
    this.requestUpdate();
  }

  removeMarkdownTemplate(scope: 'agents' | 'workspaces', fileName: string, templateKey: string) {
    if (!confirm(`Delete template "${templateKey}" from ${fileName}?`)) {
      return;
    }
    const library = this.ensureMarkdownTemplateLibrary(scope, fileName);
    delete library[templateKey];
    this.clearMarkdownTemplateSelectionMatches(scope, fileName, templateKey);
    this.requestUpdate();
  }

  getTelegramRoutingRoot() {
    if (!this.config?.agents || typeof this.config.agents !== 'object') {
      this.config.agents = { telegramRouting: {}, list: [] };
    }
    if (!this.config.agents.telegramRouting || typeof this.config.agents.telegramRouting !== 'object') {
      this.config.agents.telegramRouting = {};
    }
    return this.config.agents.telegramRouting;
  }

  buildTemplateGuidance(lines: string[]) {
    return lines.join('\n').trimEnd();
  }

  buildDefaultAgentBootstrapFile(_agent: any, fileName: string) {
    switch (fileName) {
      case 'AGENTS.md':
        return '';
      case 'TOOLS.md':
        return '';
      case 'SOUL.md':
        return '';
      case 'IDENTITY.md':
        return '';
      case 'USER.md':
        return '';
      case 'HEARTBEAT.md':
        return '';
      case 'MEMORY.md':
        return '';
      default:
        return '';
    }
  }

  buildAgentBootstrapPlaceholder(agent: any, fileName: string) {
    const agentName = agent?.name || agent?.id || 'Agent';
    const agentId = agent?.id || 'agent';
    switch (fileName) {
      case 'AGENTS.md':
        return this.buildTemplateGuidance([
          `# AGENTS.md - ${agentName}`,
          '',
          '## Role',
          `- Add runtime instructions for ${agentName} (${agentId}) here.`
        ]);
      case 'TOOLS.md':
        return this.buildTemplateGuidance([
          `# TOOLS.md - ${agentName}`,
          '',
          `Add tool-use guidance for ${agentName} here.`
        ]);
      case 'SOUL.md':
        return this.buildTemplateGuidance([
          `# SOUL.md - ${agentName}`,
          '',
          `Add style, tone, and operating principles for ${agentName} here.`
        ]);
      case 'IDENTITY.md':
        return this.buildTemplateGuidance([
          `# IDENTITY.md - ${agentName}`,
          '',
          `Describe ${agentName}'s identity, scope, and responsibilities here.`
        ]);
      case 'USER.md':
        return this.buildTemplateGuidance([
          `# USER.md - ${agentName}`,
          '',
          `Add user-specific reminders or preferences for ${agentName} here.`
        ]);
      case 'HEARTBEAT.md':
        return this.buildTemplateGuidance([
          `# HEARTBEAT.md - ${agentName}`,
          '',
          '- Add a tiny checklist for heartbeat runs.',
          '- Keep it short so recurring checks do not burn unnecessary tokens.'
        ]);
      case 'MEMORY.md':
        return this.buildTemplateGuidance([
          `# MEMORY.md - ${agentName}`,
          '',
          `Optional curated long-term memory for ${agentName}'s normal sessions.`,
          'OpenClaw does not seed this file on first run; create it only if you want durable memory up front.',
          'The memory system may also create or update it later through promotion flows.'
        ]);
      default:
        return '';
    }
  }

  buildDefaultWorkspaceAgentsFile() {
    return '';
  }

  buildDefaultWorkspaceBootstrapFile(_workspace: any, fileName: string) {
    switch (fileName) {
      case 'AGENTS.md':
        return this.buildDefaultWorkspaceAgentsFile();
      case 'TOOLS.md':
        return '';
      case 'SOUL.md':
        return '';
      case 'IDENTITY.md':
        return '';
      case 'USER.md':
        return '';
      case 'HEARTBEAT.md':
        return '';
      case 'MEMORY.md':
        return '';
      case 'BOOTSTRAP.md':
        return '';
      case 'BOOT.md':
        return '';
      default:
        return '';
    }
  }

  buildWorkspaceBootstrapPlaceholder(workspace: any, fileName: string) {
    const workspaceName = workspace?.name || workspace?.id || 'Workspace';
    const workspaceAgents = Array.isArray(workspace?.agents) ? workspace.agents.join(', ') : '';
    switch (fileName) {
      case 'AGENTS.md':
        if (workspace?.mode === 'shared') {
          return this.buildTemplateGuidance([
            `# AGENTS.md - ${workspaceName}`,
            '',
            '## Workspace Role',
            '- This is the shared collaboration workspace.',
            '- Keep collaborative repos, durable notes, and handoff artifacts here.',
            '- Agent-specific bootstrap files are injected separately from each agent bootstrap folder.'
          ]);
        }
        return this.buildTemplateGuidance([
          `# AGENTS.md - ${workspaceName}`,
          '',
          '## Workspace Role',
          `- This is a private workspace for ${workspaceAgents || 'one agent'}.`,
          '- Keep drafts, scratch work, and agent-specific notes here.',
          '- Agent-specific bootstrap files are injected separately from each agent bootstrap folder.'
        ]);
      case 'TOOLS.md':
        return this.buildTemplateGuidance([
          `# TOOLS.md - ${workspaceName}`,
          '',
          `Add workspace-level tool guidance for ${workspaceName} here.`
        ]);
      case 'SOUL.md':
        return this.buildTemplateGuidance([
          `# SOUL.md - ${workspaceName}`,
          '',
          `Add shared tone, culture, and collaboration principles for ${workspaceName} here.`
        ]);
      case 'IDENTITY.md':
        return this.buildTemplateGuidance([
          `# IDENTITY.md - ${workspaceName}`,
          '',
          'Describe what this workspace is for and how it should be used.'
        ]);
      case 'USER.md':
        return this.buildTemplateGuidance([
          `# USER.md - ${workspaceName}`,
          '',
          'Add workspace-specific user reminders, conventions, or handoff notes here.'
        ]);
      case 'HEARTBEAT.md':
        return this.buildTemplateGuidance([
          `# HEARTBEAT.md - ${workspaceName}`,
          '',
          '- Add a tiny recurring checklist for heartbeat runs in this workspace.',
          '- Keep it short and focused.'
        ]);
      case 'MEMORY.md':
        return this.buildTemplateGuidance([
          `# MEMORY.md - ${workspaceName}`,
          '',
          'Optional curated long-term memory for normal sessions in this workspace.',
          'OpenClaw does not seed this file on first run; create it only if you want durable memory up front.',
          'The memory system may also create or update it later through promotion flows.'
        ]);
      case 'BOOTSTRAP.md':
        return this.buildTemplateGuidance([
          `# BOOTSTRAP.md - ${workspaceName}`,
          '',
          '## First Run Ritual',
          '- Use this only for a brand-new workspace.',
          '- Capture one-time setup steps, identity questions, or initial conventions here.',
          '- Delete it from the live workspace after the ritual is complete.'
        ]);
      case 'BOOT.md':
        return this.buildTemplateGuidance([
          `# BOOT.md - ${workspaceName}`,
          '',
          '## Startup Checklist',
          '- Add short, explicit instructions that should run when the gateway starts.',
          '- Keep it brief.',
          '- If a task needs to send a message, the boot-md hook should send it and then exit silently.'
        ]);
      default:
        return '';
    }
  }

  getMarkdownFileHelpText(fileName: string, scope: 'agent' | 'workspace') {
    switch (fileName) {
      case 'AGENTS.md':
        return scope === 'agent'
          ? 'Always-loaded operating instructions for this agent overlay.'
          : 'Always-loaded operating instructions for this workspace.';
      case 'TOOLS.md':
        return 'Guidance about tool use and local conventions. This does not grant capabilities by itself.';
      case 'SOUL.md':
        return 'Persona, tone, and operating style loaded into normal sessions.';
      case 'IDENTITY.md':
        return 'Identity, role, and self-description for the agent or workspace.';
      case 'USER.md':
        return 'User preferences, reminders, and relationship context.';
      case 'HEARTBEAT.md':
        return 'Optional tiny checklist for heartbeat runs. Keep it short to avoid token burn.';
      case 'MEMORY.md':
        return 'Optional durable memory. OpenClaw does not seed it automatically; memory promotion may create or update it later.';
      case 'BOOTSTRAP.md':
        return 'One-time first-run ritual for a brand-new workspace. The toolkit seeds it once and does not recreate it after the live file is deleted.';
      case 'BOOT.md':
        return 'Optional startup checklist run by the boot-md hook when the gateway starts.';
      default:
        return '';
    }
  }

  getMarkdownEditorRows(fileName: string) {
    switch (fileName) {
      case 'AGENTS.md':
        return 10;
      case 'BOOTSTRAP.md':
      case 'BOOT.md':
      case 'MEMORY.md':
        return 8;
      default:
        return 6;
    }
  }

  ensureAgentTemplateFiles(agent: any) {
    const agentId = typeof agent?.id === 'string' ? agent.id.trim() : '';
    if (!agentId) {
      return {};
    }
    if (!this.templateFiles?.agents || typeof this.templateFiles.agents !== 'object') {
      this.templateFiles = this.cloneTemplateState(this.templateFiles);
    }
    if (!this.templateFiles.agents[agentId] || typeof this.templateFiles.agents[agentId] !== 'object') {
      this.templateFiles.agents[agentId] = {};
    }
    for (const fileName of VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES) {
      if (typeof this.templateFiles.agents[agentId][fileName] !== 'string') {
        this.templateFiles.agents[agentId][fileName] = this.buildDefaultAgentBootstrapFile(agent, fileName);
      }
    }
    return this.templateFiles.agents[agentId];
  }

  ensureWorkspaceTemplateFiles(workspace: any) {
    const workspaceId = typeof workspace?.id === 'string' ? workspace.id.trim() : '';
    if (!workspaceId) {
      return {};
    }
    if (!this.templateFiles?.workspaces || typeof this.templateFiles.workspaces !== 'object') {
      this.templateFiles = this.cloneTemplateState(this.templateFiles);
    }
    if (!this.templateFiles.workspaces[workspaceId] || typeof this.templateFiles.workspaces[workspaceId] !== 'object') {
      this.templateFiles.workspaces[workspaceId] = {};
    }
    for (const fileName of VALID_WORKSPACE_MARKDOWN_FILES) {
      if (typeof this.templateFiles.workspaces[workspaceId][fileName] !== 'string') {
        this.templateFiles.workspaces[workspaceId][fileName] = this.buildDefaultWorkspaceBootstrapFile(workspace, fileName);
      }
    }
    return this.templateFiles.workspaces[workspaceId];
  }

  ensureAllTemplateFiles(sourceConfig: any = this.config) {
    for (const { agent } of this.getManagedAgentEntries()) {
      this.ensureAgentTemplateFiles(agent);
    }
    for (const workspace of Array.isArray(sourceConfig?.workspaces) ? sourceConfig.workspaces : []) {
      this.ensureWorkspaceTemplateFiles(workspace);
    }
  }

  cloneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  buildAgentTemplateDraft(agent: any, existingTemplates?: any) {
    const templates = existingTemplates && typeof existingTemplates === 'object'
      ? this.cloneValue(existingTemplates)
      : {};
    for (const fileName of VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES) {
      if (typeof templates[fileName] !== 'string') {
        templates[fileName] = this.buildDefaultAgentBootstrapFile(agent, fileName);
      }
    }
    return templates;
  }

  ensureEditingAgentTemplateFiles() {
    if (!this.editingAgentDraft) {
      return {};
    }
    if (!this.editingAgentTemplateDraft || typeof this.editingAgentTemplateDraft !== 'object') {
      this.editingAgentTemplateDraft = this.buildAgentTemplateDraft(this.editingAgentDraft);
    }
    for (const fileName of VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES) {
      if (typeof this.editingAgentTemplateDraft[fileName] !== 'string') {
        this.editingAgentTemplateDraft[fileName] = this.buildDefaultAgentBootstrapFile(this.editingAgentDraft, fileName);
      }
    }
    return this.editingAgentTemplateDraft;
  }

  setEditingAgentDraft(key: string, agent: any, templateFiles?: any) {
    const primaryWorkspace = this.getWorkspaceForAgentId(agent?.id);
    this.editingAgentKey = key;
    this.editingAgentDraft = this.cloneValue(agent);
    this.editingAgentTemplateDraft = this.buildAgentTemplateDraft(this.editingAgentDraft, templateFiles);
    this.editingAgentInitialDraft = this.cloneValue(this.editingAgentDraft);
    this.editingAgentInitialTemplateDraft = this.cloneValue(this.editingAgentTemplateDraft);
    this.editingAgentWorkspaceId = primaryWorkspace?.id || null;
    this.editingAgentInitialWorkspaceId = primaryWorkspace?.id || null;
  }

  clearEditingAgentDraft() {
    this.editingAgentKey = null;
    this.editingAgentDraft = null;
    this.editingAgentTemplateDraft = null;
    this.editingAgentInitialDraft = null;
    this.editingAgentInitialTemplateDraft = null;
    this.editingAgentWorkspaceId = null;
    this.editingAgentInitialWorkspaceId = null;
  }

  startEditingAgent(key: string) {
    const entry = this.getManagedAgentEntries().find((candidate: any) => candidate.key === key);
    if (!entry?.agent) {
      return;
    }
    this.setEditingAgentDraft(key, entry.agent, this.ensureAgentTemplateFiles(entry.agent));
  }

  startNewAgentDraft() {
    const draftKey = `draft:agent:${Date.now()}`;
    const newAgent = {
      enabled: true,
      id: 'new-agent-' + Date.now(),
      name: 'New Agent',
      thinkingDefault: 'high',
      toolsetKeys: [],
      markdownTemplateKeys: {},
      sandboxMode: 'off',
      modelRef: 'ollama/qwen2.5-coder:3b',
      candidateModelRefs: [],
      subagents: {
        enabled: true,
        requireAgentId: true,
        allowAgents: []
      }
    };
    this.setEditingAgentDraft(draftKey, newAgent);
  }

  isEditingAgentDirty() {
    if (!this.editingAgentDraft) {
      return false;
    }
    return JSON.stringify(this.editingAgentDraft) !== JSON.stringify(this.editingAgentInitialDraft) ||
      JSON.stringify(this.ensureEditingAgentTemplateFiles()) !== JSON.stringify(this.editingAgentInitialTemplateDraft) ||
      this.editingAgentWorkspaceId !== this.editingAgentInitialWorkspaceId;
  }

  closeEditingAgentEditor() {
    if (this.isEditingAgentDirty() && !confirm('Discard unsaved changes for this agent?')) {
      return;
    }
    this.clearEditingAgentDraft();
  }

  applyEditingAgentDraftToState() {
    if (!this.editingAgentDraft || !this.editingAgentKey) {
      return '';
    }

    if (!this.config.agents || typeof this.config.agents !== 'object') {
      this.config.agents = { telegramRouting: {}, list: [] };
    }
    if (!Array.isArray(this.config.agents.list)) {
      this.config.agents.list = [];
    }

    const draftAgent = this.cloneValue(this.editingAgentDraft);
    const draftTemplates = this.cloneValue(this.ensureEditingAgentTemplateFiles());
    const selectedWorkspaceId = this.editingAgentWorkspaceId;
    const existingIndex = this.config.agents.list.findIndex((candidate: any, idx: number) => {
      const candidateKey = typeof candidate?.key === 'string' && candidate.key.trim().length > 0 ? candidate.key : `agent:${idx}`;
      return candidateKey === this.editingAgentKey;
    });

    if (existingIndex >= 0) {
      const existingAgent = this.config.agents.list[existingIndex];
      const previousAgentId = this.normalizeAgentId(existingAgent?.id);
      const nextAgentId = this.normalizeAgentId(draftAgent.id);
      if (previousAgentId && nextAgentId && previousAgentId !== nextAgentId) {
        this.renameAgentIdEverywhere(previousAgentId, nextAgentId);
      }
      if (typeof existingAgent?.key === 'string' && existingAgent.key.trim().length > 0) {
        draftAgent.key = existingAgent.key;
      }
      this.config.agents.list[existingIndex] = draftAgent;
    } else {
      delete draftAgent.key;
      this.config.agents.list.push(draftAgent);
    }

    if (!this.templateFiles?.agents || typeof this.templateFiles.agents !== 'object') {
      this.templateFiles = this.cloneTemplateState(this.templateFiles);
    }
    this.templateFiles.agents[this.normalizeAgentId(draftAgent.id)] = draftTemplates;

    const shouldApplyWorkspaceSelection = existingIndex < 0
      ? !!selectedWorkspaceId
      : selectedWorkspaceId !== this.editingAgentInitialWorkspaceId;
    if (shouldApplyWorkspaceSelection) {
      this.setAgentPrimaryWorkspace(this.normalizeAgentId(draftAgent.id), selectedWorkspaceId);
    }

    return this.normalizeAgentId(draftAgent.id);
  }

  renameAgentIdEverywhere(oldId: string, newId: string) {
    const normalizedOldId = typeof oldId === 'string' ? oldId.trim() : '';
    const normalizedNewId = typeof newId === 'string' ? newId.trim() : '';
    if (!normalizedOldId || !normalizedNewId || normalizedOldId === normalizedNewId) {
      return;
    }

    if (this.templateFiles?.agents?.[normalizedOldId] && !this.templateFiles.agents[normalizedNewId]) {
      this.templateFiles.agents[normalizedNewId] = this.templateFiles.agents[normalizedOldId];
    }
    if (this.templateFiles?.agents && this.templateFiles.agents[normalizedOldId]) {
      delete this.templateFiles.agents[normalizedOldId];
    }

    for (const { agent } of this.getManagedAgentEntries()) {
      const subagents = this.ensureSubagentsConfig(agent);
      subagents.allowAgents = subagents.allowAgents.map((candidateId: string) => candidateId === normalizedOldId ? normalizedNewId : candidateId);
    }

    for (const workspace of Array.isArray(this.config?.workspaces) ? this.config.workspaces : []) {
      if (Array.isArray(workspace?.agents)) {
        workspace.agents = workspace.agents.map((agentId: string) => agentId === normalizedOldId ? normalizedNewId : agentId);
      }
    }

    for (const endpoint of this.getConfigEndpoints()) {
      endpoint.agents = this.getEndpointAgentIds(endpoint).map((agentId: string) => agentId === normalizedOldId ? normalizedNewId : agentId);
    }

    const telegramRouting = this.ensureTelegramRoutingConfig();
    if (telegramRouting) {
      telegramRouting.routes = this.getTelegramRouteList().map((route: any) => {
        if (String(route?.targetAgentId || '') === normalizedOldId) {
          route.targetAgentId = normalizedNewId;
        }
        return route;
      });
    }

    if (this.topologyLinkSourceAgentId === normalizedOldId) {
      this.topologyLinkSourceAgentId = normalizedNewId;
    }
  }

  renameWorkspaceIdEverywhere(oldId: string, newId: string) {
    const normalizedOldId = typeof oldId === 'string' ? oldId.trim() : '';
    const normalizedNewId = typeof newId === 'string' ? newId.trim() : '';
    if (!normalizedOldId || !normalizedNewId || normalizedOldId === normalizedNewId) {
      return;
    }

    if (this.templateFiles?.workspaces?.[normalizedOldId] && !this.templateFiles.workspaces[normalizedNewId]) {
      this.templateFiles.workspaces[normalizedNewId] = this.templateFiles.workspaces[normalizedOldId];
    }
    if (this.templateFiles?.workspaces && this.templateFiles.workspaces[normalizedOldId]) {
      delete this.templateFiles.workspaces[normalizedOldId];
    }

    for (const workspace of Array.isArray(this.config?.workspaces) ? this.config.workspaces : []) {
      if (Array.isArray(workspace?.sharedWorkspaceIds)) {
        workspace.sharedWorkspaceIds = workspace.sharedWorkspaceIds.map((workspaceId: string) =>
          workspaceId === normalizedOldId ? normalizedNewId : workspaceId
        );
      }
    }

    if (this.editingWorkspaceId === normalizedOldId) {
      this.editingWorkspaceId = normalizedNewId;
    }
  }

  normalizeWorkspaceAssignments(config: any = this.config) {
    if (!Array.isArray(config?.workspaces)) {
      config.workspaces = [];
    }

    config.workspaces = config.workspaces.map((workspace: any) => this.normalizeWorkspaceRecord(workspace));
    const validAgentIds = new Set(
      (Array.isArray(config?.agents?.list) ? config.agents.list : [])
        .map((agent: any) => String(agent?.id || '').trim())
        .filter((agentId: string) => agentId.length > 0)
    );
    const sharedWorkspaceIds = config.workspaces
      .filter((workspace: any) => workspace?.mode === 'shared')
      .map((workspace: any) => String(workspace?.id || '').trim())
      .filter((workspaceId: string) => workspaceId.length > 0);

    const assignedAgentIds = new Set<string>();
    for (const workspace of config.workspaces) {
      const cleanedAgentIds: string[] = [];
      for (const agentId of Array.isArray(workspace?.agents) ? workspace.agents : []) {
        const normalizedAgentId = String(agentId || '').trim();
        if (!normalizedAgentId || !validAgentIds.has(normalizedAgentId) || assignedAgentIds.has(normalizedAgentId)) {
          continue;
        }
        cleanedAgentIds.push(normalizedAgentId);
        assignedAgentIds.add(normalizedAgentId);
        if (workspace.mode === 'private') {
          break;
        }
      }
      workspace.agents = cleanedAgentIds;

      if (workspace.mode === 'private') {
        const cleanedSharedWorkspaceIds: string[] = [];
        for (const workspaceId of Array.isArray(workspace.sharedWorkspaceIds) ? workspace.sharedWorkspaceIds : []) {
          const normalizedWorkspaceId = String(workspaceId || '').trim();
          if (!normalizedWorkspaceId || !sharedWorkspaceIds.includes(normalizedWorkspaceId) || cleanedSharedWorkspaceIds.includes(normalizedWorkspaceId)) {
            continue;
          }
          cleanedSharedWorkspaceIds.push(normalizedWorkspaceId);
        }
        workspace.sharedWorkspaceIds = cleanedSharedWorkspaceIds;
      } else {
        workspace.sharedWorkspaceIds = [];
      }
      delete workspace.allowSharedWorkspaceAccess;
    }

    return config;
  }

  getWorkspaces() {
    if (!Array.isArray(this.config?.workspaces)) {
      this.config.workspaces = [];
    }
    this.normalizeWorkspaceAssignments(this.config);
    return this.config.workspaces;
  }

  getWorkspaceAgentIds(workspace: any) {
    if (!workspace || typeof workspace !== 'object') {
      return [];
    }
    if (!Array.isArray(workspace.agents)) {
      workspace.agents = [];
    }
    workspace.agents = workspace.agents
      .map((agentId: any) => String(agentId || '').trim())
      .filter((agentId: string) => agentId.length > 0);
    return workspace.agents;
  }

  getWorkspaceSharedAccessIds(workspace: any) {
    if (!workspace || typeof workspace !== 'object' || workspace.mode !== 'private') {
      return [];
    }
    if (!Array.isArray(workspace.sharedWorkspaceIds)) {
      workspace.sharedWorkspaceIds = [];
    }
    workspace.sharedWorkspaceIds = workspace.sharedWorkspaceIds
      .map((workspaceId: any) => String(workspaceId || '').trim())
      .filter((workspaceId: string) => workspaceId.length > 0);
    return workspace.sharedWorkspaceIds;
  }

  getWorkspaceById(workspaceId: string | null | undefined) {
    if (!workspaceId) return null;
    return this.getWorkspaces().find((workspace: any) => String(workspace?.id || '') === workspaceId) || null;
  }

  getWorkspaceForAgentId(agentId: string | null | undefined) {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) {
      return null;
    }
    return this.getWorkspaces().find((workspace: any) => this.getWorkspaceAgentIds(workspace).includes(normalizedAgentId)) || null;
  }

  getSharedWorkspaces() {
    return this.getWorkspaces().filter((workspace: any) => workspace?.mode === 'shared');
  }

  getWorkspaceDisplayLabel(workspace: any) {
    if (!workspace) {
      return 'No workspace';
    }
    const label = String(workspace?.name || workspace?.id || 'Workspace');
    return `${label} (${workspace.mode === 'private' ? 'private' : 'shared'})`;
  }

  getWorkspaceAssignmentOptions(agentId: string | null | undefined) {
    const normalizedAgentId = String(agentId || '').trim();
    return this.getWorkspaces()
      .map((workspace: any) => {
        const workspaceId = String(workspace?.id || '').trim();
        if (!workspaceId) {
          return null;
        }

        const occupyingAgentId = workspace.mode === 'private'
          ? this.getWorkspaceAgentIds(workspace).find((candidateId: string) => candidateId !== normalizedAgentId) || ''
          : '';
        const occupyingAgent = occupyingAgentId
          ? this.getManagedAgentEntries().find(({ agent }: any) => String(agent?.id || '') === occupyingAgentId)?.agent || null
          : null;
        const occupiedByLabel = occupyingAgent
          ? String(occupyingAgent?.name || occupyingAgent?.id || occupyingAgentId)
          : occupyingAgentId;

        return {
          id: workspaceId,
          workspace,
          disabled: occupyingAgentId.length > 0,
          occupiedByLabel,
          label: this.getWorkspaceDisplayLabel(workspace)
        };
      })
      .filter(Boolean);
  }

  getAgentEffectiveSandboxMode(agent: any) {
    if (typeof agent?.sandboxMode === 'string' && agent.sandboxMode.trim().length > 0) {
      return agent.sandboxMode.trim();
    }
    if (typeof this.config?.sandbox?.mode === 'string' && this.config.sandbox.mode.trim().length > 0) {
      return this.config.sandbox.mode.trim();
    }
    return 'off';
  }

  isAgentSandboxEffectivelyOff(agent: any) {
    return this.getAgentEffectiveSandboxMode(agent) === 'off';
  }

  getWorkspaceHomeBaseDescription(workspace: any) {
    if (!workspace) {
      return 'No home workspace assigned yet.';
    }
    if (workspace.mode === 'private') {
      return 'Private home workspace';
    }
    return 'Shared collaboration home workspace';
  }

  getConfigurationChecklist() {
    if (!this.config || typeof this.config !== 'object') {
      return {
        ready: false,
        missingRequired: 1,
        required: [
          {
            label: 'Configuration loaded',
            complete: false,
            note: 'Waiting for dashboard configuration to load.'
          }
        ],
        optional: [
          {
            label: 'Telegram routing configured',
            complete: false,
            note: 'Optional. Configure this only if you want Telegram routing.'
          },
          {
            label: 'Voice notes configured',
            complete: false,
            note: 'Optional. Configure this only if you want voice notes.'
          }
        ]
      };
    }

    const endpoints = Array.isArray(this.config.endpoints) ? this.config.endpoints : [];
    const workspaces = Array.isArray(this.config.workspaces) ? this.config.workspaces : [];
    const agents = typeof this.getManagedAgentEntries === 'function'
      ? this.getManagedAgentEntries()
      : (Array.isArray(this.config?.agents?.list) ? this.config.agents.list.map((agent: any, idx: number) => ({
          key: typeof agent?.key === 'string' && agent.key.trim().length > 0 ? agent.key : `agent:${idx}`,
          agent
        })).filter((entry: any) => entry.agent?.id) : []);
    const agentIds = agents
      .map(({ agent }: any) => String(agent?.id || '').trim())
      .filter((agentId: string) => agentId.length > 0);
    const endpointAgentIds = new Set(
      endpoints.flatMap((endpoint: any) => Array.isArray(endpoint?.agents) ? endpoint.agents : [])
        .map((agentId: any) => String(agentId || '').trim())
        .filter((agentId: string) => agentId.length > 0)
    );
    const defaultEndpoint = endpoints.find((endpoint: any) => endpoint?.default) || null;
    const defaultEndpointAgentIds = defaultEndpoint
      ? this.getEndpointAgentIds(defaultEndpoint)
      : [];
    const defaultEndpointAgentCount = defaultEndpointAgentIds.length;
    const defaultEndpointModelCount = defaultEndpoint
      ? (Array.isArray(defaultEndpoint.models) ? defaultEndpoint.models.length : 0) + (Array.isArray(defaultEndpoint.hostedModels) ? defaultEndpoint.hostedModels.length : 0)
      : 0;
    const workspacePathsConfigured = workspaces.filter((workspace: any) => String(workspace?.path || '').trim().length > 0).length;
    const agentsWithWorkspace = agents.filter(({ agent }: any) => {
      const agentId = String(agent?.id || '').trim();
      return !!agentId && workspaces.some((workspace: any) => Array.isArray(workspace?.agents) && workspace.agents.includes(agentId));
    });
    const agentsWithEndpoint = agents.filter(({ agent }: any) => endpointAgentIds.has(String(agent?.id || '').trim()));
    const telegramConfig = this.config?.telegram && typeof this.config.telegram === 'object'
      ? this.config.telegram
      : { enabled: true, defaultAccount: '', accounts: [] };
    const defaultTelegramAccountId = String(telegramConfig.defaultAccount || '').trim() || 'default';
    const telegramAccounts = Array.isArray(telegramConfig.accounts) ? telegramConfig.accounts : [];
    const telegramSetupRecords: any[] = [];
    if (typeof this.getTelegramSetupStatusRecord === 'function') {
      const defaultTelegramSetupStatus = this.getTelegramSetupStatusRecord(defaultTelegramAccountId, true);
      if (defaultTelegramSetupStatus) {
        telegramSetupRecords.push(defaultTelegramSetupStatus);
      }
      for (const account of telegramAccounts) {
        const accountId = String(account?.id || '').trim();
        if (!accountId) {
          continue;
        }
        const accountSetupStatus = this.getTelegramSetupStatusRecord(accountId, false);
        if (accountSetupStatus) {
          telegramSetupRecords.push(accountSetupStatus);
        }
      }
    }
    const telegramConfiguredByStatus = telegramSetupRecords.some((record: any) => !!record?.configured);
    const telegramConfigured = telegramConfiguredByStatus || (
      telegramConfig.enabled !== false &&
      defaultTelegramAccountId.length > 0 &&
      telegramAccounts.length > 0
    );
    const voiceNotes = this.config?.voiceNotes && typeof this.config.voiceNotes === 'object'
      ? this.config.voiceNotes
      : { enabled: false, mode: '', whisperModel: '' };
    const voiceConfigured = !voiceNotes.enabled || (
      String(voiceNotes.mode || '').trim().length > 0 &&
      String(voiceNotes.whisperModel || '').trim().length > 0
    );

    const required = [
      {
        label: 'At least one endpoint configured',
        complete: endpoints.length > 0,
        note: endpoints.length > 0
          ? `${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'} configured.`
          : 'Add your first endpoint in Configuration > Endpoints.'
      },
      {
        label: 'Default endpoint selected',
        complete: !!defaultEndpoint,
        note: defaultEndpoint
          ? `${defaultEndpoint.key} is the default endpoint.`
          : 'Choose which endpoint should be preferred first.'
      },
      {
        label: 'Default endpoint has models',
        complete: defaultEndpointModelCount > 0,
        note: defaultEndpoint
          ? defaultEndpointModelCount > 0
            ? `${defaultEndpointModelCount} local or hosted model${defaultEndpointModelCount === 1 ? '' : 's'} configured.`
            : 'Add at least one local or hosted model to the default endpoint.'
          : 'Pick a default endpoint first.'
      },
      {
        label: 'At least one workspace configured',
        complete: workspaces.length > 0,
        note: workspaces.length > 0
          ? `${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} configured.`
          : 'Add a shared or private workspace in Configuration > Workspaces.'
      },
      {
        label: 'Workspace paths filled in',
        complete: workspaces.length > 0 && workspacePathsConfigured === workspaces.length,
        note: workspaces.length > 0
          ? workspacePathsConfigured === workspaces.length
            ? 'Every workspace has a home-base path.'
            : `${workspaces.length - workspacePathsConfigured} workspace${workspaces.length - workspacePathsConfigured === 1 ? ' is' : 's are'} missing a path.`
          : 'Create a workspace first.'
      },
      {
        label: 'At least one agent configured',
        complete: agentIds.length > 0,
        note: agentIds.length > 0
          ? `${agentIds.length} managed agent${agentIds.length === 1 ? '' : 's'} configured.`
          : 'Add your first managed agent in Configuration > Agents.'
      },
      {
        label: 'Agents assigned to workspaces',
        complete: agentIds.length > 0 && agentsWithWorkspace.length === agentIds.length,
        note: agentIds.length > 0
          ? agentsWithWorkspace.length === agentIds.length
            ? 'Every agent has a workspace home base.'
            : `${agentIds.length - agentsWithWorkspace.length} agent${agentIds.length - agentsWithWorkspace.length === 1 ? ' is' : 's are'} still missing a workspace assignment.`
          : 'Add a managed agent first.'
      },
      {
        label: 'Agents assigned to endpoints',
        complete: agentIds.length > 0 && agentsWithEndpoint.length === agentIds.length,
        state: !defaultEndpoint || defaultEndpointAgentCount === 0
          ? 'error'
          : agentsWithEndpoint.length === agentIds.length
            ? 'success'
            : 'warning',
        note: !defaultEndpoint
          ? 'Pick a default endpoint first.'
          : defaultEndpointAgentCount === 0
            ? 'The default endpoint has no agents assigned yet.'
            : agentsWithEndpoint.length === agentIds.length
              ? 'Every managed agent is placed on an endpoint.'
              : `${agentIds.length - agentsWithEndpoint.length} agent${agentIds.length - agentsWithEndpoint.length === 1 ? ' is' : 's are'} still missing endpoint placement.`
      }
    ];

    const optional = [
      {
        label: 'Telegram routing configured',
        complete: telegramConfigured,
        note: telegramConfigured
          ? telegramConfiguredByStatus
            ? 'Telegram setup status reports a configured live account.'
            : 'Telegram has a default account and at least one configured account.'
          : 'Optional. Configure this only if you want Telegram routing.'
      },
      {
        label: 'Voice notes configured',
        complete: voiceConfigured,
        note: voiceConfigured
          ? voiceNotes.enabled
            ? `Voice notes are enabled with ${voiceNotes.mode} and ${voiceNotes.whisperModel}.`
            : 'Voice notes are disabled, which is fine if you do not need them.'
          : 'Voice notes are enabled, but mode or model still needs attention.'
      }
    ];

    const missingRequired = required.filter((item) => !item.complete).length;
    return {
      ready: missingRequired === 0,
      missingRequired,
      required,
      optional
    };
  }

  enforceWorkspaceSandboxPolicy(agent: any, workspace: any) {
    if (!agent || !workspace) {
      return '';
    }

    const agentName = String(agent?.name || agent?.id || 'Agent');
    const workspaceName = String(workspace?.name || workspace?.id || 'workspace');
    const sharedAccessIds = workspace?.mode === 'private' ? this.getWorkspaceSharedAccessIds(workspace) : [];
    const needsSandboxOff = workspace.mode === 'shared' || sharedAccessIds.length > 0;
    const effectiveSandboxMode = this.getAgentEffectiveSandboxMode(agent);

    if (needsSandboxOff) {
      if (effectiveSandboxMode !== 'off') {
        agent.sandboxMode = 'off';
        if (workspace.mode === 'shared') {
          return `${agentName} now lives in shared workspace "${workspaceName}", so the toolkit turned sandbox off. Shared collaboration should not be limited to a single private home-base path.`;
        }
        return `${agentName} keeps private workspace "${workspaceName}" as the home base, but shared workspace access is enabled, so the toolkit turned sandbox off to let the agent reach those extra collaboration workspaces.`;
      }
      return '';
    }

    if (effectiveSandboxMode === 'off' || effectiveSandboxMode === 'all') {
      agent.sandboxMode = 'workspace-write';
      return `${agentName} now lives only in private workspace "${workspaceName}", so the toolkit turned sandbox on with workspace-write mode. The private workspace is now the agent's home base and privacy boundary.`;
    }

    return '';
  }

  setAgentPrimaryWorkspace(agentId: string, workspaceId: string | null) {
    const normalizedAgentId = String(agentId || '').trim();
    if (!normalizedAgentId) {
      return;
    }

    for (const workspace of this.getWorkspaces()) {
      workspace.agents = this.getWorkspaceAgentIds(workspace).filter((candidateId: string) => candidateId !== normalizedAgentId);
    }

    if (!workspaceId) {
      this.requestUpdate();
      return;
    }

    const targetWorkspace = this.getWorkspaceById(workspaceId);
    if (!targetWorkspace) {
      this.requestUpdate();
      return;
    }

    const targetAgent = this.getManagedAgentEntries().find(({ agent }: any) => String(agent?.id || '') === normalizedAgentId)?.agent || null;

    if (targetWorkspace.mode === 'private') {
      targetWorkspace.agents = [normalizedAgentId];
    } else if (!this.getWorkspaceAgentIds(targetWorkspace).includes(normalizedAgentId)) {
      targetWorkspace.agents = [...this.getWorkspaceAgentIds(targetWorkspace), normalizedAgentId];
    }

    this.normalizeWorkspaceAssignments(this.config);
    if (targetAgent) {
      const message = this.enforceWorkspaceSandboxPolicy(targetAgent, targetWorkspace);
      if (message) {
        alert(message);
      }
    }
    this.requestUpdate();
  }

  setTopologyAgentWorkspace(agentId: string, workspaceId: string | null) {
    const entry = this.getTopologyAgentEntryById(agentId);
    this.setAgentPrimaryWorkspace(agentId, workspaceId);
    if (!entry) {
      return;
    }

    this.topologySelectedAgentId = agentId;
    const assignedWorkspace = workspaceId ? this.getWorkspaceById(workspaceId) : null;
    this.setTopologyNotice(assignedWorkspace
      ? `${entry.name} now uses ${this.getWorkspaceDisplayLabel(assignedWorkspace)} as the home workspace.`
      : `${entry.name} no longer has a primary workspace assigned.`);
  }

  setWorkspaceSharedAccess(workspace: any, sharedWorkspaceIds: string[]) {
    if (!workspace || workspace.mode !== 'private') {
      return;
    }
    const availableSharedIds = new Set(this.getSharedWorkspaces().map((candidate: any) => String(candidate?.id || '')));
    workspace.sharedWorkspaceIds = Array.from(new Set(
      sharedWorkspaceIds
        .map((workspaceId: any) => String(workspaceId || '').trim())
        .filter((workspaceId: string) => workspaceId.length > 0 && availableSharedIds.has(workspaceId))
    ));
    const primaryAgentId = this.getWorkspaceAgentIds(workspace)[0];
    if (primaryAgentId) {
      const primaryAgent = this.getManagedAgentEntries().find(({ agent }: any) => String(agent?.id || '') === primaryAgentId)?.agent || null;
      if (primaryAgent) {
        const message = this.enforceWorkspaceSandboxPolicy(primaryAgent, workspace);
        if (message) {
          alert(message);
        }
      }
    }
    this.requestUpdate();
  }


  };
