import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import {
  AVAILABLE_TOOL_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES,
  VALID_WORKSPACE_MARKDOWN_FILES
} from './toolkit-dashboard-constants';
import { ToolkitDashboardConfigMixin } from './toolkit-dashboard-config-mixin';
import { ToolkitDashboardTelegramMixin } from './toolkit-dashboard-telegram-mixin';
import { ToolkitDashboardTopologyMixin } from './toolkit-dashboard-topology-mixin';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardRenderMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardRenderMixin extends ToolkitDashboardTopologyMixin(ToolkitDashboardConfigMixin(ToolkitDashboardTelegramMixin(Base))) {
    [key: string]: any;


  renderEndpointsConfig() {
    if (this.editingEndpointKey) {
        return this.renderEndpointEditor(this.editingEndpointKey);
    }

    const endpoints = this.getSortedConfigEndpoints();

    return html`
      <div class="card">
        <div class="card-header">
          <h3>Endpoints</h3>
          <button class="btn btn-ghost" @click=${() => this.addEndpoint()}>+ Add Endpoint</button>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Endpoints are machines or PCs. Each one can expose a local Ollama runtime, a hosted model pool, or both.</p>
        ${repeat(endpoints, (ep: any) => ep.key, (ep: any) => {
          const runtime = this.getEndpointOllama(ep);
          const assignedAgentCount = this.getEndpointAgentIds(ep).length;
          return html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${ep.key} ${ep.default ? html`<span class="badge" style="background: #ffc107;">Default</span>` : ''}</span>
              <span class="item-sub">${runtime?.hostBaseUrl || 'Hosted-only endpoint'} | ${this.getEndpointModels(ep).length} local, ${this.getEndpointHostedModels(ep).length} hosted | ${assignedAgentCount} assigned</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" @click=${() => this.editingEndpointKey = ep.key}>Configure Endpoint</button>
              ${this.canRemoveEndpoint(ep) ? html`
                <button class="btn btn-danger" @click=${() => this.removeEndpointByKey(ep.key)}>Remove</button>
              ` : ''}
            </div>
          </div>
        `})}
      </div>
    `;
  }


  renderEndpointEditor(key: string) {
      const ep = this.getConfigEndpoints().find((e: any) => e.key === key);
      if (!ep) return html`Endpoint not found`;
      const endpointModels = this.getEndpointModels(ep);
      const endpointHostedModels = this.getEndpointHostedModels(ep);
      const runtime = this.getEndpointOllama(ep);
      const assignedAgentIds = this.getEndpointAgentIds(ep);
      const assignedAgents = this.getManagedAgentEntries().filter(({ agent }: any) => assignedAgentIds.includes(String(agent?.id || '')));
      const availableAgents = this.getManagedAgentEntries().filter(({ agent }: any) => {
        const agentId = String(agent?.id || '');
        return agentId.length > 0 && !assignedAgentIds.includes(agentId);
      });

      return html`
        <div class="card">
            <div class="card-header">
                <h3>Endpoint: ${ep.key}</h3>
                <button class="btn btn-ghost" @click=${() => this.editingEndpointKey = null}>Back to Endpoints</button>
            </div>

            <div class="grid-2">
                <div>
                    <div class="form-group">
                        <label>Endpoint Key</label>
                        <input type="text" .value=${ep.key} disabled>
                    </div>
                    <div class="form-group">
                        <label class="toggle-switch">
                            <input type="checkbox" ?checked=${!!ep.default} @change=${(e: any) => {
                                if (e.target.checked) {
                                    for (const endpoint of this.getConfigEndpoints()) {
                                        endpoint.default = endpoint.key === ep.key;
                                    }
                                } else {
                                    ep.default = false;
                                }
                                this.requestUpdate();
                            }}>
                            Default endpoint
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <label>Endpoint Role</label>
                    <div class="help-text" style="margin-top: 0;">The default endpoint is the main workbench the toolkit prefers first when an agent has not been moved elsewhere.</div>
                </div>
            </div>

            <div class="form-group" style="margin-top: 16px;">
                <label class="toggle-switch">
                    <input type="checkbox" ?checked=${!!runtime} @change=${(e: any) => {
                        if (e.target.checked) {
                            this.ensureEndpointOllama(ep);
                        } else {
                            delete ep.ollama;
                        }
                        this.requestUpdate();
                    }}>
                    This endpoint has a local Ollama runtime
                </label>
            </div>

            <h4 style="color: #666; margin-top: 24px;">Assigned Agents</h4>
            <p style="font-size: 0.8rem; color: #888; margin-bottom: 15px;">Endpoints now own agent placement. Agents listed here belong to this machine/workbench.</p>
            <div class="tag-list">
                ${assignedAgents.map(({ agent }: any) => html`
                    <div class="tag">
                        ${agent.name ? `${agent.name} (${agent.id})` : agent.id}
                        <span class="tag-remove" @click=${() => {
                            this.setAgentEndpointAssignment(agent, null);
                            this.requestUpdate();
                        }}>×</span>
                    </div>
                `)}
            </div>
            <div style="margin-top: 10px; margin-bottom: 20px;">
                <select @change=${(e: any) => {
                    const agentId = e.target.value;
                    const entry = this.getManagedAgentEntries().find((candidate: any) => String(candidate?.agent?.id || '') === agentId);
                    if (entry) {
                        this.setAgentEndpointAssignment(entry.agent, ep.key);
                        this.requestUpdate();
                    }
                    e.target.value = '';
                }}>
                    <option value="">${availableAgents.length === 0 ? 'All configured agents are already assigned' : '+ Add Agent to Endpoint'}</option>
                    ${availableAgents.map(({ agent }: any) => html`<option value=${agent.id}>${agent.name ? `${agent.name} (${agent.id})` : agent.id}</option>`)}
                </select>
            </div>

            ${runtime ? html`
            <div class="grid-2">
                <div class="form-group">
                    <label>Base URL (Inside Docker)</label>
                    <input type="text" .value=${runtime.baseUrl || ''} @input=${(e: any) => { runtime.baseUrl = e.target.value; this.requestUpdate(); }}>
                </div>
                <div class="form-group">
                    <label>Host Base URL (Direct Access)</label>
                    <input type="text" .value=${runtime.hostBaseUrl || ''} @input=${(e: any) => { runtime.hostBaseUrl = e.target.value; this.requestUpdate(); }}>
                </div>
            </div>

            <div class="grid-2">
                <div>
                    <div class="form-group">
                        <label>Provider ID</label>
                        <input type="text" .value=${runtime.providerId || ''} @input=${(e: any) => { runtime.providerId = e.target.value; this.requestUpdate(); }}>
                    </div>
                    <div class="form-group">
                        <label class="toggle-switch">
                            <input type="checkbox" ?checked=${!!runtime.autoPullMissingModels} @change=${(e: any) => { runtime.autoPullMissingModels = e.target.checked; this.requestUpdate(); }}>
                            Auto-pull missing local models when they fit
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <label>Runtime Pull Behavior</label>
                    <div class="help-text" style="margin-top: 0;">When enabled, bootstrap can pull missing local models onto this machine if they fit the configured hardware budget.</div>
                </div>
            </div>

            <div class="form-group">
                <label>Model Fit VRAM Headroom (MiB)</label>
                <input
                  type="number"
                  min="0"
                  step="128"
                  .value=${typeof runtime.vramHeadroomMiB === 'number' ? String(Math.round(runtime.vramHeadroomMiB)) : ''}
                  @input=${(e: any) => {
                    const parsed = Number(e.target.value);
                    if (Number.isFinite(parsed) && parsed >= 0) {
                      runtime.vramHeadroomMiB = Math.round(parsed);
                    } else {
                      delete runtime.vramHeadroomMiB;
                    }
                    this.requestUpdate();
                  }}>
                <div class="help-text">Per-endpoint override for probe headroom. Leave blank to use global setting.</div>
              </div>
              <h4 style="color: #666; margin-top: 20px;">Local Runtime Models</h4>
            <p style="font-size: 0.8rem; color: #888; margin-bottom: 15px;">Models listed here are desired on this machine's local runtime. Bootstrap will pull them when they fit the machine. When a model has fallbacks, both toolkit fit checks and OpenClaw runtime fallbacks follow the order shown here.</p>
             
            ${endpointModels.map((mo: any, idx: number) => html`
                <div class="item-row" style="align-items: flex-start; gap: 16px;">
                    <div class="item-info">
                        <span class="item-title">${mo.id}</span>
                        <span class="item-sub">Ctx: ${mo.contextWindow} | MaxTokens: ${mo.maxTokens || 8192}</span>
                        ${endpointModels.length > 1 ? this.renderOrderedLocalFallbackEditor(mo, endpointModels.map((localModel: any) => localModel.id)) : ''}
                    </div>
                    <div style="display: flex; gap: 12px; align-items: flex-start; flex-shrink: 0;">
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <button class="btn btn-secondary" @click=${() => this.tuneExistingModel(ep.key, mo.id)}>Re-Tune</button>
                            <button class="btn btn-danger" @click=${() => { endpointModels.splice(idx, 1); this.requestUpdate(); }}>Remove</button>
                        </div>
                    </div>
                </div>
            `)}

            <div style="margin-top: 20px;">
                <button class="btn btn-primary" @click=${() => { this.selectorTarget = 'tune'; this.showModelSelector = true; }}>+ Add Local Model from Catalog</button>
            </div>
            ` : html`
            <div class="item-sub" style="margin-top: 20px;">This endpoint is currently hosted-only. Enable the local runtime toggle above if this machine should run Ollama too.</div>
            `}

            <h4 style="color: #666; margin-top: 24px;">Hosted Models</h4>
            <p style="font-size: 0.8rem; color: #888; margin-bottom: 15px;">These are provider-backed models available from this endpoint, such as OpenAI, Claude, Gemini, Copilot, or Ollama Cloud refs. If the primary hosted model fails, OpenClaw tries the local fallbacks below in order.</p>

            ${endpointHostedModels.map((model: any, idx: number) => html`
                <div class="item-row" style="align-items: flex-start; gap: 16px;">
                    <div class="item-info">
                        <span class="item-title">${model.modelRef}</span>
                        ${endpointModels.length > 0 ? this.renderOrderedLocalFallbackEditor(model, endpointModels.map((localModel: any) => localModel.id)) : ''}
                    </div>
                    <div style="display: flex; gap: 12px; align-items: flex-start; flex-shrink: 0;">
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <button class="btn btn-danger" @click=${() => { endpointHostedModels.splice(idx, 1); this.requestUpdate(); }}>Remove</button>
                        </div>
                    </div>
                </div>
            `)}

            <div style="margin-top: 20px;">
                <button class="btn btn-primary" @click=${() => { this.selectorTarget = 'endpoint-hosted'; this.showModelSelector = true; }}>+ Add Hosted Model from Catalog</button>
            </div>
        </div>
      `;
  }


  renderModelSelector() {
      const models = this.selectorTarget === 'endpoint-hosted'
        ? this.getKnownHostedModelCatalog()
        : this.getKnownLocalModelCatalog();
      return html`
        <div class="modal-overlay">
            <div class="modal">
                <div class="card-header" style="padding: 20px;">
                    <h3>${this.selectorTarget === 'endpoint-hosted' ? 'Select Hosted Model from Catalog' : 'Select Local Model from Catalog'}</h3>
                    <button class="btn btn-ghost" @click=${() => this.showModelSelector = false}>Close</button>
                </div>
                <div class="modal-body">
                    ${models.length === 0 ? html`<div class="item-sub">No matching models are in the shared catalog yet.</div>` : ''}
                    ${models.map((m: any) => html`
                        <div class="selectable-item" @click=${() => this.handleModelSelected(this.selectorTarget === 'endpoint-hosted' ? m.modelRef : m.id)}>
                            <div class="item-title">${m.id || m.modelRef}</div>
                            <div class="item-sub">${this.selectorTarget === 'endpoint-hosted' ? `Ref: ${m.modelRef}` : `ID: ${m.id}`}</div>
                        </div>
                    `)}
                </div>
            </div>
        </div>
      `;
  }

  handleModelSelected(modelId: string) {
      this.showModelSelector = false;
      if (this.selectorTarget === 'tune') {
          const maxCtx = prompt('Maximum context window to test:', '131072');
          if (maxCtx) {
              this.runCommand('add-local-model', ['-Model', modelId, '-EndpointKey', this.editingEndpointKey!, '-MaxContextWindow', maxCtx, '-SkipBootstrap']);
          }
      } else if (this.selectorTarget === 'endpoint-hosted') {
          const endpoint = this.getConfigEndpoints().find((e: any) => e.key === this.editingEndpointKey);
          const catalogEntry = this.getKnownHostedModelCatalog().find((entry: any) => entry.modelRef === modelId);
          if (!endpoint || !catalogEntry) return;
          if (!Array.isArray(endpoint.hostedModels)) endpoint.hostedModels = [];
          if (endpoint.hostedModels.some((entry: any) => entry.modelRef === modelId)) {
              alert(`Hosted model "${modelId}" is already added to endpoint "${endpoint.key}".`);
              return;
          }
          endpoint.hostedModels.push(this.sanitizeModelEntries([catalogEntry])[0]);
          this.requestUpdate();
      } else if (this.selectorTarget === 'candidate') {
          const agent = this.getEditingAgent();
          const ref = `ollama/${modelId}`;
          if (!agent.candidateModelRefs) agent.candidateModelRefs = [];
          if (!agent.candidateModelRefs.includes(ref)) {
              agent.candidateModelRefs.push(ref);
          }
          this.requestUpdate();
      }
  }

  tuneExistingModel(endpointKey: string, modelId: string) {
      const maxCtx = prompt('Maximum context window to test:', '131072');
      if (maxCtx) {
          this.runCommand('add-local-model', ['-Model', modelId, '-EndpointKey', endpointKey, '-MaxContextWindow', maxCtx, '-SkipBootstrap']);
      }
  }


  renderModelsConfig() {
    const hasSharedCatalog = Array.isArray(this.config?.modelCatalog) || Array.isArray(this.config?.ollama?.models);
    const localModels = hasSharedCatalog ? this.getSharedModelCatalog().filter((model: any) => this.isLocalCatalogModel(model)) : this.getKnownLocalModelCatalog();
    const hostedModels = hasSharedCatalog ? this.getSharedModelCatalog().filter((model: any) => this.isHostedCatalogModel(model)) : this.getKnownHostedModelCatalog();
    return html`
      <div class="card">
        <div class="card-header">
          <h3>Known Models</h3>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-ghost" @click=${() => this.addModel()}>+ Add Local</button>
            <button class="btn btn-ghost" @click=${() => this.addHostedModel()}>+ Add Hosted</button>
          </div>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">
          ${hasSharedCatalog
            ? 'This shared catalog is stored in top-level modelCatalog in openclaw-bootstrap.config.json. Endpoint model rows still decide what each machine should pull, run, and fall back to.'
            : 'No shared catalog exists yet. The view below is inferred from endpoint-local and endpoint-hosted models; adding a catalog model will seed a reusable shared catalog from this list.'}
        </p>
        <div class="model-catalog-help">
          <div class="model-catalog-help-card">
            <strong>Min Ctx</strong>
            <span>The smallest memory window we still consider worth using for this model. If the model cannot fit at least this much, the toolkit should switch to a smaller fallback instead.</span>
          </div>
          <div class="model-catalog-help-card">
            <strong>Ctx</strong>
            <span>How much conversation and file content we want this machine to keep in mind while the model is running. Bigger values help with larger tasks, but they also use more VRAM.</span>
          </div>
          <div class="model-catalog-help-card">
            <strong>Max Tokens</strong>
            <span>How long we allow the model's reply to be. Bigger values let it write more before stopping, but they can make runs slower and more expensive.</span>
          </div>
          <div class="model-catalog-help-card">
            <strong>Reasoning</strong>
            <span>Turn this on only for models that truly support extra thinking mode. If this stays off, the toolkit will avoid asking that model to use thinking features it may not understand.</span>
          </div>
          <div class="model-catalog-help-card">
            <strong>Tool Use</strong>
            <span>Leave this on default unless you want OpenClaw to push harder for real tool calls. <code>required</code> can help tool-first specialists, but it can be too strict for general chat.</span>
          </div>
        </div>
        <h4 style="color: #666; margin-bottom: 10px;">Local Catalog</h4>
        <div class="model-catalog-list">
        ${repeat(localModels, (m: any) => m.id, (m: any) => {
          const idx = hasSharedCatalog ? this.getSharedModelCatalog().indexOf(m) : -1;
          const reasoningCapable = this.isReasoningCapableModel(m);
          const toolChoice = this.getConfiguredToolChoice(m);
          const contextWindowSummary = typeof m.contextWindow === 'number' ? `${m.contextWindow}` : 'unset';
          const maxTokensSummary = typeof m.maxTokens === 'number' ? `${m.maxTokens}` : 'unset';
          return html`
          <div class="model-catalog-card">
            <div class="model-catalog-header">
              <div class="model-catalog-title">
                <span class="item-title">${m.id}</span>
                <div class="model-catalog-pill-row">
                  <span class="model-catalog-pill">${`Min Ctx ${m.minimumContextWindow || 24576}`}</span>
                  <span class="model-catalog-pill">${`Ctx ${contextWindowSummary}`}</span>
                  <span class="model-catalog-pill">${`Max Tokens ${maxTokensSummary}`}</span>
                  <span class="model-catalog-pill">${`Tool Use ${toolChoice || 'default'}`}</span>
                  <span class="model-catalog-pill ${reasoningCapable ? 'reasoning' : 'standard'}">
                    ${reasoningCapable ? 'Reasoning / thinking-capable' : 'Standard / thinking-off by default'}
                  </span>
                </div>
              </div>
              ${hasSharedCatalog && idx >= 0 ? html`
                <label class="toggle-switch" style="margin: 0; align-self: center;">
                  <input
                    type="checkbox"
                    ?checked=${reasoningCapable}
                    @change=${(e: any) => {
                      m.reasoning = e.target.checked;
                      this.requestUpdate();
                    }}
                  >
                  Reasoning / thinking-capable
                </label>
              ` : html`
                <div class="help-text" style="margin: 0; text-align: right;">Save the shared catalog first to edit local model metadata.</div>
              `}
            </div>
            ${hasSharedCatalog && idx >= 0 ? html`
              <div class="model-catalog-grid">
                <div class="form-group" style="margin-bottom: 0;">
                  <label>Min Ctx</label>
                  <input
                    type="number"
                    min="1024"
                    step="1024"
                    .value=${this.getModelNumberInputValue(m.minimumContextWindow, 24576)}
                    @change=${(e: any) => this.updateModelNumericField(m, 'minimumContextWindow', e.target.value, { min: 1024, fallbackValue: 24576 })}
                  >
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label>Ctx</label>
                  <input
                    type="number"
                    min="1024"
                    step="1024"
                    .value=${this.getModelNumberInputValue(m.contextWindow)}
                    placeholder="Unset"
                    @change=${(e: any) => this.updateModelNumericField(m, 'contextWindow', e.target.value, { min: 1024, deleteWhenBlank: true })}
                  >
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label>Max Tokens</label>
                  <input
                    type="number"
                    min="1"
                    step="256"
                    .value=${this.getModelNumberInputValue(m.maxTokens, 8192)}
                    @change=${(e: any) => this.updateModelNumericField(m, 'maxTokens', e.target.value, { min: 1, fallbackValue: 8192 })}
                  >
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                  <label>Tool Use</label>
                  <select
                    .value=${toolChoice}
                    @change=${(e: any) => this.setConfiguredToolChoice(m, e.target.value)}>
                    <option value="">Default</option>
                    <option value="auto">Auto</option>
                    <option value="required">Required</option>
                    <option value="none">None</option>
                  </select>
                </div>
              </div>
              <div class="model-catalog-actions">
                <button class="btn btn-ghost" @click=${() => this.removeModel(idx, { keepOllamaModel: true })}>Remove from Config</button>
                <button class="btn btn-danger" @click=${() => this.removeModel(idx)}>Delete from Ollama Too</button>
              </div>
            ` : ''}
          </div>
        `;})}
        </div>
        <div class="help-text" style="margin-top: 10px;">Mark local models as reasoning-capable only when the model actually supports OpenClaw thinking levels. The toolkit benchmark and agent session helpers use this metadata when <code>Thinking=auto</code>.</div>
        <div class="help-text" style="margin-top: 6px;">Tool Use writes to the model's OpenClaw <code>params.toolChoice</code>. <code>required</code> is best for tool-first specialists and experiments, not for every general-purpose chat model.</div>
        <div class="help-text" style="margin-top: 6px;">Ollama can tell us some facts like the model's maximum context length and whether it supports tools, but it does not reliably tell us the true maximum reply length, so <code>Max Tokens</code> is still something we manage here in the toolkit.</div>
        <h4 style="color: #666; margin: 20px 0 10px;">Hosted Catalog</h4>
        ${repeat(hostedModels, (m: any) => m.modelRef, (m: any) => {
          const idx = hasSharedCatalog ? this.getSharedModelCatalog().indexOf(m) : -1;
          return html`
          <div class="item-row">
            <div class="item-info">
              <span class="item-title">${m.modelRef}</span>
              <span class="item-sub">Hosted provider model</span>
            </div>
            ${hasSharedCatalog && idx >= 0 ? html`
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-danger" @click=${() => this.removeModel(idx)}>Remove</button>
              </div>
            ` : ''}
          </div>
        `;})}
      </div>
    `;
  }


  renderTemplateMarkdownsConfig() {
      const scope = this.markdownTemplateScope;
      const fileNames = this.getMarkdownTemplateFileOptions(scope) as string[];
      const selectedTemplateFile = this.getSelectedTemplateMarkdownFile();
      const selectedFileName = fileNames.includes(selectedTemplateFile)
        ? selectedTemplateFile
        : fileNames[0];
      const library = this.ensureMarkdownTemplateLibrary(scope, selectedFileName);
      const templateKeys = Object.keys(library).sort((left, right) => left.localeCompare(right));

      return html`
        <div class="card">
            <div class="card-header">
                <h3>Template Markdowns</h3>
                <button class="btn btn-ghost" @click=${() => this.addMarkdownTemplate(scope, selectedFileName)}>+ Add Template</button>
            </div>
            <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Define reusable markdown templates by scope and file type. Agents and workspaces can either reference one of these named templates or keep their own custom markdown files.</p>

            <div style="display: flex; gap: 10px; margin-bottom: 16px;">
              <div class="tab ${scope === 'agents' ? 'active' : ''}" @click=${() => this.markdownTemplateScope = 'agents'}>Agents</div>
              <div class="tab ${scope === 'workspaces' ? 'active' : ''}" @click=${() => this.markdownTemplateScope = 'workspaces'}>Workspaces</div>
            </div>

            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px;">
              ${fileNames.map((fileName) => html`
                <div class="tab ${selectedFileName === fileName ? 'active' : ''}" @click=${() => this.setSelectedTemplateMarkdownFile(fileName)}>${fileName.replace('.md', '')}</div>
              `)}
            </div>

            <p class="help-text" style="margin-bottom: 20px;">Stored under <code>openclaw-toolkit\\markdown-templates\\${scope}\\${selectedFileName.replace('.md', '')}\\&lt;key&gt;.md</code>.</p>

            ${templateKeys.length === 0 ? html`
              <div class="help-text">No templates defined for ${scope} ${selectedFileName} yet.</div>
            ` : templateKeys.map((templateKey) => html`
              <div class="form-group" style="margin-bottom: 25px; border-bottom: 1px solid #333; padding-bottom: 20px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                      <span style="font-weight: bold; color: #00bcd4;">${templateKey}</span>
                      <button class="btn btn-danger btn-small" style="padding: 4px 10px;" @click=${() => this.removeMarkdownTemplate(scope, selectedFileName, templateKey)}>Delete Template</button>
                  </div>
                  <textarea rows="10" .value=${library[templateKey] || ''} @input=${(e: any) => { library[templateKey] = e.target.value; this.requestUpdate(); }}></textarea>
              </div>
            `)}
        </div>
      `;
  }


  renderToolsetsConfig() {
    const toolsets = this.getToolsetsList();

    return html`
      <div class="card">
        <div class="card-header">
          <h3>Toolsets</h3>
          <button class="btn btn-ghost" @click=${() => this.addToolset()}>+ Add Toolset</button>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Toolsets are reusable allow/deny layers. The built-in <code>minimal</code> toolset is always applied first as a safe chat-only baseline, then each agent's own toolsets are merged from top to bottom so lower entries win conflicts.</p>

        ${toolsets.map((toolset: any) => {
          const isMinimal = toolset.key === 'minimal';
          const availableAllowOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !this.normalizeToolNameList(toolset.allow).includes(option.id));
          const availableDenyOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !this.normalizeToolNameList(toolset.deny).includes(option.id));
          return html`
            <div class="card" style="margin-bottom: 16px; border-color: ${isMinimal ? '#00bcd4' : '#333'};">
              <div class="card-header">
                <h3>${toolset.name || toolset.key} ${isMinimal ? html`<span class="badge">Global Minimal</span>` : ''}</h3>
                ${isMinimal ? html`<span class="help-text" style="margin: 0;">Built in and always applied first.</span>` : html`
                  <button class="btn btn-danger" @click=${() => this.removeToolset(toolset.key)}>Remove Toolset</button>
                `}
              </div>

              <div class="grid-2">
                <div class="form-group">
                  <label>Name</label>
                  <input type="text" .value=${toolset.name || ''} @input=${(e: any) => { toolset.name = e.target.value; this.requestUpdate(); }}>
                </div>
                <div class="form-group">
                  <label>Key</label>
                  <input
                    type="text"
                    .value=${toolset.key || ''}
                    ?disabled=${isMinimal}
                    @change=${(e: any) => this.renameToolsetKey(toolset, e.target.value)}
                  >
                  ${isMinimal ? html`<div class="help-text">The global minimal toolset key is locked. It is the safe chat-only baseline applied to every managed agent.</div>` : html`<div class="help-text">Agents reference this key. Renaming updates existing agent assignments.</div>`}
                </div>
              </div>

              <div class="grid-2">
                <div class="form-group">
                  <label>Allowed Tools</label>
                  <select @change=${(e: any) => {
                    const value = e.target.value;
                    if (value) {
                      this.addToolToToolset(toolset, 'allow', value);
                      e.target.value = '';
                    }
                  }}>
                    <option value="">+ Add allowed tool</option>
                    ${availableAllowOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`)}
                  </select>
                  <div class="tag-list">
                    ${this.normalizeToolNameList(toolset.allow).map((toolId: string) => html`
                      <div class="tag">
                        ${this.renderToolLabel(toolId)}
                        <span class="tag-remove" @click=${() => this.removeToolFromToolset(toolset, 'allow', toolId)}>×</span>
                      </div>
                    `)}
                  </div>
                </div>

                <div class="form-group">
                  <label>Denied Tools</label>
                  <select @change=${(e: any) => {
                    const value = e.target.value;
                    if (value) {
                      this.addToolToToolset(toolset, 'deny', value);
                      e.target.value = '';
                    }
                  }}>
                    <option value="">+ Add denied tool</option>
                    ${availableDenyOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`)}
                  </select>
                  <div class="tag-list">
                    ${this.normalizeToolNameList(toolset.deny).map((toolId: string) => html`
                      <div class="tag">
                        ${this.renderToolLabel(toolId)}
                        <span class="tag-remove" @click=${() => this.removeToolFromToolset(toolset, 'deny', toolId)}>×</span>
                      </div>
                    `)}
                  </div>
                </div>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }


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
            <button class="btn btn-ghost" @click=${() => this.addAgent()}>+ Add Agent</button>
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

    const endpoints = this.getSortedConfigEndpoints();
    const subagents = this.ensureSubagentsConfig(agent);
    const agentTemplateFiles = this.ensureEditingAgentTemplateFiles();
    const agentIdValidationError = this.getEditingAgentValidationError();
    const editorWorkspaceAgentId = this.normalizeAgentId(this.editingAgentInitialDraft?.id || agent.id);
    const primaryWorkspace = this.editingAgentWorkspaceId ? this.getWorkspaceById(this.editingAgentWorkspaceId) : null;
    const workspaceOptions = this.getWorkspaceAssignmentOptions(editorWorkspaceAgentId);
    const accessibleSharedWorkspaces = primaryWorkspace?.mode === 'private'
      ? this.getWorkspaceSharedAccessIds(primaryWorkspace).map((workspaceId: string) => this.getWorkspaceById(workspaceId)).filter(Boolean)
      : [];
    const selectedEndpoint = this.resolveAgentEndpoint(agent);
    const effectiveEndpointKey = selectedEndpoint?.key || '';
    const endpointModelOptions = selectedEndpoint ? this.getEndpointModelOptions(selectedEndpoint) : [];
    const allowedAgentChoices = this.getAllowedAgentChoices(agent.id);
    const selectedAllowedAgents = Array.isArray(subagents.allowAgents) ? subagents.allowAgents : (subagents.allowAgents = []);
    const candidateModelRefs = Array.isArray(agent.candidateModelRefs) ? agent.candidateModelRefs : (agent.candidateModelRefs = []);
    const toolsetKeys = this.ensureAgentToolsetKeys(agent);
    const appliedToolsets = this.getAgentAppliedToolsets(agent);
    const effectiveToolState = this.getEffectiveAgentToolState(agent);
    const directToolOverrides = this.normalizeAgentToolOverrides(agent) || { allow: [], deny: [] };
    const directAllowedTools = this.normalizeToolNameList(directToolOverrides.allow);
    const directDeniedTools = this.normalizeToolNameList(directToolOverrides.deny);
    const availableAgentToolsets = this.getToolsetsList().filter((toolset: any) => toolset.key !== 'minimal' && !toolsetKeys.includes(toolset.key));
    const availableDirectAllowOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !directAllowedTools.includes(option.id));
    const availableDirectDenyOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !directDeniedTools.includes(option.id));
    const sandboxModeOverride = typeof agent.sandboxMode === 'string' ? agent.sandboxMode : '';
    const thinkingDefault = this.normalizeThinkingDefault(agent.thinkingDefault);
    const toolChoiceDefault = this.getConfiguredToolChoice(agent);
    const forceSandboxOff = sandboxModeOverride === 'off';
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

            ${telegramRoutesForAgent.length > 0 ? html`
              <div class="card" style="margin-bottom: 20px; border-color: #5c6bc0;">
                <div class="card-header">
                  <h3>Telegram Routing</h3>
                  <span class="badge">Inbound</span>
                </div>
                <div class="help-text" style="margin-top: 0; margin-bottom: 10px;">This agent is currently the managed Telegram target for:</div>
                ${telegramRoutesForAgent.map((route: any) => html`
                  <div class="applied-toolset-card" style="margin-bottom: 10px;">
                    <div class="applied-toolset-header">
                      <strong>${String(route?.accountId || this.getDefaultTelegramAccountId())}</strong>
                      <span class="badge">Telegram</span>
                    </div>
                    <div class="toolset-preview-rows">
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Route</div>
                          <div class="toolset-preview-tags">
                          ${String(route?.matchType || '').toLowerCase() === 'trusted-dms' ? html`<div class="tag">Trusted DMs</div>` : ''}
                          ${String(route?.matchType || '').toLowerCase() === 'trusted-groups' ? html`<div class="tag">Trusted Groups</div>` : ''}
                          ${String(route?.matchType || '').toLowerCase() === 'group' ? html`<div class="tag">Group ${route?.peerId || '(missing id)'}</div>` : ''}
                          ${String(route?.matchType || '').toLowerCase() === 'direct' ? html`<div class="tag">DM ${route?.peerId || '(missing id)'}</div>` : ''}
                          ${!route?.matchType ? html`<div class="toolset-preview-empty">No inbound Telegram route details available.</div>` : ''}
                          </div>
                        </div>
                      </div>
                  </div>
                `)}
                <div class="help-text" style="margin-top: 8px;">Change these routes on <strong>Configuration -> Features -> Telegram</strong>.</div>
              </div>
            ` : ''}
            
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

            <div class="form-group">
                <label>Endpoint</label>
                <select @change=${(e: any) => {
                    const endpointKey = e.target.value || null;
                    this.setAgentEndpointAssignment(agent, endpointKey);
                    this.requestUpdate();
                }}>
                    <option value="">Select Endpoint</option>
                    ${endpoints.map((ep: any) => html`<option value=${ep.key} ?selected=${effectiveEndpointKey === ep.key}>${ep.key}</option>`)}
                </select>
            </div>

            <div class="grid-2">
                <div class="card" style="margin-bottom: 0;">
                    <div class="card-header"><h3>Home Workspace</h3></div>
                    <div class="help-text" style="margin-top: 0;">This is the agent's home base. OpenClaw uses the configured workspace path directly, so it does not need to match the agent ID.</div>
                    <select
                      .value=${primaryWorkspace?.id || ''}
                      style="margin-top: 10px;"
                      @change=${(e: any) => this.setEditingAgentWorkspaceSelection(e.target.value || null)}>
                      <option value="">No workspace assigned</option>
                      ${workspaceOptions.map((option: any) => html`
                        <option
                          value=${option.id}
                          ?selected=${primaryWorkspace?.id === option.id}
                          ?disabled=${option.disabled}>
                          ${option.disabled
                            ? `${option.label} - occupied by ${option.occupiedByLabel}`
                            : option.label}
                        </option>
                      `)}
                    </select>
                    <div class="help-text" style="margin-top: 10px;">This selection is saved with the rest of the agent editor changes when you save configuration.</div>
                    ${primaryWorkspace ? html`
                      <div class="help-text" style="margin-top: 10px;">${this.getWorkspaceHomeBaseDescription(primaryWorkspace)} at <code>${primaryWorkspace.path || '(unset path)'}</code>.</div>
                    ` : ''}
                    ${primaryWorkspace?.mode === 'private' && accessibleSharedWorkspaces.length > 0 ? html`
                      <div class="help-text" style="margin-top: 10px;">Shared collaboration access: ${accessibleSharedWorkspaces.map((workspace: any) => workspace.name || workspace.id).join(', ')}. Because this reaches beyond the private home base, the toolkit keeps sandbox off for this agent.</div>
                    ` : ''}
                    ${primaryWorkspace?.mode === 'private' && accessibleSharedWorkspaces.length === 0 ? html`
                      <div class="help-text" style="margin-top: 10px;">This private workspace currently has no shared collaboration workspaces attached, so the toolkit keeps the agent sandboxed to the home base.</div>
                    ` : ''}
                    ${primaryWorkspace?.mode === 'shared' ? html`
                      <div class="help-text" style="margin-top: 10px;">Shared workspaces are collaboration areas rather than private boundaries, so the toolkit keeps sandbox off for agents living here.</div>
                    ` : ''}
                    <div style="margin-top: 12px;">
                      <button class="btn btn-ghost" @click=${() => { this.editingWorkspaceId = primaryWorkspace?.id || null; this.configSection = 'workspaces'; }}>Open Workspaces Tab</button>
                    </div>
                </div>
                <div class="card" style="margin-bottom: 0;">
                    <div class="card-header"><h3>Sandbox Mode</h3></div>
                    <label class="toggle-switch">
                        <input type="checkbox" ?checked=${forceSandboxOff} @change=${(e: any) => {
                            if (e.target.checked) {
                                agent.sandboxMode = 'off';
                            } else {
                                delete agent.sandboxMode;
                            }
                            this.requestUpdate();
                        }}>
                        Force sandbox off for this agent
                    </label>
                    <div class="help-text">Turn this off to use the global sandbox default instead of an explicit agent override.</div>
                    ${sandboxModeOverride && sandboxModeOverride !== 'off'
                      ? html`<div class="help-text" style="color: #ff9800;">This agent currently has custom sandbox mode "${sandboxModeOverride}". Using the toggle will replace that custom mode with the toolkit's off/default behavior.</div>`
                      : ''}
                </div>
            </div>

            <div class="grid-2">
                <div class="form-group">
                    <label>Primary Model</label>
                    <select ?disabled=${!selectedEndpoint || endpointModelOptions.length === 0} @change=${(e: any) => {
                        agent.modelRef = e.target.value;
                        this.syncAgentModelSource(agent);
                        this.requestUpdate();
                    }}>
                        <option value="">${selectedEndpoint ? 'Select Endpoint Model' : 'Choose an endpoint first'}</option>
                        ${endpointModelOptions.map((option: any) => html`
                            <option value=${option.ref} ?selected=${agent.modelRef === option.ref}>${option.kind === 'local' ? '[Local]' : '[Hosted]'} ${option.label}</option>
                        `)}
                    </select>
                    ${selectedEndpoint && endpointModelOptions.length === 0 ? html`<p style="color: #f44336; font-size: 0.7rem; margin-top: 4px;">This endpoint has no models configured yet. Add local or hosted models on the Endpoints tab first.</p>` : ''}
                    ${selectedEndpoint && endpointModelOptions.length > 0 ? html`<p style="color: #888; font-size: 0.75rem; margin-top: 4px;">Primary and candidate models are limited to the currently selected endpoint.</p>` : ''}
                </div>
                <div class="form-group">
                    <label>Default Thinking</label>
                    <select @change=${(e: any) => {
                        agent.thinkingDefault = this.normalizeThinkingDefault(e.target.value);
                        this.requestUpdate();
                    }}>
                        ${THINKING_LEVEL_OPTIONS.map((level) => html`
                            <option value=${level} ?selected=${thinkingDefault === level}>${level}</option>
                        `)}
                    </select>
                    <div class="help-text">Managed toolkit agents default to <code>high</code> instead of OpenClaw's normal <code>low</code>. Use <code>adaptive</code> for providers that support provider-managed thinking.</div>
                </div>
            </div>

            <div class="form-group">
                <label>Tool Use</label>
                <select .value=${toolChoiceDefault} @change=${(e: any) => this.setConfiguredToolChoice(agent, e.target.value)}>
                    <option value="">Default</option>
                    <option value="auto">Auto</option>
                    <option value="required">Required</option>
                    <option value="none">None</option>
                </select>
                <div class="help-text">This writes to the agent's OpenClaw <code>params.toolChoice</code>. Use <code>required</code> only for tool-first specialists because it can be too strict for agents that also need to answer normally.</div>
            </div>

            <div class="card" style="margin-top: 20px; margin-bottom: 20px;">
                <div class="card-header"><h3>Subagents</h3></div>
                <div class="form-group">
                    <label class="toggle-switch">
                        <input type="checkbox" ?checked=${!!subagents.enabled} @change=${(e: any) => {
                            subagents.enabled = e.target.checked;
                            this.requestUpdate();
                        }}>
                        Enable spawning subagents from this agent
                    </label>
                </div>
                <div class="form-group">
                    <label class="toggle-switch">
                        <input type="checkbox" ?checked=${!!subagents.requireAgentId} @change=${(e: any) => { subagents.requireAgentId = e.target.checked; this.requestUpdate(); }}>
                        Require explicit agent ID when spawning subagents
                    </label>
                </div>
                <div class="form-group">
                    <label>Allowed Agent IDs</label>
                    <div class="tag-list">
                        ${selectedAllowedAgents.map((agentId: string, idx: number) => html`
                            <div class="tag">
                                ${agentId}
                                <span class="tag-remove" @click=${() => {
                                    selectedAllowedAgents.splice(idx, 1);
                                    this.requestUpdate();
                                }}>×</span>
                            </div>
                        `)}
                    </div>
                    <div style="margin-top: 10px;">
                        <select @change=${(e: any) => {
                            const value = e.target.value;
                            if (value && !selectedAllowedAgents.includes(value)) {
                                selectedAllowedAgents.push(value);
                                this.requestUpdate();
                            }
                            e.target.value = '';
                        }}>
                            <option value="">${allowedAgentChoices.length === 0 ? 'No other configured agents available' : '+ Add Allowed Agent'}</option>
                            ${allowedAgentChoices
                                .filter((choice: any) => !selectedAllowedAgents.includes(choice.id))
                                .map((choice: any) => html`<option value=${choice.id}>${choice.label}</option>`)}
                        </select>
                    </div>
                    <p style="color: #888; font-size: 0.75rem; margin-top: 6px;">Leave the list empty to keep the toolkit defaults.</p>
                </div>
            </div>

            <div class="form-group">
                <label>Candidate Models</label>
                <div class="tag-list">
                    ${(agent.candidateModelRefs || []).map((ref: string, idx: number) => html`
                        <div class="tag">
                            ${ref}
                            <span class="tag-remove" @click=${() => { agent.candidateModelRefs.splice(idx, 1); this.requestUpdate(); }}>×</span>
                        </div>
                    `)}
                </div>
                <div style="margin-top: 10px;">
                    <select ?disabled=${!selectedEndpoint || endpointModelOptions.length === 0} @change=${(e: any) => {
                        const value = e.target.value;
                        if (value) {
                            if (!agent.candidateModelRefs) agent.candidateModelRefs = [];
                            if (!agent.candidateModelRefs.includes(value)) {
                                agent.candidateModelRefs.push(value);
                                this.syncAgentModelSource(agent);
                                this.requestUpdate();
                            }
                            e.target.value = '';
                        }
                    }}>
                        <option value="">${selectedEndpoint ? '+ Add Endpoint Model' : 'Choose an endpoint first'}</option>
                        ${endpointModelOptions
                            .filter((option: any) => !candidateModelRefs.includes(option.ref))
                            .map((option: any) => html`<option value=${option.ref}>${option.kind === 'local' ? '[Local]' : '[Hosted]'} ${option.label}</option>`)}
                    </select>
                </div>
            </div>

            <div class="card" style="margin-top: 20px; margin-bottom: 20px;">
                <div class="card-header"><h3>Toolsets</h3></div>
                <div class="help-text" style="margin-top: 0; margin-bottom: 14px;">The global <code>minimal</code> toolset is always applied first. Toolsets lower in the list win when the same tool is both allowed and denied.</div>

                <div class="form-group">
                    <label>Applied Toolsets</label>
                    <div class="applied-toolset-list">
                        ${appliedToolsets.map((toolset: any) => {
                          const isMinimal = toolset.key === 'minimal';
                          const agentToolsetIndex = isMinimal ? -1 : toolsetKeys.indexOf(toolset.key);
                          const allowedTools = this.normalizeToolNameList(toolset.allow);
                          const deniedTools = this.normalizeToolNameList(toolset.deny);
                          return html`
                            <div class="applied-toolset-card">
                              <div class="applied-toolset-header">
                                <strong>${toolset.name || toolset.key}</strong>
                                ${isMinimal ? html`<span class="badge">Global</span>` : ''}
                                ${!isMinimal ? html`
                                  <button class="btn btn-ghost" style="padding: 2px 6px;" ?disabled=${agentToolsetIndex <= 0} @click=${() => this.moveAgentToolset(agent, agentToolsetIndex, -1)}>Up</button>
                                  <button class="btn btn-ghost" style="padding: 2px 6px;" ?disabled=${agentToolsetIndex < 0 || agentToolsetIndex >= toolsetKeys.length - 1} @click=${() => this.moveAgentToolset(agent, agentToolsetIndex, 1)}>Down</button>
                                  <button class="btn btn-danger" style="padding: 2px 6px;" @click=${() => { agent.toolsetKeys.splice(agentToolsetIndex, 1); this.requestUpdate(); }}>Remove</button>
                                ` : ''}
                              </div>
                              <div class="toolset-preview-rows">
                                <div class="toolset-preview-row">
                                  <div class="toolset-preview-label">Allow</div>
                                  ${allowedTools.length === 0
                                    ? html`<div class="toolset-preview-empty">No allowed tools.</div>`
                                    : html`
                                      <div class="toolset-preview-tags">
                                        ${allowedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                                      </div>
                                    `}
                                </div>
                                <div class="toolset-preview-row">
                                  <div class="toolset-preview-label">Deny</div>
                                  ${deniedTools.length === 0
                                    ? html`<div class="toolset-preview-empty">No denied tools.</div>`
                                    : html`
                                      <div class="toolset-preview-tags">
                                        ${deniedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                                      </div>
                                    `}
                                </div>
                              </div>
                            </div>
                          `;
                        })}
                    </div>
                    <div style="margin-top: 10px;">
                        <select @change=${(e: any) => {
                          const value = e.target.value;
                          if (value) {
                            this.addAgentToolset(agent, value);
                            e.target.value = '';
                          }
                        }}>
                            <option value="">${availableAgentToolsets.length === 0 ? 'No other toolsets available' : '+ Add toolset'}</option>
                            ${availableAgentToolsets.map((toolset: any) => html`
                              <option value=${toolset.key}>${toolset.name || toolset.key} - ${this.getToolsetPreviewText(toolset)}</option>
                            `)}
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label>Direct Tool Overrides</label>
                    <div class="applied-toolset-card">
                      <div class="applied-toolset-header">
                        <strong>Direct Tool Overrides</strong>
                        <span class="badge">Final Layer</span>
                      </div>
                      <div class="toolset-preview-rows">
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Allow</div>
                          ${directAllowedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No direct allow overrides.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${directAllowedTools.map((toolId: string) => html`
                                  <div class="tag">
                                    ${this.renderToolLabel(toolId)}
                                    <span class="tag-remove" @click=${() => this.removeAgentToolOverride(agent, 'allow', toolId)}>×</span>
                                  </div>
                                `)}
                              </div>
                            `}
                          <div style="margin-top: 6px;">
                            <select @change=${(e: any) => {
                              const value = e.target.value;
                              if (value) {
                                this.addAgentToolOverride(agent, 'allow', value);
                                e.target.value = '';
                              }
                            }}>
                              <option value="">+ Add allowed tool override</option>
                              ${availableDirectAllowOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`)}
                            </select>
                          </div>
                        </div>
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Deny</div>
                          ${directDeniedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No direct deny overrides.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${directDeniedTools.map((toolId: string) => html`
                                  <div class="tag">
                                    ${this.renderToolLabel(toolId)}
                                    <span class="tag-remove" @click=${() => this.removeAgentToolOverride(agent, 'deny', toolId)}>×</span>
                                  </div>
                                `)}
                              </div>
                            `}
                          <div style="margin-top: 6px;">
                            <select @change=${(e: any) => {
                              const value = e.target.value;
                              if (value) {
                                this.addAgentToolOverride(agent, 'deny', value);
                                e.target.value = '';
                              }
                            }}>
                              <option value="">+ Add denied tool override</option>
                              ${availableDirectDenyOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`)}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="help-text" style="margin-top: 8px;">These direct per-agent tool picks merge after all applied toolsets, so they are the easiest way to make one-off tweaks.</div>
                </div>

                <div class="form-group">
                    <label>Combined Toolset</label>
                    <div class="applied-toolset-card">
                      <div class="applied-toolset-header">
                        <strong>Combined Toolset</strong>
                        <span class="badge">Final</span>
                      </div>
                      <div class="toolset-preview-rows">
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Allow</div>
                          ${effectiveToolState.allowedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No tools allowed yet.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${effectiveToolState.allowedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                              </div>
                            `}
                        </div>
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Deny</div>
                          ${effectiveToolState.deniedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No explicit denies.</div>`
                            : html`
                              <div class="toolset-preview-tags">
                                ${effectiveToolState.deniedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}
                              </div>
                            `}
                        </div>
                      </div>
                    </div>
                </div>

                ${effectiveToolState.explicitTools ? html`
                  <div class="help-text" style="margin-top: 0;">This agent also has a raw <code>tools</code> block in config. Those direct OpenClaw overrides still apply after the combined toolkit toolset shown above.</div>
                ` : ''}
            </div>

            <div class="card" style="margin-top: 20px; margin-bottom: 20px;">
                <div class="card-header"><h3>Agent Bootstrap Markdown</h3></div>
                <p class="help-text">Custom markdown for this agent is stored in <code>openclaw-toolkit\\agents\\${agent.id || 'agent-id'}\\bootstrap\\</code>. Shared templates come from <code>openclaw-toolkit\\markdown-templates\\agents\\&lt;TYPE&gt;\\</code>. The selected effective files are copied into <code>.openclaw\\agents\\${agent.id || 'agent-id'}\\bootstrap\\</code> as agent-specific bootstrap overlays. Root workspace starter files such as <code>AGENTS.md</code>, <code>SOUL.md</code>, <code>TOOLS.md</code>, <code>IDENTITY.md</code>, <code>USER.md</code>, and <code>HEARTBEAT.md</code> are seeded by OpenClaw itself. <code>MEMORY.md</code> is optional and not first-run seeded. <code>DREAMS.md</code> is agent-maintained by OpenClaw's memory system and is not configured here.</p>
                ${VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES.map((fileName) => {
                    const selectedTemplateKey = this.getMarkdownTemplateSelection(agent, fileName, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
                    const templateKeys = this.getMarkdownTemplateKeys('agents', fileName);
                    const isTemplateMode = selectedTemplateKey.length > 0;
                    const effectiveValue = isTemplateMode
                      ? this.getMarkdownTemplateContent('agents', fileName, selectedTemplateKey)
                      : (agentTemplateFiles[fileName] || '');
                    return html`
                      <div class="form-group">
                          <label>${fileName}</label>
                          <div class="help-text" style="margin-top: 0; margin-bottom: 6px;">${this.getMarkdownFileHelpText(fileName, 'agent')}</div>
                          <select style="margin-bottom: 8px;" @change=${(e: any) => {
                              const value = e.target.value;
                              this.setMarkdownTemplateSelection(agent, fileName, value || null, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
                              this.requestUpdate();
                          }}>
                              <option value="">Custom markdown</option>
                              ${templateKeys.map((templateKey) => html`<option value=${templateKey} ?selected=${selectedTemplateKey === templateKey}>Template: ${templateKey}</option>`)}
                          </select>
                          ${isTemplateMode ? html`<div class="help-text" style="margin-top: 0; margin-bottom: 6px;">Using template <code>${selectedTemplateKey}</code>. Switch to Custom markdown to edit agent-specific content without changing the shared template.</div>` : ''}
                          <textarea rows=${this.getMarkdownEditorRows(fileName)} .value=${effectiveValue} ?readonly=${isTemplateMode} placeholder=${isTemplateMode ? '' : this.buildAgentBootstrapPlaceholder(agent, fileName)} @input=${(e: any) => {
                              if (!isTemplateMode) {
                                agentTemplateFiles[fileName] = e.target.value;
                                this.requestUpdate();
                              }
                          }}></textarea>
                      </div>
                    `;
                })}
            </div>
        </div>
    `;
  }


  renderFeaturesConfig() {
      return html`
        <div class="tabs">
          <div class="tab ${this.featureSubsection === 'telegram' ? 'active' : ''}" @click=${() => this.featureSubsection = 'telegram'}>Telegram</div>
          <div class="tab ${this.featureSubsection === 'voice' ? 'active' : ''}" @click=${() => this.featureSubsection = 'voice'}>Voice</div>
        </div>
        ${this.featureSubsection === 'telegram'
          ? this.renderTelegramFeaturesConfig()
          : this.renderVoiceFeaturesConfig()}
      `;
  }


  renderWorkspacesConfig() {
    if (this.editingWorkspaceId) {
      return this.renderWorkspaceEditor(this.editingWorkspaceId);
    }

    const workspaces = this.getWorkspaces();
    return html`
      <div class="card">
        <div class="card-header">
          <h3>Workspaces</h3>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-ghost" @click=${() => this.addWorkspace('shared')}>+ Shared Workspace</button>
            <button class="btn btn-ghost" @click=${() => this.addWorkspace('private')}>+ Private Workspace</button>
          </div>
        </div>
        <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Workspaces define the agent home base. Shared workspaces can host many agents and are collaboration areas. Private workspaces host one agent, act as the privacy boundary, and can optionally expose specific shared collaboration workspaces.</p>
        ${workspaces.map((workspace: any) => {
          const occupantIds = this.getWorkspaceAgentIds(workspace);
          const occupants = this.getManagedAgentEntries().filter(({ agent }: any) => occupantIds.includes(String(agent?.id || '')));
          const sharedAccessLabels = workspace.mode === 'private'
            ? this.getWorkspaceSharedAccessIds(workspace)
                .map((workspaceId: string) => this.getWorkspaceById(workspaceId))
                .filter(Boolean)
                .map((candidate: any) => candidate.name || candidate.id)
            : [];
          return html`
            <div class="item-row">
              <div class="item-info">
                <span class="item-title">${workspace.name || workspace.id}</span>
                <span class="item-sub">
                  ID: ${workspace.id} | Mode: ${workspace.mode} | Home Base Path: ${workspace.path || '(unset)'} | Occupants: ${occupants.length > 0 ? occupants.map(({ agent }: any) => agent.name || agent.id).join(', ') : 'none'}
                  ${workspace.mode === 'private' ? ` | Shared access: ${sharedAccessLabels.length > 0 ? sharedAccessLabels.join(', ') : 'none'}` : ''}
                </span>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="btn btn-secondary" @click=${() => this.editingWorkspaceId = workspace.id}>Configure</button>
                <button class="btn btn-danger" @click=${() => this.removeWorkspaceById(workspace.id)}>Remove</button>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }


  renderWorkspaceEditor(workspaceId: string) {
    const workspace = this.getWorkspaceById(workspaceId);
    if (!workspace) return html`Workspace not found`;

    const previousWorkspaceId = String(workspace?.id || '');
    const occupantIds = this.getWorkspaceAgentIds(workspace);
    const occupantEntries = this.getManagedAgentEntries().filter(({ agent }: any) => occupantIds.includes(String(agent?.id || '')));
    const sharedWorkspaces = this.getSharedWorkspaces().filter((candidate: any) => candidate.id !== workspace.id);
    const availableAgents = this.getManagedAgentEntries().filter(({ agent }: any) => {
      const agentId = String(agent?.id || '');
      const assignedWorkspace = this.getWorkspaceForAgentId(agentId);
      return agentId.length > 0 && (!assignedWorkspace || assignedWorkspace.id === workspace.id);
    });
    const selectedSharedAccessIds = this.getWorkspaceSharedAccessIds(workspace);

    return html`
        <div class="card">
          <div class="card-header">
            <h3>Workspace: ${workspace.name || workspace.id}</h3>
            <button class="btn btn-ghost" @click=${() => this.editingWorkspaceId = null}>Back to Workspaces</button>
          </div>

        <div class="card" style="margin-bottom: 20px; border-color: ${workspace.mode === 'private' ? '#90caf9' : '#81c784'};">
          <div class="card-header"><h3>Home Base Rules</h3></div>
          <div class="help-text" style="margin-top: 0;">
            <strong>${workspace.mode === 'private' ? 'Private workspace' : 'Shared workspace'}:</strong>
            ${workspace.mode === 'private'
              ? 'this is the agent home base and privacy boundary. With no shared access attached, the toolkit forces sandbox on with workspace-write mode.'
              : 'this is a collaboration area, not a private boundary. The toolkit forces sandbox off for agents who live here so they can work beyond a single private home-base path.'}
          </div>
          <div class="help-text" style="margin-top: 10px;">
            OpenClaw uses the exact configured workspace path directly. It does not require the private workspace name or path to match the agent ID.
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label>Workspace Name</label>
            <input type="text" .value=${workspace.name || ''} @input=${(e: any) => { workspace.name = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Workspace ID</label>
            <input type="text" .value=${workspace.id || ''} @input=${(e: any) => {
              const nextId = e.target.value;
              this.renameWorkspaceIdEverywhere(previousWorkspaceId, nextId);
              workspace.id = nextId;
              this.requestUpdate();
            }}>
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label>Workspace Mode</label>
            <select @change=${(e: any) => {
              const nextMode = e.target.value === 'private' ? 'private' : 'shared';
              if (nextMode === 'private' && workspace.mode !== 'private' && this.getWorkspaceAgentIds(workspace).length > 1) {
                alert('A private workspace can only host one primary agent. Move the extra agents to other workspaces first.');
                e.target.value = workspace.mode;
                return;
              }
              workspace.mode = nextMode;
              if (workspace.mode === 'shared') {
                workspace.sharedWorkspaceIds = [];
              } else if (!Array.isArray(workspace.sharedWorkspaceIds)) {
                workspace.sharedWorkspaceIds = [];
              }
              this.normalizeWorkspaceAssignments(this.config);
              const messages = occupantEntries
                .map(({ agent }: any) => this.enforceWorkspaceSandboxPolicy(agent, workspace))
                .filter((message: string) => message.length > 0);
              if (messages.length > 0) {
                alert(messages.join('\n\n'));
              }
              this.requestUpdate();
            }}>
              <option value="shared" ?selected=${workspace.mode === 'shared'}>shared</option>
              <option value="private" ?selected=${workspace.mode === 'private'}>private</option>
            </select>
          </div>
          <div class="form-group">
            <label>${workspace.mode === 'private' ? 'Home Workspace Path' : 'Shared Workspace Path'}</label>
            <input type="text" .value=${workspace.path || ''} @input=${(e: any) => { workspace.path = e.target.value; this.requestUpdate(); }}>
            <div class="help-text">This exact path becomes the workspace home base path used by OpenClaw. It can be any valid path; it does not need to match the agent name.</div>
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${!!workspace.enableAgentToAgent} @change=${(e: any) => { workspace.enableAgentToAgent = e.target.checked; this.requestUpdate(); }}>
              Enable agent-to-agent tool in this workspace
            </label>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${!!workspace.manageWorkspaceAgentsMd} @change=${(e: any) => { workspace.manageWorkspaceAgentsMd = e.target.checked; this.requestUpdate(); }}>
              Manage workspace markdown files
            </label>
            <div class="help-text">Workspace markdown lives under <code>openclaw-toolkit\\workspaces\\${workspace.id || '&lt;workspaceId&gt;'}\\markdown\\</code>.</div>
          </div>
        </div>

        ${workspace.mode === 'shared' ? html`
          <div class="form-group">
            <label>Primary Agents in this Shared Workspace</label>
            <div class="help-text" style="margin-bottom: 10px;">Assigning an agent here makes this shared workspace the agent's home base and forces sandbox off so collaboration is not blocked by a private workspace restriction.</div>
            <div class="tag-list">
              ${occupantEntries.map(({ agent }: any) => html`
                <div class="tag">
                  ${agent.name || agent.id}
                  <span class="tag-remove" @click=${() => this.setAgentPrimaryWorkspace(agent.id, null)}>×</span>
                </div>
              `)}
            </div>
            <div style="margin-top: 10px;">
              <select @change=${(e: any) => {
                const agentId = e.target.value;
                if (agentId) {
                  this.setAgentPrimaryWorkspace(agentId, workspace.id);
                }
                e.target.value = '';
              }}>
                <option value="">${availableAgents.length === 0 ? 'No unassigned agents available' : '+ Add Agent to Shared Workspace'}</option>
                ${availableAgents
                  .filter(({ agent }: any) => !occupantIds.includes(String(agent?.id || '')))
                  .map(({ agent }: any) => html`<option value=${agent.id}>${agent.name || agent.id}</option>`)}
              </select>
            </div>
          </div>
        ` : html`
          <div class="grid-2">
            <div class="form-group">
              <label>Primary Agent in this Private Workspace</label>
              <select @change=${(e: any) => {
                const agentId = e.target.value;
                if (agentId) {
                  this.setAgentPrimaryWorkspace(agentId, workspace.id);
                } else {
                  workspace.agents = [];
                  this.requestUpdate();
                }
              }}>
                <option value="">No primary agent assigned</option>
                ${availableAgents.map(({ agent }: any) => html`
                  <option value=${agent.id} ?selected=${occupantIds.includes(String(agent?.id || ''))}>${agent.name || agent.id}</option>
                `)}
              </select>
              <div class="help-text">A private workspace can host only one primary agent at a time. If that agent was previously sandbox-off, the toolkit turns sandbox back on with workspace-write mode unless shared collaboration access is attached below.</div>
            </div>
            <div class="form-group">
              <label>Shared Workspaces Accessible from this Private Workspace</label>
              <div class="help-text" style="margin-bottom: 10px;">Granting shared collaboration access means the agent must reach paths outside its private home base, so the toolkit will turn sandbox off for the occupying agent.</div>
              <div class="tag-list">
                ${selectedSharedAccessIds.map((sharedWorkspaceId: string) => {
                  const sharedWorkspace = this.getWorkspaceById(sharedWorkspaceId);
                  if (!sharedWorkspace) return null;
                  return html`
                    <div class="tag">
                      ${sharedWorkspace.name || sharedWorkspace.id}
                      <span class="tag-remove" @click=${() => {
                        this.setWorkspaceSharedAccess(workspace, selectedSharedAccessIds.filter((candidateId: string) => candidateId !== sharedWorkspaceId));
                      }}>×</span>
                    </div>
                  `;
                })}
              </div>
              <div style="margin-top: 10px;">
                <select @change=${(e: any) => {
                  const selectedId = e.target.value;
                  if (selectedId && !selectedSharedAccessIds.includes(selectedId)) {
                    this.setWorkspaceSharedAccess(workspace, [...selectedSharedAccessIds, selectedId]);
                  }
                  e.target.value = '';
                }}>
                  <option value="">${sharedWorkspaces.length === 0 ? 'No shared workspaces available' : '+ Grant Shared Workspace Access'}</option>
                  ${sharedWorkspaces
                    .filter((candidate: any) => !selectedSharedAccessIds.includes(String(candidate?.id || '')))
                    .map((candidate: any) => html`<option value=${candidate.id}>${candidate.name || candidate.id}</option>`)}
                </select>
              </div>
            </div>
          </div>
        `}

        <div class="card" style="margin-top: 20px;">
          <div class="card-header"><h3>Workspace Markdown</h3></div>
          <p class="help-text">Custom markdown for this workspace is stored in <code>openclaw-toolkit\\workspaces\\${workspace.id || '&lt;workspaceId&gt;'}\\markdown\\</code>. Shared templates come from <code>openclaw-toolkit\\markdown-templates\\workspaces\\&lt;TYPE&gt;\\</code>. The toolkit now asks OpenClaw itself to seed the standard starter files for each managed workspace, then applies any custom workspace markdown on top. <code>MEMORY.md</code> is optional and not first-run seeded. <code>DREAMS.md</code> is agent-maintained by the memory system and is not edited here. <code>BOOT.md</code> is a toolkit startup checklist. <code>BOOTSTRAP.md</code> is a one-time first-run ritual and is only seeded when the workspace is brand new or the live file still exists.</p>
          ${VALID_WORKSPACE_MARKDOWN_FILES.map((fileName) => {
            const selectedTemplateKey = this.getMarkdownTemplateSelection(workspace, fileName, VALID_WORKSPACE_MARKDOWN_FILES);
            const templateKeys = this.getMarkdownTemplateKeys('workspaces', fileName);
            const isTemplateMode = selectedTemplateKey.length > 0;
            const workspaceFiles = this.ensureWorkspaceTemplateFiles(workspace);
            const effectiveValue = isTemplateMode
              ? this.getMarkdownTemplateContent('workspaces', fileName, selectedTemplateKey)
              : (workspaceFiles[fileName] || '');
            return html`
              <div class="form-group" style="margin-bottom: 20px;">
                <label>${fileName}</label>
                <div class="help-text" style="margin-top: 0; margin-bottom: 6px;">${this.getMarkdownFileHelpText(fileName, 'workspace')}</div>
                <select style="margin-bottom: 8px;" @change=${(e: any) => {
                  const value = e.target.value;
                  this.setMarkdownTemplateSelection(workspace, fileName, value || null, VALID_WORKSPACE_MARKDOWN_FILES);
                  this.requestUpdate();
                }}>
                  <option value="">Custom markdown</option>
                  ${templateKeys.map((templateKey) => html`<option value=${templateKey} ?selected=${selectedTemplateKey === templateKey}>Template: ${templateKey}</option>`)}
                </select>
                ${isTemplateMode ? html`<div class="help-text" style="margin-top: 0; margin-bottom: 6px;">Using template <code>${selectedTemplateKey}</code>. Switch to Custom markdown to edit workspace-specific content without changing the shared template.</div>` : ''}
                <textarea rows=${this.getMarkdownEditorRows(fileName)} .value=${effectiveValue} ?readonly=${isTemplateMode} placeholder=${isTemplateMode ? '' : this.buildWorkspaceBootstrapPlaceholder(workspace, fileName)} @input=${(e: any) => {
                  if (!isTemplateMode) {
                    workspaceFiles[fileName] = e.target.value;
                    this.requestUpdate();
                  }
                }}></textarea>
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  // Helpers

  };
