import { LitElement, html } from 'lit';
import { ToolkitDashboardEndpointsMixin } from './toolkit-dashboard-endpoints-mixin';
import { ToolkitDashboardModelsMixin } from './toolkit-dashboard-models-mixin';
import { ToolkitDashboardToolsetsMixin } from './toolkit-dashboard-toolsets-mixin';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardManagementMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardManagementMixin extends ToolkitDashboardToolsetsMixin(ToolkitDashboardModelsMixin(ToolkitDashboardEndpointsMixin(Base))) {
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
  };
