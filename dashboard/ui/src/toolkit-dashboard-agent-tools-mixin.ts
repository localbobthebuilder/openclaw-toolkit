import { LitElement, html } from 'lit';
import { AVAILABLE_TOOL_OPTIONS } from './toolkit-dashboard-constants';
import { renderPreviewCard, renderPreviewTags, renderSelectableTagList } from './toolkit-dashboard-ui-helpers';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardAgentToolsMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardAgentToolsMixin extends Base {
    [key: string]: any;

    renderAgentToolsConfig(agent: any) {
      const selectedEndpoint = this.resolveAgentEndpoint(agent);
      const endpointModelOptions = selectedEndpoint ? this.getEndpointModelOptions(selectedEndpoint) : [];
      const candidateModelRefs = Array.isArray(agent.candidateModelRefs) ? agent.candidateModelRefs : (agent.candidateModelRefs = []);
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
                <span class="tag-remove" @click=${() => { agent.candidateModelRefs.splice(idx, 1); this.requestUpdate(); }}>×</span>
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
                this.syncAgentModelSource(agent);
                this.requestUpdate();
              }
            },
            selectedEndpoint ? '+ Add Endpoint Model' : 'Choose an endpoint first',
            undefined,
            !selectedEndpoint || endpointModelOptions.length === 0
          )}
        </div>

        <div class="card" style="margin-top: 20px; margin-bottom: 20px;">
          <div class="card-header"><h3>Toolsets</h3></div>
          <div class="help-text" style="margin-top: 0; margin-bottom: 14px;">The global <code>minimal</code> toolset is always applied first. Toolsets lower in the list win when the same tool is both allowed and denied.</div>

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
                      (toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`,
                      html`No allowed tools.`
                    )
                  },
                  {
                    label: 'Deny',
                    body: renderPreviewTags(
                      deniedTools,
                      (toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`,
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
                        ${this.renderToolLabel(toolId)}
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
                        ${this.renderToolLabel(toolId)}
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
            ], undefined, html`<span class="badge">Final Layer</span>`)}
            <div class="help-text" style="margin-top: 8px;">These direct per-agent tool picks merge after all applied toolsets, so they are the easiest way to make one-off tweaks.</div>
          </div>

          <div class="form-group">
            <label>Combined Toolset</label>
            ${renderPreviewCard('Combined Toolset', [
              {
                label: 'Allow',
                body: renderPreviewTags(
                  effectiveToolState.allowedTools,
                  (toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`,
                  html`No tools allowed yet.`
                )
              },
              {
                label: 'Deny',
                body: renderPreviewTags(
                  effectiveToolState.deniedTools,
                  (toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`,
                  html`No explicit denies.`
                )
              }
            ], undefined, html`<span class="badge">Final</span>`)}
          </div>

          ${effectiveToolState.explicitTools ? html`
            <div class="help-text" style="margin-top: 0;">This agent also has a raw <code>tools</code> block in config. Those direct OpenClaw overrides still apply after the combined toolkit toolset shown above.</div>
          ` : ''}
        </div>
      `;
    }
  };
