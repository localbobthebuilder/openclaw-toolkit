import { LitElement } from 'lit';
import { VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES } from './toolkit-dashboard-constants';
import { renderCardSection } from './toolkit-dashboard-ui-helpers';
import { renderMarkdownFileEditors } from './toolkit-dashboard-markdown-renderers';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentBootstrapMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentBootstrapMixin extends Base {
    [key: string]: any;

    renderAgentBootstrapConfig(agent: any, agentTemplateFiles: Record<string, string>) {
      return renderCardSection('Agent Bootstrap Markdown', renderMarkdownFileEditors({
        scopeLabel: 'agent',
        intro: `Custom markdown for this agent is stored in openclaw-toolkit\\agents\\${agent.id || 'agent-id'}\\bootstrap\\. Shared templates come from openclaw-toolkit\\markdown-templates\\agents\\<TYPE>\\. The selected effective files are copied into .openclaw\\agents\\${agent.id || 'agent-id'}\\bootstrap\\ as agent-specific bootstrap overlays. Root workspace starter files such as AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, and HEARTBEAT.md are seeded by OpenClaw itself. MEMORY.md is optional and not first-run seeded. DREAMS.md is agent-maintained by OpenClaw's memory system and is not configured here.`,
        fileNames: VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES,
        getHelpText: (fileName) => this.getMarkdownFileHelpText(fileName, 'agent'),
        getTemplateKeys: (fileName) => this.getMarkdownTemplateKeys('agents', fileName),
        getSelectedTemplateKey: (fileName) => this.getMarkdownTemplateSelection(agent, fileName, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES),
        getEffectiveValue: (fileName, selectedTemplateKey) => selectedTemplateKey.length > 0
          ? this.getMarkdownTemplateContent('agents', fileName, selectedTemplateKey)
          : (agentTemplateFiles[fileName] || ''),
        getPlaceholder: (fileName) => this.buildAgentBootstrapPlaceholder(agent, fileName),
        getRows: (fileName) => this.getMarkdownEditorRows(fileName),
        onSelectTemplate: (fileName, templateKey) => {
          this.setMarkdownTemplateSelection(agent, fileName, templateKey, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
          this.requestUpdate();
        },
        onUpdateFile: (fileName, value) => {
          agentTemplateFiles[fileName] = value;
          this.requestUpdate();
        }
      }), undefined, '', 'margin-top: 20px; margin-bottom: 20px;');
    }
  };
