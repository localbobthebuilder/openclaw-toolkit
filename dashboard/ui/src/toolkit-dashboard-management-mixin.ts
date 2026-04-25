import { LitElement } from 'lit';
import { ToolkitDashboardEndpointsMixin } from './toolkit-dashboard-endpoints-mixin';
import { ToolkitDashboardModelsMixin } from './toolkit-dashboard-models-mixin';
import { ToolkitDashboardToolsetsMixin } from './toolkit-dashboard-toolsets-mixin';
import { renderMarkdownTemplateLibrarySection } from './toolkit-dashboard-markdown-renderers';

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

      return renderMarkdownTemplateLibrarySection({
        title: 'Template Markdowns',
        intro: 'Define reusable markdown templates by scope and file type. Agents and workspaces can either reference one of these named templates or keep their own custom markdown files.',
        scope,
        fileNames,
        selectedFileName,
        templateKeys,
        library,
        onAddTemplate: () => this.addMarkdownTemplate(scope, selectedFileName),
        onSelectScope: (nextScope) => {
          this.markdownTemplateScope = nextScope;
        },
        onSelectFile: (fileName) => this.setSelectedTemplateMarkdownFile(fileName),
        onRemoveTemplate: (templateKey) => this.removeMarkdownTemplate(scope, selectedFileName, templateKey),
        onUpdateTemplate: (templateKey, value) => {
          library[templateKey] = value;
          this.requestUpdate();
        }
      });
    }
  };
