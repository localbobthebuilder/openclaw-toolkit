import { LitElement, html } from 'lit';
import { VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES } from './toolkit-dashboard-constants';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentBootstrapMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentBootstrapMixin extends Base {
    [key: string]: any;

    renderAgentBootstrapConfig(agent: any, agentTemplateFiles: Record<string, string>) {
      return html`
        <div class="card" style="margin-top: 20px; margin-bottom: 20px;">
          <div class="card-header"><h3>Agent Bootstrap Markdown</h3></div>
          <p class="help-text">Custom markdown for this agent is stored in <code>openclaw-toolkit\\agents\\${agent.id || 'agent-id'}\\bootstrap\\</code>. Shared templates come from <code>openclaw-toolkit\\markdown-templates\\agents\\&lt;TYPE&gt;\\</code>. The selected effective files are copied into <code>.openclaw\\agents\\${agent.id || 'agent-id'}\\bootstrap\\</code> as agent-specific bootstrap overlays. Root workspace starter files such as <code>AGENTS.md</code>, <code>SOUL.md</code>, <code>TOOLS.md</code>, <code>IDENTITY.md</code>, <code>USER.md</code>, and <code>HEARTBEAT.md</code> are seeded by OpenClaw itself. <code>MEMORY.md</code> is optional and not first-run seeded. <code>DREAMS.md</code> is agent-maintained by OpenClaw's memory system and is not configured here.</p>
          ${VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES.map((fileName) => {
            const selectedTemplateKey = this.getMarkdownTemplateSelection(agent, fileName, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
            const templateKeys = this.getMarkdownTemplateKeys('agents', fileName);
            const isTemplateMode = selectedTemplateKey.length > 0;
            const effectiveValue = isTemplateMode
              ? this.getMarkdownTemplateContent('agents', fileName, selectedTemplateKey)
              : (agentTemplateFiles[fileName] || '');
            return html`
              <div class="form-group">
                <label>${fileName}</label>
                <div class="help-text" style="margin-top: 0; margin-bottom: 6px;">${this.getMarkdownFileHelpText(fileName, 'agent')}</div>
                <select style="margin-bottom: 8px;" @change=${(e: any) => {
                  const value = e.target.value;
                  this.setMarkdownTemplateSelection(agent, fileName, value || null, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
                  this.requestUpdate();
                }}>
                  <option value="">Custom markdown</option>
                  ${templateKeys.map((templateKey: string) => html`<option value=${templateKey} ?selected=${selectedTemplateKey === templateKey}>Template: ${templateKey}</option>`)}
                </select>
                ${isTemplateMode ? html`<div class="help-text" style="margin-top: 0; margin-bottom: 6px;">Using template <code>${selectedTemplateKey}</code>. Switch to Custom markdown to edit agent-specific content without changing the shared template.</div>` : ''}
                <textarea rows=${this.getMarkdownEditorRows(fileName)} .value=${effectiveValue} ?readonly=${isTemplateMode} placeholder=${isTemplateMode ? '' : this.buildAgentBootstrapPlaceholder(agent, fileName)} @input=${(e: any) => {
                  if (!isTemplateMode) {
                    agentTemplateFiles[fileName] = e.target.value;
                    this.requestUpdate();
                  }
                }}></textarea>
              </div>
            `;
          })}
        </div>
      `;
    }
  };
