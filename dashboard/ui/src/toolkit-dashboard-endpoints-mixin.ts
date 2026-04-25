import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { renderModelCatalogConfig } from './toolkit-dashboard-model-catalog-renderer';
import { renderActionRow, renderFormGroup, renderHelpText, renderSelectableTagList, renderSectionHeader, renderSummaryRow, renderToggleField } from './toolkit-dashboard-ui-helpers';
import { ToolkitDashboardModelSelectorMixin } from './toolkit-dashboard-model-selector-mixin';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardEndpointsMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardEndpointsMixin extends ToolkitDashboardModelSelectorMixin(Base) {
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
                    ${renderToggleField({
                      label: 'Default endpoint',
                      checked: !!ep.default,
                      onChange: (checked) => {
                        if (checked) {
                          for (const endpoint of this.getConfigEndpoints()) {
                            endpoint.default = endpoint.key === ep.key;
                          }
                        } else {
                          ep.default = false;
                        }
                        this.requestUpdate();
                      }
                    })}
                </div>
                ${renderFormGroup({
                  label: 'Endpoint Role',
                  control: renderHelpText('The default endpoint is the main workbench the toolkit prefers first when an agent has not been moved elsewhere.', 'margin-top: 0;')
                })}
            </div>

            ${renderToggleField({
              label: 'This endpoint has a local Ollama runtime',
              checked: !!runtime,
              onChange: (checked) => {
                if (checked) {
                  this.ensureEndpointOllama(ep);
                } else {
                  delete ep.ollama;
                }
                this.requestUpdate();
              },
              groupStyle: 'margin-top: 16px;'
            })}

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
                    ${renderToggleField({
                      label: 'Auto-pull missing local models when they fit',
                      checked: !!runtime.autoPullMissingModels,
                      onChange: (checked) => {
                        runtime.autoPullMissingModels = checked;
                        this.requestUpdate();
                      }
                    })}
                </div>
                ${renderFormGroup({
                  label: 'Runtime Pull Behavior',
                  control: renderHelpText('When enabled, bootstrap can pull missing local models onto this machine if they fit the configured hardware budget.', 'margin-top: 0;')
                })}
            </div>

            ${renderFormGroup({
              label: 'Model Fit VRAM Headroom (MiB)',
              control: html`
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
              `,
              help: renderHelpText('Per-endpoint override for probe headroom. Leave blank to use global setting.')
            })}
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
  renderModelsConfig() {
    return renderModelCatalogConfig(this);
  }

  };
