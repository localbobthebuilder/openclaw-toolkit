import { LitElement, html } from 'lit';
import { renderModalShell, renderSelectableItem } from './toolkit-dashboard-ui-helpers';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardModelSelectorMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardModelSelectorMixin extends Base {
    [key: string]: any;

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
  };
