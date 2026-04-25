import { LitElement, html } from 'lit';
import { AVAILABLE_TOOL_OPTIONS } from './toolkit-dashboard-constants';
import { ToolkitDashboardEndpointsMixin } from './toolkit-dashboard-endpoints-mixin';
import { ToolkitDashboardModelsMixin } from './toolkit-dashboard-models-mixin';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardManagementMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardManagementMixin extends ToolkitDashboardModelsMixin(ToolkitDashboardEndpointsMixin(Base)) {
    [key: string]: any;

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
  };
