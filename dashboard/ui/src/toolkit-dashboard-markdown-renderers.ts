import { html } from 'lit';
import { renderCardSection, renderFormGroup, renderHelpText } from './toolkit-dashboard-ui-helpers';

type MarkdownTemplateLibraryParams = {
  title: string;
  intro: string;
  scope: string;
  fileNames: readonly string[];
  selectedFileName: string;
  templateKeys: string[];
  library: Record<string, string>;
  onAddTemplate: () => void;
  onSelectScope: (scope: string) => void;
  onSelectFile: (fileName: string) => void;
  onRemoveTemplate: (templateKey: string) => void;
  onUpdateTemplate: (templateKey: string, value: string) => void;
};

type MarkdownFileEditorsParams = {
  scopeLabel: string;
  intro: string;
  fileNames: readonly string[];
  getHelpText: (fileName: string) => string;
  getTemplateKeys: (fileName: string) => string[];
  getSelectedTemplateKey: (fileName: string) => string;
  getEffectiveValue: (fileName: string, selectedTemplateKey: string) => string;
  getPlaceholder: (fileName: string) => string;
  getRows: (fileName: string) => number;
  onSelectTemplate: (fileName: string, templateKey: string | null) => void;
  onUpdateFile: (fileName: string, value: string) => void;
};

function renderMarkdownFileEditor(params: {
  scopeLabel: string;
  fileName: string;
  helpText: string;
  templateKeys: string[];
  selectedTemplateKey: string;
  effectiveValue: string;
  placeholder: string;
  rows: number;
  isTemplateMode: boolean;
  onSelectTemplate: (templateKey: string | null) => void;
  onUpdateFile: (value: string) => void;
}) {
  return renderFormGroup({
    label: params.fileName,
    control: html`
      ${renderHelpText(params.helpText, 'margin-top: 0; margin-bottom: 6px;')}
      <select style="margin-bottom: 8px;" @change=${(e: any) => params.onSelectTemplate(e.target.value || null)}>
        <option value="">Custom markdown</option>
        ${params.templateKeys.map((templateKey) => html`<option value=${templateKey} ?selected=${params.selectedTemplateKey === templateKey}>Template: ${templateKey}</option>`)}
      </select>
      ${params.isTemplateMode ? html`<div class="help-text" style="margin-top: 0; margin-bottom: 6px;">Using template <code>${params.selectedTemplateKey}</code>. Switch to Custom markdown to edit ${params.scopeLabel}-specific content without changing the shared template.</div>` : ''}
      <textarea rows=${params.rows} .value=${params.effectiveValue} ?readonly=${params.isTemplateMode} placeholder=${params.isTemplateMode ? '' : params.placeholder} @input=${(e: any) => {
        if (!params.isTemplateMode) {
          params.onUpdateFile(e.target.value);
        }
      }}></textarea>
    `
  });
}

export function renderMarkdownTemplateLibrarySection(params: MarkdownTemplateLibraryParams) {
  return renderCardSection(params.title, html`
    <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">${params.intro}</p>
    <div class="markdown-library-tab-group">
      <div class="markdown-library-tab-group-label">Scope</div>
      <div class="markdown-library-scope-tabs">
        <button class="markdown-library-scope-tab ${params.scope === 'agents' ? 'active' : ''}" @click=${() => params.onSelectScope('agents')}>Agents</button>
        <button class="markdown-library-scope-tab ${params.scope === 'workspaces' ? 'active' : ''}" @click=${() => params.onSelectScope('workspaces')}>Workspaces</button>
      </div>
    </div>
    <div class="markdown-library-tab-group" style="margin-top: 18px;">
      <div class="markdown-library-tab-group-label">Template files</div>
      <div class="markdown-library-file-tabs">
      ${params.fileNames.map((fileName) => html`
        <button class="markdown-library-file-tab ${params.selectedFileName === fileName ? 'active' : ''}" @click=${() => params.onSelectFile(fileName)}>${fileName.replace('.md', '')}</button>
      `)}
      </div>
    </div>
    <p class="help-text" style="margin-bottom: 20px;">Stored under <code>openclaw-toolkit\\markdown-templates\\${params.scope}\\${params.selectedFileName.replace('.md', '')}\\&lt;key&gt;.md</code>.</p>
      ${params.templateKeys.length === 0 ? html`
      <div class="help-text">No templates defined for ${params.scope} ${params.selectedFileName} yet.</div>
    ` : params.templateKeys.map((templateKey) => html`
      <div class="form-group" style="margin-bottom: 25px; border-bottom: 1px solid #333; padding-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-weight: bold; color: #00bcd4;">${templateKey}</span>
          <button class="btn btn-danger btn-small" style="padding: 4px 10px;" @click=${() => params.onRemoveTemplate(templateKey)}>Delete Template</button>
        </div>
        <textarea rows="10" .value=${params.library[templateKey] || ''} @input=${(e: any) => params.onUpdateTemplate(templateKey, e.target.value)}></textarea>
      </div>
    `)}
  `, html`<button class="btn btn-primary" @click=${() => params.onAddTemplate()}>+ Add Template</button>`);
}

export function renderMarkdownFileEditors(params: MarkdownFileEditorsParams) {
  return html`
    <p class="help-text">${params.intro}</p>
    ${params.fileNames.map((fileName) => {
      const selectedTemplateKey = params.getSelectedTemplateKey(fileName);
      const templateKeys = params.getTemplateKeys(fileName);
      const isTemplateMode = selectedTemplateKey.length > 0;
      const effectiveValue = params.getEffectiveValue(fileName, selectedTemplateKey);
      return renderMarkdownFileEditor({
        scopeLabel: params.scopeLabel,
        fileName,
        helpText: params.getHelpText(fileName),
        templateKeys,
        selectedTemplateKey,
        effectiveValue,
        placeholder: params.getPlaceholder(fileName),
        rows: params.getRows(fileName),
        isTemplateMode,
        onSelectTemplate: (templateKey) => params.onSelectTemplate(fileName, templateKey),
        onUpdateFile: (value) => params.onUpdateFile(fileName, value)
      });
    })}
  `;
}
