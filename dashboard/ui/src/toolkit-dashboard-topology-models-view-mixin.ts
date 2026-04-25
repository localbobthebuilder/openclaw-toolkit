import { LitElement, html } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTopologyModelsViewMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTopologyModelsViewMixin extends Base {
    [key: string]: any;

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
  };
