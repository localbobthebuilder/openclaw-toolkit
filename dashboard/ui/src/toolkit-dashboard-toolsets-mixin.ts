import { LitElement, html } from 'lit';
import { AVAILABLE_TOOL_OPTIONS } from './toolkit-dashboard-constants';
import { renderToolLabel } from './toolkit-dashboard-ui-helpers';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardToolsetsMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardToolsetsMixin extends Base {
    [key: string]: any;

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

    renderToolsetsConfig() {
      const toolsets = this.getToolsetsList();

      return html`
        <div class="card">
          <div class="card-header">
            <h3>Toolsets</h3>
            <button class="btn btn-primary" @click=${() => this.addToolset()}>+ Add Toolset</button>
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
                      ${availableAllowOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`) }
                    </select>
                    <div class="tag-list">
                      ${this.normalizeToolNameList(toolset.allow).map((toolId: string) => html`
                        <div class="tag">
                          ${renderToolLabel(this.getToolOption(toolId), toolId)}
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
                      ${availableDenyOptions.map((option) => html`<option value=${option.id}>${this.getToolDisplayLabel(option.id)} - ${option.description}</option>`) }
                    </select>
                    <div class="tag-list">
                      ${this.normalizeToolNameList(toolset.deny).map((toolId: string) => html`
                        <div class="tag">
                          ${renderToolLabel(this.getToolOption(toolId), toolId)}
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
  };
