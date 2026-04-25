import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardEndpointsMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardEndpointsMixin extends Base {
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

  };
