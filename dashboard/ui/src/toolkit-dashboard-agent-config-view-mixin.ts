import { LitElement, html } from 'lit';
import { AVAILABLE_TOOL_OPTIONS, THINKING_LEVEL_OPTIONS, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES } from './toolkit-dashboard-constants';
import { renderMarkdownFileEditors } from './toolkit-dashboard-markdown-renderers';
import { renderCardSection, renderHelpText, renderPreviewCard, renderPreviewTags, renderSelectableTagList, renderTagList, renderToggleSwitch, renderToolLabel } from './toolkit-dashboard-ui-helpers';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentConfigViewMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentConfigViewMixin extends Base {
    [key: string]: any;

    renderAgentPlacementConfig(agent: any) {
      const endpoints = this.getSortedConfigEndpoints();
      const editorWorkspaceAgentId = this.normalizeAgentId(this.editingAgentInitialDraft?.id || agent.id);
      const primaryWorkspace = this.editingAgentWorkspaceId ? this.getWorkspaceById(this.editingAgentWorkspaceId) : null;
      const workspaceOptions = this.getWorkspaceAssignmentOptions(editorWorkspaceAgentId);
      const accessibleSharedWorkspaces = primaryWorkspace?.mode === 'private'
        ? this.getWorkspaceSharedAccessIds(primaryWorkspace).map((workspaceId: string) => this.getWorkspaceById(workspaceId)).filter(Boolean)
        : [];
      const selectedEndpoint = this.resolveAgentEndpoint(agent);
      const effectiveEndpointKey = selectedEndpoint?.key || '';
      const endpointModelOptions = selectedEndpoint ? this.getEndpointModelOptions(selectedEndpoint) : [];
      const primaryModelOptions = this.getAgentPrimaryModelOptions(agent, selectedEndpoint);
      const forceSandboxOff = (typeof agent.sandboxMode === 'string' ? agent.sandboxMode : '') === 'off';
      const sandboxModeOverride = typeof agent.sandboxMode === 'string' ? agent.sandboxMode : '';
      const thinkingDefault = this.normalizeThinkingDefault(agent.thinkingDefault);
      const toolChoiceDefault = this.getConfiguredToolChoice(agent);

      return html`
        <div class="form-group">
          <label>Endpoint</label>
          <select @change=${(e: any) => {
            const endpointKey = e.target.value || null;
            this.setAgentEndpointAssignment(agent, endpointKey);
            this.requestUpdate();
          }}>
            <option value="">Select Endpoint</option>
            ${endpoints.map((ep: any) => html`<option value=${ep.key} ?selected=${effectiveEndpointKey === ep.key}>${ep.key}</option>`)}
          </select>
        </div>

        <div class="grid-2">
          <div class="card" style="margin-bottom: 0;">
            <div class="card-header"><h3>Home Workspace</h3></div>
            <div class="help-text" style="margin-top: 0;">This is the agent's home base. OpenClaw uses the configured workspace path directly, so it does not need to match the agent ID.</div>
            <select
              .value=${primaryWorkspace?.id || ''}
              style="margin-top: 10px;"
              @change=${(e: any) => this.setEditingAgentWorkspaceSelection(e.target.value || null)}>
              <option value="">No workspace assigned</option>
              ${workspaceOptions.map((option: any) => html`
                <option
                  value=${option.id}
                  ?selected=${primaryWorkspace?.id === option.id}
                  ?disabled=${option.disabled}>
                  ${option.disabled
                    ? `${option.label} - occupied by ${option.occupiedByLabel}`
                    : option.label}
                </option>
              `)}
            </select>
            <div class="help-text" style="margin-top: 10px;">This selection is saved with the rest of the agent editor changes when you save configuration.</div>
            ${primaryWorkspace ? html`
              <div class="help-text" style="margin-top: 10px;">${this.getWorkspaceHomeBaseDescription(primaryWorkspace)} at <code>${primaryWorkspace.path || '(unset path)'}</code>.</div>
            ` : ''}
            ${primaryWorkspace?.mode === 'private' && accessibleSharedWorkspaces.length > 0 ? html`
              <div class="help-text" style="margin-top: 10px;">Shared collaboration access: ${accessibleSharedWorkspaces.map((workspace: any) => workspace.name || workspace.id).join(', ')}. Because this reaches beyond the private home base, the toolkit keeps sandbox off for this agent.</div>
            ` : ''}
            ${primaryWorkspace?.mode === 'private' && accessibleSharedWorkspaces.length === 0 ? html`
              <div class="help-text" style="margin-top: 10px;">This private workspace currently has no shared collaboration workspaces attached, so the toolkit keeps the agent sandboxed to the home base.</div>
            ` : ''}
            ${primaryWorkspace?.mode === 'shared' ? html`
              <div class="help-text" style="margin-top: 10px;">Shared workspaces are collaboration areas rather than private boundaries, so the toolkit keeps sandbox off for agents living here.</div>
            ` : ''}
            <div style="margin-top: 12px;">
              <button class="btn btn-ghost" @click=${() => { this.editingWorkspaceId = primaryWorkspace?.id || null; this.configSection = 'workspaces'; }}>Open Workspaces Tab</button>
            </div>
          </div>
          <div class="card" style="margin-bottom: 0;">
            <div class="card-header"><h3>Sandbox Mode</h3></div>
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${forceSandboxOff} @change=${(e: any) => {
                if (e.target.checked) {
                  agent.sandboxMode = 'off';
                } else {
                  delete agent.sandboxMode;
                }
                this.requestUpdate();
              }}>
              Force sandbox off for this agent
            </label>
            <div class="help-text">Turn this off to use the global sandbox default instead of an explicit agent override.</div>
            ${sandboxModeOverride && sandboxModeOverride !== 'off'
              ? html`<div class="help-text" style="color: #ff9800;">This agent currently has custom sandbox mode "${sandboxModeOverride}". Using the toggle will replace that custom mode with the toolkit's off/default behavior.</div>`
              : ''}
          </div>
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label>Primary Model</label>
            <select ?disabled=${!selectedEndpoint || primaryModelOptions.length === 0} @change=${(e: any) => {
              agent.modelRef = e.target.value;
              this.normalizeAgentModelCandidates(agent, selectedEndpoint);
              this.syncAgentModelSource(agent);
              this.requestUpdate();
            }}>
              <option value="">${selectedEndpoint ? (primaryModelOptions.length === 0 ? 'Add candidate models first' : 'Select Primary Candidate') : 'Choose an endpoint first'}</option>
              ${primaryModelOptions.map((option: any) => html`
                <option value=${option.ref} ?selected=${agent.modelRef === option.ref}>${option.kind === 'local' ? '[Local]' : '[Hosted]'} ${option.label}</option>
              `)}
            </select>
            ${selectedEndpoint && endpointModelOptions.length === 0 ? html`<p style="color: #f44336; font-size: 0.7rem; margin-top: 4px;">This endpoint has no models configured yet. Add local or hosted models on the Endpoints tab first.</p>` : ''}
            ${selectedEndpoint && endpointModelOptions.length > 0 && primaryModelOptions.length === 0 ? html`<p style="color: #888; font-size: 0.75rem; margin-top: 4px;">Pick candidate models below first. The primary model must be one of those candidates.</p>` : ''}
            ${selectedEndpoint && primaryModelOptions.length > 0 ? html`<p style="color: #888; font-size: 0.75rem; margin-top: 4px;">The primary model is chosen from this agent's candidate list, which is limited to the selected endpoint.</p>` : ''}
          </div>
          <div class="form-group">
            <label>Default Thinking</label>
            <select @change=${(e: any) => {
              agent.thinkingDefault = this.normalizeThinkingDefault(e.target.value);
              this.requestUpdate();
            }}>
              ${THINKING_LEVEL_OPTIONS.map((level) => html`
                <option value=${level} ?selected=${thinkingDefault === level}>${level}</option>
              `)}
            </select>
            <div class="help-text">Managed toolkit agents default to <code>high</code> instead of OpenClaw's normal <code>low</code>. Use <code>adaptive</code> for providers that support provider-managed thinking.</div>
          </div>
        </div>

        <div class="form-group">
          <label>Tool Use</label>
          <select .value=${toolChoiceDefault} @change=${(e: any) => this.setConfiguredToolChoice(agent, e.target.value)}>
            <option value="">Default</option>
            <option value="auto">Auto</option>
            <option value="required">Required</option>
            <option value="none">None</option>
          </select>
          <div class="help-text">This writes to the agent's OpenClaw <code>params.toolChoice</code>. Use <code>required</code> only for tool-first specialists because it can be too strict for agents that also need to answer normally.</div>
        </div>
      `;
    }

    renderAgentSubagentsConfig(subagents: any, selectedAllowedAgents: string[], allowedAgentChoices: Array<{ id: string; label: string }>) {
      return renderCardSection('Subagents', html`
        <div class="form-group">
          ${renderToggleSwitch('Enable spawning subagents from this agent', !!subagents.enabled, (checked) => {
            subagents.enabled = checked;
            this.requestUpdate();
          })}
        </div>
        <div class="form-group">
          ${renderToggleSwitch('Require explicit agent ID when spawning subagents', !!subagents.requireAgentId, (checked) => {
            subagents.requireAgentId = checked;
            this.requestUpdate();
          })}
        </div>
        <div class="form-group">
          <label>Allowed Agent IDs</label>
          ${renderTagList(selectedAllowedAgents, (agentId: string, idx: number) => html`
            <div class="tag">
              ${agentId}
              <span class="tag-remove" @click=${() => {
                selectedAllowedAgents.splice(idx, 1);
                this.requestUpdate();
              }}>×</span>
            </div>
          `)}
          <div style="margin-top: 10px;">
            <select @change=${(e: any) => {
              const value = e.target.value;
              if (value && !selectedAllowedAgents.includes(value)) {
                selectedAllowedAgents.push(value);
                this.requestUpdate();
              }
              e.target.value = '';
            }}>
              <option value="">${allowedAgentChoices.length === 0 ? 'No other configured agents available' : '+ Add Allowed Agent'}</option>
              ${allowedAgentChoices
                .filter((choice: any) => !selectedAllowedAgents.includes(choice.id))
                .map((choice: any) => html`<option value=${choice.id}>${choice.label}</option>`)}
            </select>
          </div>
          ${renderHelpText('Leave the list empty to keep the toolkit defaults.', 'margin-top: 6px;')}
        </div>
      `, undefined, '', 'margin-top: 20px; margin-bottom: 20px;');
    }

    renderAgentBootstrapConfig(agent: any, agentTemplateFiles: Record<string, string>) {
      return renderCardSection('Agent Bootstrap Markdown', renderMarkdownFileEditors({
        scopeLabel: 'agent',
        intro: `Custom markdown for this agent is stored in openclaw-toolkit\\agents\\${agent.id || 'agent-id'}\\bootstrap\\. Shared templates come from openclaw-toolkit\\markdown-templates\\agents\\<TYPE>\\. The selected effective files are copied into .openclaw\\agents\\${agent.id || 'agent-id'}\\bootstrap\\ as agent-specific bootstrap overlays. Root workspace starter files such as AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, and HEARTBEAT.md are seeded by OpenClaw itself. MEMORY.md is optional and not first-run seeded. DREAMS.md is agent-maintained by OpenClaw's memory system and is not configured here.`,
        fileNames: VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES,
        getHelpText: (fileName: string) => this.getMarkdownFileHelpText(fileName, 'agent'),
        getTemplateKeys: (fileName: string) => this.getMarkdownTemplateKeys('agents', fileName),
        getSelectedTemplateKey: (fileName: string) => this.getMarkdownTemplateSelection(agent, fileName, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES),
        getEffectiveValue: (fileName: string, selectedTemplateKey: string) => selectedTemplateKey.length > 0
          ? this.getMarkdownTemplateContent('agents', fileName, selectedTemplateKey)
          : (agentTemplateFiles[fileName] || ''),
        getPlaceholder: (fileName: string) => this.buildAgentBootstrapPlaceholder(agent, fileName),
        getRows: (fileName: string) => this.getMarkdownEditorRows(fileName),
        onSelectTemplate: (fileName: string, templateKey: string | null) => {
          this.setMarkdownTemplateSelection(agent, fileName, templateKey, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
          this.requestUpdate();
        },
        onUpdateFile: (fileName: string, value: string) => {
          agentTemplateFiles[fileName] = value;
          this.requestUpdate();
        }
      }), undefined, '', 'margin-top: 20px; margin-bottom: 20px;');
    }

    renderAgentTelegramRoutingConfig(telegramRoutesForAgent: any[]) {
      if (!Array.isArray(telegramRoutesForAgent) || telegramRoutesForAgent.length === 0) {
        return html``;
      }

      return renderCardSection('Telegram Routing', html`
        ${renderHelpText('This agent is currently the managed Telegram target for:', 'margin-top: 0; margin-bottom: 10px;')}
        ${telegramRoutesForAgent.map((route: any) => renderPreviewCard(
          String(route?.accountId || this.getDefaultTelegramAccountId()),
          [{
            label: 'Route',
            body: renderTagList([
              String(route?.matchType || '').toLowerCase() === 'trusted-dms' ? 'Trusted DMs' : null,
              String(route?.matchType || '').toLowerCase() === 'trusted-groups' ? 'Trusted Groups' : null,
              String(route?.matchType || '').toLowerCase() === 'group' ? `Group ${route?.peerId || '(missing id)'}` : null,
              String(route?.matchType || '').toLowerCase() === 'direct' ? `DM ${route?.peerId || '(missing id)'}` : null
            ].filter((entry): entry is string => !!entry), (item) => html`<div class="tag">${item}</div>`, html`<div class="toolset-preview-empty">No inbound Telegram route details available.</div>`)
          }],
          undefined,
          html`<span class="badge">Telegram</span>`,
          'margin-bottom: 10px;'
        ))}
        ${renderHelpText(html`Change these routes on <strong>Configuration -&gt; Features -&gt; Telegram</strong>.`, 'margin-top: 8px;')}
      `, html`<span class="badge">Inbound</span>`, '', 'margin-bottom: 20px; border-color: #5c6bc0;');
    }

    renderAgentToolsConfig(agent: any) {
      const selectedEndpoint = this.resolveAgentEndpoint(agent);
      const endpointModelOptions = selectedEndpoint ? this.getEndpointModelOptions(selectedEndpoint) : [];
      const candidateModelRefs = this.normalizeAgentModelCandidates(agent, selectedEndpoint);
      const toolsetKeys = this.ensureAgentToolsetKeys(agent);
      const appliedToolsets = this.getAgentAppliedToolsets(agent);
      const directToolOverrides = this.normalizeAgentToolOverrides(agent) || { allow: [], deny: [] };
      const directAllowedTools = this.normalizeToolNameList(directToolOverrides.allow);
      const directDeniedTools = this.normalizeToolNameList(directToolOverrides.deny);
      const availableAgentToolsets = this.getToolsetsList().filter((toolset: any) => toolset.key !== 'minimal' && !toolsetKeys.includes(toolset.key));
      const availableDirectAllowOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !directAllowedTools.includes(option.id));
      const availableDirectDenyOptions = AVAILABLE_TOOL_OPTIONS.filter((option) => !directDeniedTools.includes(option.id));
      const effectiveToolState = this.getEffectiveAgentToolState(agent);

      return html`
        <div class="form-group">
          <label>Candidate Models</label>
          ${renderSelectableTagList(
            candidateModelRefs,
            (ref: string, idx: number) => html`
              <div class="tag">
                ${ref}
                <span class="tag-remove" @click=${() => {
                  agent.candidateModelRefs.splice(idx, 1);
                  this.normalizeAgentModelCandidates(agent, selectedEndpoint);
                  this.syncAgentModelSource(agent);
                  this.requestUpdate();
                }}>×</span>
              </div>
            `,
            endpointModelOptions
              .filter((option: any) => !candidateModelRefs.includes(option.ref))
              .map((option: any) => ({
                value: option.ref,
                label: `${option.kind === 'local' ? '[Local]' : '[Hosted]'} ${option.label}`
              })),
            (value) => {
              if (!agent.candidateModelRefs) agent.candidateModelRefs = [];
              if (!agent.candidateModelRefs.includes(value)) {
                agent.candidateModelRefs.push(value);
                if (!agent.modelRef) {
                  agent.modelRef = value;
                }
                this.normalizeAgentModelCandidates(agent, selectedEndpoint);
                this.syncAgentModelSource(agent);
                this.requestUpdate();
              }
            },
            selectedEndpoint ? '+ Add Endpoint Model' : 'Choose an endpoint first',
            undefined,
            !selectedEndpoint || endpointModelOptions.length === 0
          )}
          <div class="help-text" style="margin-top: 8px;">Candidate order matters: OpenClaw fallbacks are built from this set, and the primary model must stay inside it.</div>
        </div>

        <div class="card" style="margin-top: 20px; margin-bottom: 20px;">
          <div class="card-header"><h3>Toolsets</h3></div>
          ${renderHelpText(html`The global <code>minimal</code> toolset is always applied first. Toolsets lower in the list win when the same tool is both allowed and denied.`, 'margin-top: 0; margin-bottom: 14px;')}

          <div class="form-group">
            <label>Applied Toolsets</label>
            <div class="applied-toolset-list">
              ${appliedToolsets.map((toolset: any) => {
                const isMinimal = toolset.key === 'minimal';
                const agentToolsetIndex = isMinimal ? -1 : toolsetKeys.indexOf(toolset.key);
                const allowedTools = this.normalizeToolNameList(toolset.allow);
                const deniedTools = this.normalizeToolNameList(toolset.deny);
                return renderPreviewCard(toolset.name || toolset.key, [
                  {
                    label: 'Allow',
                    body: renderPreviewTags(
                      allowedTools,
                      (toolId: string) => html`<div class="tag">${renderToolLabel(this.getToolOption(toolId), toolId)}</div>`,
                      html`No allowed tools.`
                    )
                  },
                  {
                    label: 'Deny',
                    body: renderPreviewTags(
                      deniedTools,
                      (toolId: string) => html`<div class="tag">${renderToolLabel(this.getToolOption(toolId), toolId)}</div>`,
                      html`No denied tools.`
                    )
                  }
                ], undefined, isMinimal ? html`<span class="badge">Global</span>` : '', '', !isMinimal ? html`
                  <button class="btn btn-ghost" style="padding: 2px 6px;" ?disabled=${agentToolsetIndex <= 0} @click=${() => this.moveAgentToolset(agent, agentToolsetIndex, -1)}>Up</button>
                  <button class="btn btn-ghost" style="padding: 2px 6px;" ?disabled=${agentToolsetIndex < 0 || agentToolsetIndex >= toolsetKeys.length - 1} @click=${() => this.moveAgentToolset(agent, agentToolsetIndex, 1)}>Down</button>
                  <button class="btn btn-danger" style="padding: 2px 6px;" @click=${() => { agent.toolsetKeys.splice(agentToolsetIndex, 1); this.requestUpdate(); }}>Remove</button>
                ` : '');
              })}
            </div>
            <div style="margin-top: 10px;">
              <select @change=${(e: any) => {
                const value = e.target.value;
                if (value) {
                  this.addAgentToolset(agent, value);
                  e.target.value = '';
                }
              }}>
                <option value="">${availableAgentToolsets.length === 0 ? 'No other toolsets available' : '+ Add toolset'}</option>
                ${availableAgentToolsets.map((toolset: any) => html`
                  <option value=${toolset.key}>${toolset.name || toolset.key} - ${this.getToolsetPreviewText(toolset)}</option>
                `)}
              </select>
            </div>
          </div>

          <div class="form-group">
            <label>Direct Tool Overrides</label>
            ${renderPreviewCard('Direct Tool Overrides', [
              {
                label: 'Allow',
                body: html`
                  ${renderSelectableTagList(
                    directAllowedTools,
                    (toolId: string) => html`
                      <div class="tag">
                        ${renderToolLabel(this.getToolOption(toolId), toolId)}
                        <span class="tag-remove" @click=${() => this.removeAgentToolOverride(agent, 'allow', toolId)}>×</span>
                      </div>
                    `,
                    availableDirectAllowOptions.map((option) => ({
                      value: option.id,
                      label: `${this.getToolDisplayLabel(option.id)} - ${option.description}`
                    })),
                    (value) => {
                      this.addAgentToolOverride(agent, 'allow', value);
                    },
                    '+ Add allowed tool override',
                    html`No direct allow overrides.`
                  )}
                `
              },
              {
                label: 'Deny',
                body: html`
                  ${renderSelectableTagList(
                    directDeniedTools,
                    (toolId: string) => html`
                      <div class="tag">
                        ${renderToolLabel(this.getToolOption(toolId), toolId)}
                        <span class="tag-remove" @click=${() => this.removeAgentToolOverride(agent, 'deny', toolId)}>×</span>
                      </div>
                    `,
                    availableDirectDenyOptions.map((option) => ({
                      value: option.id,
                      label: `${this.getToolDisplayLabel(option.id)} - ${option.description}`
                    })),
                    (value) => {
                      this.addAgentToolOverride(agent, 'deny', value);
                    },
                    '+ Add denied tool override',
                    html`No direct deny overrides.`
                  )}
                `
              }
            ], undefined, html`<span class="badge">Final Layer</span>`) }
            ${renderHelpText('These direct per-agent tool picks merge after all applied toolsets, so they are the easiest way to make one-off tweaks.', 'margin-top: 8px;')}
          </div>

          <div class="form-group">
            <label>Combined Toolset</label>
            ${renderPreviewCard('Combined Toolset', [
              {
                label: 'Allow',
                body: renderPreviewTags(
                  effectiveToolState.allowedTools,
                  (toolId: string) => html`<div class="tag">${renderToolLabel(this.getToolOption(toolId), toolId)}</div>`,
                  html`No tools allowed yet.`
                )
              },
              {
                label: 'Deny',
                body: renderPreviewTags(
                  effectiveToolState.deniedTools,
                  (toolId: string) => html`<div class="tag">${renderToolLabel(this.getToolOption(toolId), toolId)}</div>`,
                  html`No explicit denies.`
                )
              }
            ], undefined, html`<span class="badge">Final</span>`) }
          </div>

          ${effectiveToolState.explicitTools ? html`
            ${renderHelpText(html`This agent also has a raw <code>tools</code> block in config. Those direct OpenClaw overrides still apply after the combined toolkit toolset shown above.`, 'margin-top: 0;')}
          ` : ''}
        </div>
      `;
    }
  };
