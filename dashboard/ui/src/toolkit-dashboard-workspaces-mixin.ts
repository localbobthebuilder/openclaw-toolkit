import { LitElement, html } from 'lit';
import { VALID_WORKSPACE_MARKDOWN_FILES } from './toolkit-dashboard-constants';
import { renderMarkdownFileEditors } from './toolkit-dashboard-markdown-renderers';
import { renderHelpText, renderSectionHeader, renderSelectableTagList, renderSummaryRow } from './toolkit-dashboard-ui-helpers';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardWorkspacesMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardWorkspacesMixin extends Base {
    [key: string]: any;

    renderFeaturesConfig() {
      return html`
        <div class="tabs">
          <div class="tab ${this.featureSubsection === 'telegram' ? 'active' : ''}" @click=${() => this.featureSubsection = 'telegram'}>Telegram</div>
          <div class="tab ${this.featureSubsection === 'voice' ? 'active' : ''}" @click=${() => this.featureSubsection = 'voice'}>Voice</div>
        </div>
        ${this.featureSubsection === 'telegram'
          ? this.renderTelegramFeaturesConfig()
          : this.renderVoiceFeaturesConfig()}
      `;
    }


    renderWorkspacesConfig() {
      if (this.editingWorkspaceId) {
        return this.renderWorkspaceEditor(this.editingWorkspaceId);
      }

      const workspaces = this.getWorkspaces();
      return html`
        <div class="card">
          <div class="card-header">
            <h3>Workspaces</h3>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-ghost" @click=${() => this.addWorkspace('shared')}>+ Shared Workspace</button>
              <button class="btn btn-ghost" @click=${() => this.addWorkspace('private')}>+ Private Workspace</button>
            </div>
          </div>
          <p style="color: #888; font-size: 0.85rem; margin-bottom: 20px;">Workspaces define the agent home base. Shared workspaces can host many agents and are collaboration areas. Private workspaces host one agent, act as the privacy boundary, and can optionally expose specific shared collaboration workspaces.</p>
          ${workspaces.map((workspace: any) => {
            const occupantIds = this.getWorkspaceAgentIds(workspace);
            const occupants = this.getManagedAgentEntries().filter(({ agent }: any) => occupantIds.includes(String(agent?.id || '')));
            const sharedAccessLabels = workspace.mode === 'private'
              ? this.getWorkspaceSharedAccessIds(workspace)
                  .map((workspaceId: string) => this.getWorkspaceById(workspaceId))
                  .filter(Boolean)
                  .map((candidate: any) => candidate.name || candidate.id)
              : [];
            return renderSummaryRow({
              title: workspace.name || workspace.id,
              subtitle: html`
                ID: ${workspace.id} | Mode: ${workspace.mode} | Home Base Path: ${workspace.path || '(unset)'} | Occupants: ${occupants.length > 0 ? occupants.map(({ agent }: any) => agent.name || agent.id).join(', ') : 'none'}
                ${workspace.mode === 'private' ? ` | Shared access: ${sharedAccessLabels.length > 0 ? sharedAccessLabels.join(', ') : 'none'}` : ''}
              `,
              actions: html`
                <button class="btn btn-secondary" @click=${() => this.editingWorkspaceId = workspace.id}>Configure</button>
                <button class="btn btn-danger" @click=${() => this.removeWorkspaceById(workspace.id)}>Remove</button>
              `
            });
          })}
        </div>
      `;
    }


    renderWorkspaceEditor(workspaceId: string) {
      const workspace = this.getWorkspaceById(workspaceId);
      if (!workspace) return html`Workspace not found`;

      const previousWorkspaceId = String(workspace?.id || '');
      const occupantIds = this.getWorkspaceAgentIds(workspace);
      const occupantEntries = this.getManagedAgentEntries().filter(({ agent }: any) => occupantIds.includes(String(agent?.id || '')));
      const sharedWorkspaces = this.getSharedWorkspaces().filter((candidate: any) => candidate.id !== workspace.id);
      const availableAgents = this.getManagedAgentEntries().filter(({ agent }: any) => {
        const agentId = String(agent?.id || '');
        const assignedWorkspace = this.getWorkspaceForAgentId(agentId);
        return agentId.length > 0 && (!assignedWorkspace || assignedWorkspace.id === workspace.id);
      });
      const selectedSharedAccessIds = this.getWorkspaceSharedAccessIds(workspace);

      return html`
          <div class="card">
            <div class="card-header">
              <h3>Workspace: ${workspace.name || workspace.id}</h3>
              <button class="btn btn-ghost" @click=${() => this.editingWorkspaceId = null}>Back to Workspaces</button>
            </div>

          <div class="card" style="margin-bottom: 20px; border-color: ${workspace.mode === 'private' ? '#90caf9' : '#81c784'};">
            <div class="card-header"><h3>Home Base Rules</h3></div>
            ${renderSectionHeader({
              title: html`${workspace.mode === 'private' ? 'Private workspace' : 'Shared workspace'}:`,
              intro: workspace.mode === 'private'
                ? 'this is the agent home base and privacy boundary. With no shared access attached, the toolkit forces sandbox on with workspace-write mode.'
                : 'this is a collaboration area, not a private boundary. The toolkit forces sandbox off for agents who live here so they can work beyond a single private home-base path.',
              introStyle: 'font-size: 0.8rem; color: #888; margin-bottom: 0; margin-top: 0;'
            })}
            ${renderHelpText('OpenClaw uses the exact configured workspace path directly. It does not require the private workspace name or path to match the agent ID.', 'margin-top: 10px;')}
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label>Workspace Name</label>
              <input type="text" .value=${workspace.name || ''} @input=${(e: any) => { workspace.name = e.target.value; this.requestUpdate(); }}>
            </div>
            <div class="form-group">
              <label>Workspace ID</label>
              <input type="text" .value=${workspace.id || ''} @input=${(e: any) => {
                const nextId = e.target.value;
                this.renameWorkspaceIdEverywhere(previousWorkspaceId, nextId);
                workspace.id = nextId;
                this.requestUpdate();
              }}>
            </div>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label>Workspace Mode</label>
              <select @change=${(e: any) => {
                const nextMode = e.target.value === 'private' ? 'private' : 'shared';
                if (nextMode === 'private' && workspace.mode !== 'private' && this.getWorkspaceAgentIds(workspace).length > 1) {
                  alert('A private workspace can only host one primary agent. Move the extra agents to other workspaces first.');
                  e.target.value = workspace.mode;
                  return;
                }
                workspace.mode = nextMode;
                if (workspace.mode === 'shared') {
                  workspace.sharedWorkspaceIds = [];
                } else if (!Array.isArray(workspace.sharedWorkspaceIds)) {
                  workspace.sharedWorkspaceIds = [];
                }
                this.normalizeWorkspaceAssignments(this.config);
                const messages = occupantEntries
                  .map(({ agent }: any) => this.enforceWorkspaceSandboxPolicy(agent, workspace))
                  .filter((message: string) => message.length > 0);
                if (messages.length > 0) {
                  alert(messages.join('\n\n'));
                }
                this.requestUpdate();
              }}>
                <option value="shared" ?selected=${workspace.mode === 'shared'}>shared</option>
                <option value="private" ?selected=${workspace.mode === 'private'}>private</option>
              </select>
            </div>
            <div class="form-group">
              <label>${workspace.mode === 'private' ? 'Home Workspace Path' : 'Shared Workspace Path'}</label>
              <input type="text" .value=${workspace.path || ''} @input=${(e: any) => { workspace.path = e.target.value; this.requestUpdate(); }}>
              ${renderHelpText('This exact path becomes the workspace home base path used by OpenClaw. It can be any valid path; it does not need to match the agent name.')}
            </div>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label class="toggle-switch">
                <input type="checkbox" ?checked=${!!workspace.enableAgentToAgent} @change=${(e: any) => { workspace.enableAgentToAgent = e.target.checked; this.requestUpdate(); }}>
                Enable agent-to-agent tool in this workspace
              </label>
            </div>
            <div class="form-group">
              <label class="toggle-switch">
                <input type="checkbox" ?checked=${!!workspace.manageWorkspaceAgentsMd} @change=${(e: any) => { workspace.manageWorkspaceAgentsMd = e.target.checked; this.requestUpdate(); }}>
                Manage workspace markdown files
              </label>
              ${renderHelpText(html`Workspace markdown lives under <code>openclaw-toolkit\\workspaces\\${workspace.id || '&lt;workspaceId&gt;'}\\markdown\\</code>.`)}
            </div>
          </div>

          ${workspace.mode === 'shared' ? html`
            <div class="form-group">
              <label>Primary Agents in this Shared Workspace</label>
              ${renderHelpText('Assigning an agent here makes this shared workspace the agent\'s home base and forces sandbox off so collaboration is not blocked by a private workspace restriction.', 'margin-bottom: 10px;')}
              ${renderSelectableTagList(
                occupantEntries,
                ({ agent }: any) => html`
                  <div class="tag">
                    ${agent.name || agent.id}
                    <span class="tag-remove" @click=${() => this.setAgentPrimaryWorkspace(agent.id, null)}>×</span>
                  </div>
                `,
                availableAgents
                  .filter(({ agent }: any) => !occupantIds.includes(String(agent?.id || '')))
                  .map(({ agent }: any) => ({
                    value: agent.id,
                    label: agent.name || agent.id
                  })),
                (agentId) => {
                  this.setAgentPrimaryWorkspace(agentId, workspace.id);
                },
                availableAgents.length === 0 ? 'No unassigned agents available' : '+ Add Agent to Shared Workspace'
              )}
            </div>
          ` : html`
            <div class="grid-2">
              <div class="form-group">
                <label>Primary Agent in this Private Workspace</label>
                <select @change=${(e: any) => {
                  const agentId = e.target.value;
                  if (agentId) {
                    this.setAgentPrimaryWorkspace(agentId, workspace.id);
                  } else {
                    workspace.agents = [];
                    this.requestUpdate();
                  }
                }}>
                  <option value="">No primary agent assigned</option>
                  ${availableAgents.map(({ agent }: any) => html`
                    <option value=${agent.id} ?selected=${occupantIds.includes(String(agent?.id || ''))}>${agent.name || agent.id}</option>
                  `)}
                </select>
                ${renderHelpText('A private workspace can host only one primary agent at a time. If that agent was previously sandbox-off, the toolkit turns sandbox back on with workspace-write mode unless shared collaboration access is attached below.')}
              </div>
              <div class="form-group">
                <label>Shared Workspaces Accessible from this Private Workspace</label>
                ${renderHelpText('Granting shared collaboration access means the agent must reach paths outside its private home base, so the toolkit will turn sandbox off for the occupying agent.', 'margin-bottom: 10px;')}
                ${renderSelectableTagList(
                  selectedSharedAccessIds,
                  (sharedWorkspaceId: string) => {
                    const sharedWorkspace = this.getWorkspaceById(sharedWorkspaceId);
                    if (!sharedWorkspace) return null;
                    return html`
                      <div class="tag">
                        ${sharedWorkspace.name || sharedWorkspace.id}
                        <span class="tag-remove" @click=${() => {
                          this.setWorkspaceSharedAccess(workspace, selectedSharedAccessIds.filter((candidateId: string) => candidateId !== sharedWorkspaceId));
                        }}>×</span>
                      </div>
                    `;
                  },
                  sharedWorkspaces
                    .filter((candidate: any) => !selectedSharedAccessIds.includes(String(candidate?.id || '')))
                    .map((candidate: any) => ({
                      value: candidate.id,
                      label: candidate.name || candidate.id
                    })),
                  (selectedId) => {
                    if (!selectedSharedAccessIds.includes(selectedId)) {
                      this.setWorkspaceSharedAccess(workspace, [...selectedSharedAccessIds, selectedId]);
                    }
                  },
                  sharedWorkspaces.length === 0 ? 'No shared workspaces available' : '+ Grant Shared Workspace Access'
                )}
              </div>
            </div>
          `}

          <div class="card" style="margin-top: 20px;">
            <div class="card-header"><h3>Workspace Markdown</h3></div>
            ${renderMarkdownFileEditors({
              scopeLabel: 'workspace',
              intro: `Custom markdown for this workspace is stored in openclaw-toolkit\\workspaces\\${workspace.id || '<workspaceId>'}\\markdown\\. Shared templates come from openclaw-toolkit\\markdown-templates\\workspaces\\<TYPE>\\. The toolkit now asks OpenClaw itself to seed the standard starter files for each managed workspace, then applies any custom workspace markdown on top. MEMORY.md is optional and not first-run seeded. DREAMS.md is agent-maintained by the memory system and is not edited here. BOOT.md is a toolkit startup checklist. BOOTSTRAP.md is a one-time first-run ritual and is only seeded when the workspace is brand new or the live file still exists.`,
              fileNames: VALID_WORKSPACE_MARKDOWN_FILES,
              getHelpText: (fileName) => this.getMarkdownFileHelpText(fileName, 'workspace'),
              getTemplateKeys: (fileName) => this.getMarkdownTemplateKeys('workspaces', fileName),
              getSelectedTemplateKey: (fileName) => this.getMarkdownTemplateSelection(workspace, fileName, VALID_WORKSPACE_MARKDOWN_FILES),
              getEffectiveValue: (fileName, selectedTemplateKey) => {
                const workspaceFiles = this.ensureWorkspaceTemplateFiles(workspace);
                return selectedTemplateKey.length > 0
                  ? this.getMarkdownTemplateContent('workspaces', fileName, selectedTemplateKey)
                  : (workspaceFiles[fileName] || '');
              },
              getPlaceholder: (fileName) => this.buildWorkspaceBootstrapPlaceholder(workspace, fileName),
              getRows: (fileName) => this.getMarkdownEditorRows(fileName),
              onSelectTemplate: (fileName, templateKey) => {
                this.setMarkdownTemplateSelection(workspace, fileName, templateKey, VALID_WORKSPACE_MARKDOWN_FILES);
                this.requestUpdate();
              },
              onUpdateFile: (fileName, value) => {
                const workspaceFiles = this.ensureWorkspaceTemplateFiles(workspace);
                workspaceFiles[fileName] = value;
                this.requestUpdate();
              }
            })}
          </div>
        </div>
      `;
    }
  };
