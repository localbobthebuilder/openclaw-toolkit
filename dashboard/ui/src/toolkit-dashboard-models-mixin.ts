import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardModelsMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardModelsMixin extends Base {
    [key: string]: any;

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
