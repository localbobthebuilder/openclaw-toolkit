import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { renderModelCatalogConfig } from './toolkit-dashboard-model-catalog-renderer';
import { renderActionRow, renderHelpText, renderModalShell, renderSelectableItem, renderSelectableTagList, renderSectionHeader, renderSummaryRow } from './toolkit-dashboard-ui-helpers';

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
          return renderSummaryRow({
            title: html`${ep.key} ${ep.default ? html`<span class="badge" style="background: #ffc107;">Default</span>` : ''}`,
            subtitle: `${runtime?.hostBaseUrl || 'Hosted-only endpoint'} | ${this.getEndpointModels(ep).length} local, ${this.getEndpointHostedModels(ep).length} hosted | ${assignedAgentCount} assigned`,
            actions: html`
              <button class="btn btn-secondary" @click=${() => this.editingEndpointKey = ep.key}>Configure Endpoint</button>
              ${this.canRemoveEndpoint(ep) ? html`
                <button class="btn btn-danger" @click=${() => this.removeEndpointByKey(ep.key)}>Remove</button>
              ` : ''}
            `
          });
        })}
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
                    ${renderHelpText('The default endpoint is the main workbench the toolkit prefers first when an agent has not been moved elsewhere.', 'margin-top: 0;')}
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

            ${renderSectionHeader({
              title: 'Assigned Agents',
              intro: 'Endpoints now own agent placement. Agents listed here belong to this machine/workbench.',
              style: 'margin-top: 24px;'
            })}
            ${renderSelectableTagList(
              assignedAgents,
              ({ agent }: any) => html`
                <div class="tag">
                  ${agent.name ? `${agent.name} (${agent.id})` : agent.id}
                  <span class="tag-remove" @click=${() => {
                    this.setAgentEndpointAssignment(agent, null);
                    this.requestUpdate();
                  }}>×</span>
                </div>
              `,
              availableAgents.map(({ agent }: any) => ({
                value: agent.id,
                label: agent.name ? `${agent.name} (${agent.id})` : agent.id
              })),
              (agentId) => {
                const entry = this.getManagedAgentEntries().find((candidate: any) => String(candidate?.agent?.id || '') === agentId);
                if (entry) {
                  this.setAgentEndpointAssignment(entry.agent, ep.key);
                  this.requestUpdate();
                }
              },
              availableAgents.length === 0 ? 'All configured agents are already assigned' : '+ Add Agent to Endpoint',
              undefined,
              availableAgents.length === 0,
              'margin-top: 10px; margin-bottom: 20px;'
            )}

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
                    ${renderHelpText('When enabled, bootstrap can pull missing local models onto this machine if they fit the configured hardware budget.', 'margin-top: 0;')}
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
                ${renderHelpText('Per-endpoint override for probe headroom. Leave blank to use global setting.')}
              </div>
            ${renderSectionHeader({
              title: 'Local Runtime Models',
              intro: "Models listed here are desired on this machine's local runtime. Bootstrap will pull them when they fit the machine. When a model has fallbacks, both toolkit fit checks and OpenClaw runtime fallbacks follow the order shown here.",
              style: 'margin-top: 20px;'
            })}
             
            ${endpointModels.map((mo: any, idx: number) => html`
                ${renderActionRow({
                  title: mo.id,
                  subtitle: `Ctx: ${mo.contextWindow} | MaxTokens: ${mo.maxTokens || 8192}`,
                  content: endpointModels.length > 1 ? this.renderOrderedLocalFallbackEditor(mo, endpointModels.map((localModel: any) => localModel.id)) : '',
                  actions: html`
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                      <button class="btn btn-secondary" @click=${() => this.tuneExistingModel(ep.key, mo.id)}>Re-Tune</button>
                      <button class="btn btn-danger" @click=${() => { endpointModels.splice(idx, 1); this.requestUpdate(); }}>Remove</button>
                    </div>
                  `
                })}
            `)}

            <div style="margin-top: 20px;">
                <button class="btn btn-primary" @click=${() => { this.selectorTarget = 'tune'; this.showModelSelector = true; }}>+ Add Local Model from Catalog</button>
            </div>
            ` : html`
            <div class="item-sub" style="margin-top: 20px;">This endpoint is currently hosted-only. Enable the local runtime toggle above if this machine should run Ollama too.</div>
            `}

            ${renderSectionHeader({
              title: 'Hosted Models',
              intro: 'These are provider-backed models available from this endpoint, such as OpenAI, Claude, Gemini, Copilot, or Ollama Cloud refs. If the primary hosted model fails, OpenClaw tries the local fallbacks below in order.',
              style: 'margin-top: 24px;'
            })}

            ${endpointHostedModels.map((model: any, idx: number) => html`
                ${renderActionRow({
                  title: model.modelRef,
                  content: endpointModels.length > 0 ? this.renderOrderedLocalFallbackEditor(model, endpointModels.map((localModel: any) => localModel.id)) : '',
                  actions: html`
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                      <button class="btn btn-danger" @click=${() => { endpointHostedModels.splice(idx, 1); this.requestUpdate(); }}>Remove</button>
                    </div>
                  `
                })}
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
      return renderModalShell({
        title: this.selectorTarget === 'endpoint-hosted' ? 'Select Hosted Model from Catalog' : 'Select Local Model from Catalog',
        onClose: () => this.showModelSelector = false,
        body: html`
          ${models.length === 0 ? html`<div class="item-sub">No matching models are in the shared catalog yet.</div>` : ''}
          ${models.map((m: any) => renderSelectableItem({
            title: m.id || m.modelRef,
            subtitle: this.selectorTarget === 'endpoint-hosted' ? `Ref: ${m.modelRef}` : `ID: ${m.id}`,
            onClick: () => this.handleModelSelected(this.selectorTarget === 'endpoint-hosted' ? m.modelRef : m.id)
          }))}
        `
      });
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
    return renderModelCatalogConfig(this);
  }

  };
