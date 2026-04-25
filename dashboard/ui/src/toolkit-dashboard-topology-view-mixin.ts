import { LitElement, html } from 'lit';
import {
  VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES
} from './toolkit-dashboard-constants';
import { renderPreviewCard, renderPreviewRows, renderPreviewTags, renderToolLabel } from './toolkit-dashboard-ui-helpers';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTopologyViewMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTopologyViewMixin extends Base {
    [key: string]: any;

    renderTopology() {
      if (!this.config) return html`<p>Loading topology...</p>`;

      const slots = this.getTopologySlots().map((slot: any) => {
        const columnCount = slot.agents.length >= 4 ? 2 : 1;
        const cardMinWidth = 304;
        const columnGap = this.getTopologySlotColumnGap(slot, columnCount);
        const innerPadding = 32;
        const slotWidth = innerPadding + (columnCount * cardMinWidth) + ((columnCount - 1) * columnGap);
        return {
          ...slot,
          columnCount,
          columnGap,
          slotWidth
        };
      });
      const slotGap = 28;
      const estimatedBoardWidth = slots.reduce((total: number, slot: any, index: number) => total + slot.slotWidth + (index > 0 ? slotGap : 0), 0);
      const boardHeight = this.topologyBoardHeight || 560;
      const previewSourceAgentId = this.getTopologyPreviewSourceAgentId();
      const visibleEdges = this.getVisibleTopologyEdges();
      const selectedTopologyEntry = this.getTopologySelectedAgentEntry();
      const selectedTopologyAgentId = this.topologySelectedAgentId || selectedTopologyEntry?.id || null;
      const orderedVisibleEdges = [...visibleEdges].sort((left: any, right: any) => {
        const leftHovered = this.topologyHoverEdgeKey === left.key ? 1 : 0;
        const rightHovered = this.topologyHoverEdgeKey === right.key ? 1 : 0;
        return leftHovered - rightHovered;
      });

      return html`
        <header>
          <h2>Agent Topology Workbench</h2>
          <div style="display: flex; gap: 10px;">
            ${this.topologyLinkSourceAgentId ? html`
              <button class="btn btn-secondary" @click=${() => { this.topologyLinkSourceAgentId = null; this.clearTopologyNotice(); }}>Cancel Delegation Wiring</button>
            ` : ''}
            <button class="btn btn-secondary" @click=${() => this.activeTab = 'config'}>Open Full Configuration</button>
          </div>
        </header>

        <div class="topology-shell">
          <div class="card">
            <div class="topology-toolbar">
              <div>
                <div style="color: #fff; font-weight: 600; margin-bottom: 6px;">Drag agents onto endpoint workbenches</div>
                <div class="topology-help">
                  Drag a pawn onto a computer/workbench to change its <strong>endpoint assignment</strong>. Click <strong>Delegation</strong> on an agent, then click another agent to add or remove a dotted delegation arrow.
                </div>
              </div>
              <div class="topology-toolbar-controls">
                <label class="toggle-switch topology-legend-item" title="When off, arrows only appear while hovering a delegator card.">
                  <input type="checkbox" ?checked=${this.topologyShowAllArrows} @change=${(event: Event) => {
                    const target = event.target as HTMLInputElement;
                    this.topologyShowAllArrows = !!target.checked;
                  }}>
                  <span>${this.topologyShowAllArrows ? 'Showing all arrows' : 'Hover to preview arrows'}</span>
                </label>
                <div class="topology-legend">
                  <span class="topology-legend-item">💻 endpoint workbench</span>
                  <span class="topology-legend-item">👑 main agent</span>
                  <span class="topology-legend-item">⬈ dotted arrow = delegates to</span>
                  <span class="topology-legend-item">♻ cycles blocked</span>
                  <span class="topology-legend-item">${this.topologyEdges.length} delegation link${this.topologyEdges.length === 1 ? '' : 's'}</span>
                </div>
              </div>
            </div>
            <div class="topology-help" style="margin-top: 14px;">
              The visual board edits the same config used elsewhere: <strong>endpoints[].agents</strong> for placement and <strong>subagents.allowAgents</strong> for delegation.
            </div>
            ${!this.topologyShowAllArrows ? html`
              <div class="topology-help" style="margin-top: 10px;">
                Hover an agent card with delegates to preview only that agent's outgoing delegation arrows.
              </div>
            ` : ''}
          </div>
          <div class="topology-main-grid">
            <div class="topology-board-column">
              <div class="topology-notice ${this.topologyNotice ? '' : 'placeholder'}">
                ${this.topologyNotice
                  ? html`<span><strong>Workbench:</strong> ${this.topologyNotice}</span>`
                  : html`<span>Workbench status and delegation feedback appears here.</span>`}
              </div>

              <div class="card">
                <div class="topology-scroll">
                  <div class="topology-board" style="min-width: ${Math.max(estimatedBoardWidth, 960)}px; min-height: ${boardHeight}px;">
                    <div class="topology-columns">
                    ${slots.map((slot: any) => {
                      const isDropTarget = this.topologyHoverEndpointKey === slot.key;
                      return html`
                        <section
                          class="topology-slot ${isDropTarget ? 'drop-target' : ''}"
                          style="width: ${slot.slotWidth}px;"
                          @dragover=${(event: DragEvent) => {
                            event.preventDefault();
                            this.topologyHoverEndpointKey = slot.key;
                          }}
                          @dragleave=${() => {
                            if (this.topologyHoverEndpointKey === slot.key) {
                              this.topologyHoverEndpointKey = null;
                            }
                          }}
                          @drop=${(event: DragEvent) => {
                            event.preventDefault();
                            this.handleTopologyDrop(slot.endpointKey);
                          }}>
                          <div class="topology-slot-header">
                            <div class="topology-slot-title">
                              <span class="topology-slot-icon">${slot.icon}</span>
                              <div class="topology-slot-heading">
                                <strong>${slot.title}</strong>
                                <span>${slot.subtitle}</span>
                              </div>
                            </div>
                            <span class="topology-slot-badge">${slot.agents.length} agent${slot.agents.length === 1 ? '' : 's'}</span>
                          </div>
                          <div class="topology-slot-body" style=${`grid-template-columns: repeat(${slot.columnCount}, minmax(0, 1fr)); column-gap: ${slot.columnGap}px;`}>
                            ${slot.agents.length === 0 ? html`
                              <div class="topology-slot-empty">
                                ${slot.endpointKey ? 'Drop an agent here to assign this endpoint.' : 'Agents without a resolved endpoint appear here.'}
                              </div>
                            ` : ''}
                            ${slot.agents.map((entry: any, index: number) => {
                              const delegateCount = this.getAgentDelegationTargets(entry.agent).length;
                              const isLinkSource = this.topologyLinkSourceAgentId === entry.id;
                              const isHoverPreview = !this.topologyShowAllArrows && !isLinkSource && previewSourceAgentId === entry.id && delegateCount > 0;
                              const hasSubagentsDisabled = entry.agent?.subagents?.enabled === false;
                              const primaryWorkspace = this.getWorkspaceForAgentId(entry.id);
                              const workspaceOptions = this.getWorkspaceAssignmentOptions(entry.id);
                              const dashboardSessions = this.getTopologySessionsForAgent(entry.id);
                              const columnIndex = slot.columnCount > 1 ? (index % slot.columnCount) : 0;
                              const isSelected = selectedTopologyAgentId === entry.id;
                              return html`
                                <div
                                  class="topology-agent ${entry.enabled ? '' : 'disabled'} ${entry.isMain ? 'main-agent' : ''} ${isLinkSource ? 'link-source' : ''} ${isHoverPreview ? 'topology-hover-preview' : ''} ${isSelected ? 'selected' : ''} ${this.topologyDraggedAgentKey === entry.key ? 'dragging' : ''}"
                                  data-topology-agent-id=${entry.id}
                                  data-topology-slot-key=${slot.key}
                                  data-topology-column=${String(columnIndex)}
                                  draggable="true"
                                  @mouseenter=${() => { this.topologyHoverAgentId = entry.id; }}
                                  @mouseleave=${() => {
                                    if (this.topologyHoverAgentId === entry.id) {
                                      this.topologyHoverAgentId = null;
                                    }
                                  }}
                                  @dragstart=${(event: DragEvent) => {
                                    this.startTopologyDrag(entry.key);
                                    event.dataTransfer?.setData('text/plain', entry.key);
                                    if (event.dataTransfer) {
                                      event.dataTransfer.effectAllowed = 'move';
                                    }
                                  }}
                                  @dragend=${() => this.endTopologyDrag()}
                                  @click=${() => this.handleTopologyAgentClick(entry.id)}>
                                  <div class="topology-agent-header">
                                    <div class="topology-agent-title">
                                      <span class="topology-agent-avatar">${entry.isMain ? '👑' : '🧍'}</span>
                                      <div style="min-width: 0;">
                                        <strong>${entry.name}</strong>
                                        <div style="color: #777; font-size: 0.72rem;">${entry.id}</div>
                                      </div>
                                    </div>
                                    <div class="topology-agent-header-actions">
                                      <label
                                        class="topology-agent-toggle ${entry.enabled ? '' : 'disabled'}"
                                        @click=${(event: Event) => event.stopPropagation()}
                                        @pointerdown=${(event: Event) => event.stopPropagation()}>
                                        <input
                                          type="checkbox"
                                          .checked=${!!entry.enabled}
                                          @click=${(event: Event) => event.stopPropagation()}
                                          @change=${(event: any) => {
                                            event.stopPropagation();
                                            this.setTopologyAgentEnabled(entry.id, !!event.target.checked);
                                          }}>
                                        <span>${entry.enabled ? 'Enabled' : 'Disabled'}</span>
                                      </label>
                                    </div>
                                  </div>

                                  <div class="topology-agent-badges">
                                    ${entry.isMain ? html`<span class="topology-pill main">Main</span>` : ''}
                                    ${!entry.enabled ? html`<span class="topology-pill disabled">Disabled</span>` : ''}
                                    <span class="topology-pill ${entry.workspaceMode === 'shared' ? 'shared' : 'private'}">${entry.workspaceMode}</span>
                                    <span class="topology-pill ${entry.modelSource === 'local' ? 'local' : 'hosted'}">${entry.modelSource}</span>
                                    <span class="topology-pill">${delegateCount} delegate${delegateCount === 1 ? '' : 's'}</span>
                                    ${hasSubagentsDisabled ? html`<span class="topology-pill disabled">delegation off</span>` : ''}
                                  </div>

                                  <div class="topology-agent-meta">
                                    <div class="topology-agent-workspace">
                                      <span class="topology-agent-workspace-icon">📁</span>
                                      <select
                                        .value=${primaryWorkspace?.id || ''}
                                        @click=${(event: Event) => event.stopPropagation()}
                                        @pointerdown=${(event: Event) => event.stopPropagation()}
                                        @change=${(event: any) => {
                                          event.stopPropagation();
                                          this.setTopologyAgentWorkspace(entry.id, event.target.value || null);
                                        }}>
                                        <option value="">No workspace</option>
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
                                    </div>
                                    AGENTS.md: ${this.getMarkdownTemplateSelection(entry.agent, 'AGENTS.md', VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES) || 'custom'}<br>
                                    Model: ${entry.agent.modelRef || 'unassigned'}
                                  </div>

                                  <div class="topology-agent-actions">
                                    <button class="btn btn-primary" ?disabled=${this.topologyAgentSessionBusyKey !== null || !entry.enabled} @click=${(event: Event) => {
                                      event.stopPropagation();
                                      this.createTopologyAgentSession(entry.id);
                                    }}>
                                      New Chat
                                    </button>
                                    <button class="btn btn-ghost" @click=${(event: Event) => {
                                      event.stopPropagation();
                                      this.selectTopologyDelegationSource(entry.id);
                                    }}>
                                      ${isLinkSource ? 'Cancel' : 'Delegation'}
                                    </button>
                                    <button class="btn btn-ghost" @click=${(event: Event) => {
                                      event.stopPropagation();
                                      this.setTopologyAgentDelegationEnabled(entry.id, hasSubagentsDisabled);
                                    }}>
                                      ${hasSubagentsDisabled ? 'Enable Delegation' : 'Disable Delegation'}
                                    </button>
                                    <button class="btn btn-ghost" @click=${(event: Event) => {
                                      event.stopPropagation();
                                      this.openTopologyAgentEditor(entry.key);
                                    }}>
                                      Details
                                    </button>
                                  </div>

                                  ${dashboardSessions.length > 0 ? html`
                                    <div class="topology-agent-session-strip">
                                      ${dashboardSessions.slice(0, 3).map((session: any) => html`
                                        <div class="topology-agent-session-chip" title=${session.key}>
                                          <span>${session.label}</span>
                                          <button
                                            type="button"
                                            title="Close and delete session"
                                            ?disabled=${this.topologyAgentSessionBusyKey !== null}
                                            @click=${(event: Event) => {
                                              event.stopPropagation();
                                              this.closeTopologyAgentSession(session.key);
                                            }}>×</button>
                                        </div>
                                      `)}
                                    </div>
                                  ` : ''}

                                  ${this.topologyLinkSourceAgentId && this.topologyLinkSourceAgentId !== entry.id ? html`
                                    <div class="topology-card-link-hint">
                                      ${this.hasDelegationEdge(this.topologyLinkSourceAgentId, entry.id)
                                        ? 'Click to remove delegation'
                                        : 'Click to delegate here'}
                                    </div>
                                  ` : ''}
                                </div>
                              `;
                            })}
                          </div>
                        </section>
                      `;
                    })}
                    </div>
                    <div class="topology-edge-overlay" aria-hidden="true">
                      ${orderedVisibleEdges.flatMap((edge: any) => {
                        const edgeColor = this.getTopologyEdgeColor(edge);
                        return (Array.isArray(edge.renderSegments) ? edge.renderSegments : []).map((segment: any) => html`
                        <div
                          class="topology-edge-hit ${segment.orientation}"
                          style=${segment.orientation === 'h'
                            ? `left:${segment.left}px; top:${segment.top - 2}px; width:${segment.width}px; height:${segment.height + 4}px;`
                            : `left:${segment.left - 2}px; top:${segment.top}px; width:${segment.width + 4}px; height:${segment.height}px;`}
                          @mouseenter=${() => { this.topologyHoverEdgeKey = edge.key; }}
                          @mouseleave=${() => {
                            if (this.topologyHoverEdgeKey === edge.key) {
                              this.topologyHoverEdgeKey = null;
                            }
                          }}>
                        </div>
                        <div
                          class="topology-edge-segment ${segment.orientation}"
                          style=${`left:${segment.left}px; top:${segment.top}px; width:${segment.width}px; height:${segment.height}px; --edge-color:${edgeColor};`}>
                        </div>
                      `);
                      })}
                      ${orderedVisibleEdges.map((edge: any) => {
                        if (!edge.arrowHead) {
                          return '';
                        }
                        const edgeColor = this.getTopologyEdgeColor(edge);
                        return html`
                        <div
                          class="topology-edge-arrowhead-hit"
                          style=${`left:${edge.arrowHead.x}px; top:${edge.arrowHead.y}px; transform: translate(-50%, -50%) rotate(${edge.arrowHead.rotation}deg);`}
                          @mouseenter=${() => { this.topologyHoverEdgeKey = edge.key; }}
                          @mouseleave=${() => {
                            if (this.topologyHoverEdgeKey === edge.key) {
                              this.topologyHoverEdgeKey = null;
                            }
                          }}>
                        </div>
                        <div
                          class="topology-edge-arrowhead"
                          style=${`left:${edge.arrowHead.x}px; top:${edge.arrowHead.y}px; --edge-color:${edgeColor}; transform: translate(-50%, -50%) rotate(${edge.arrowHead.rotation}deg);`}>
                        </div>
                      `;
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="topology-inspector-column">
              <div class="topology-inspector-sticky">
                ${selectedTopologyEntry ? this.renderTopologyInspector(selectedTopologyEntry) : html`
                  <div class="card">
                    <div class="card-header"><h3>Agent Inspector</h3></div>
                    <div class="topology-help">Select an agent card to inspect its effective markdown, toolsets, and delegation settings.</div>
                  </div>
                `}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    renderTopologyInspector(selectedEntry: any) {
      const agent = selectedEntry.agent;
      const subagents = this.ensureSubagentsConfig(agent);
      const delegateTargets = this.getAgentDelegationTargets(agent);
      const selectedEndpoint = this.resolveAgentEndpoint(agent);
      const primaryWorkspace = this.getWorkspaceForAgentId(agent.id);
      const workspaceOptions = this.getWorkspaceAssignmentOptions(agent.id);
      const appliedToolsets = this.getAgentAppliedToolsets(agent);
      const effectiveToolState = this.getEffectiveAgentToolState(agent);
      const dashboardSessions = this.getTopologySessionsForAgent(selectedEntry.id);
      const selectedMarkdownFile = VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES.includes(this.topologyInspectorMarkdownFile as any)
        ? this.topologyInspectorMarkdownFile
        : 'AGENTS.md';
      const combinedMarkdown = this.getCombinedAgentBootstrapMarkdown(agent, selectedMarkdownFile);
      const markdownValue = combinedMarkdown.effectiveValue || '';

      return html`
        <div class="card">
          <div class="card-header">
            <h3>Agent Inspector</h3>
            <button class="btn btn-ghost" @click=${() => this.openTopologyAgentEditor(selectedEntry.key)}>Open Full Editor</button>
          </div>

          <div class="topology-inspector-meta">
            <div><strong>${selectedEntry.name}</strong> <span style="color:#777;">(${selectedEntry.id})</span></div>
            <div>Endpoint: <strong>${selectedEndpoint ? this.getEndpointLabel(selectedEndpoint) : 'Unassigned'}</strong></div>
            <div>
              Workspace:
              <select
                .value=${primaryWorkspace?.id || ''}
                style="margin-left: 8px; min-width: 240px;"
                @change=${(event: any) => this.setTopologyAgentWorkspace(selectedEntry.id, event.target.value || null)}>
                <option value="">No workspace</option>
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
            </div>
            <div>Model: <strong>${agent.modelRef || 'unassigned'}</strong></div>
          </div>

          <div class="help-text" style="margin-top: 10px;">
            Switching the home workspace here updates the same primary workspace assignment used by the full agent editor.
          </div>

          <div class="topology-inspector-section">
            <div class="card-header" style="padding: 0 0 10px; margin-bottom: 0; border-bottom: none;">
              <h3 style="font-size: 1rem;">Interactive Agent Sessions</h3>
              <button
                class="btn btn-primary"
                ?disabled=${this.topologyAgentSessionBusyKey !== null || !selectedEntry.enabled}
                @click=${() => this.createTopologyAgentSession(selectedEntry.id)}>
                New Persistent Chat
              </button>
            </div>
            <div class="topology-help">
              Opens this agent directly in a persistent OpenClaw chat session. Keep this dashboard open and it will best-effort abort and delete dashboard-created sessions when their chat tabs close.
            </div>
            ${this.topologyAgentSessionError ? html`<div class="error" style="margin-top: 10px;">${this.topologyAgentSessionError}</div>` : ''}
            <div class="topology-agent-session-panel">
              ${dashboardSessions.length === 0
                ? html`<div class="toolset-preview-empty">No dashboard-created sessions for this agent yet.</div>`
                : dashboardSessions.map((session: any) => html`
                    <div class="topology-agent-session-row">
                      <div>
                        <div class="topology-agent-session-row-title">${session.label}</div>
                        <div class="topology-agent-session-row-meta">${session.key}</div>
                      </div>
                      <button class="btn btn-ghost" @click=${() => this.openTopologyAgentSession(session.key, session.url)}>Open</button>
                      <button
                        class="btn btn-danger"
                        ?disabled=${this.topologyAgentSessionBusyKey !== null}
                        @click=${() => this.closeTopologyAgentSession(session.key)}>
                        Close
                      </button>
                    </div>
                  `)}
            </div>
          </div>

          <div class="topology-inspector-section">
            <label class="toggle-switch" style="font-size: 0.95rem; font-weight: 700; color: #fff;">
              <input type="checkbox" .checked=${!!selectedEntry.enabled} @change=${(event: any) => this.setTopologyAgentEnabled(selectedEntry.id, !!event.target.checked)}>
              Agent enabled for toolkit-managed config
            </label>
            <div class="help-text" style="margin-top: 8px;">Disabled agents remain in toolkit config for later use, but bootstrap stops propagating them into live OpenClaw config.</div>
          </div>

          <div class="topology-inspector-section">
            <label class="toggle-switch" style="font-size: 0.95rem; font-weight: 700; color: #fff;">
              <input type="checkbox" .checked=${!!subagents.enabled} @change=${(event: any) => this.setTopologyAgentDelegationEnabled(selectedEntry.id, !!event.target.checked)}>
              Delegation enabled for this agent
            </label>
            <div class="help-text" style="margin-top: 8px;">Turning delegation off pauses this agent's ability to spawn or delegate, but it keeps the configured allowed agents in place.</div>
            ${renderPreviewRows([{
              label: 'Allowed Delegatees',
              body: renderPreviewTags(
                delegateTargets,
                (targetId: string) => {
                  const targetEntry = this.getTopologyAgentEntryById(targetId);
                  return html`<div class="tag">${targetEntry ? `${targetEntry.name} (${targetId})` : targetId}</div>`;
                },
                html`No delegate targets configured.`
              )
            }], 'margin-top: 12px;')}
          </div>

          <div class="topology-inspector-section">
            <div class="card-header" style="padding: 0 0 10px; margin-bottom: 0; border-bottom: none;">
              <h3 style="font-size: 1rem;">Combined Toolset</h3>
            </div>
            <div class="help-text" style="margin-top: 0; margin-bottom: 12px;">This is the effective toolkit toolset stack for the selected agent, including the always-on global <code>minimal</code> chat-only baseline.</div>
            <details class="topology-expander">
              <summary>Applied toolset layers (${appliedToolsets.length})</summary>
              <div class="topology-expander-body">
                <div class="applied-toolset-list">
                  ${appliedToolsets.map((toolset: any) => {
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
                    ], undefined, toolset.key === 'minimal' ? html`<span class="badge">Global</span>` : '');
                  })}
                </div>
              </div>
            </details>
            ${renderPreviewRows([
              {
                label: 'Final Allow',
                body: renderPreviewTags(
                  effectiveToolState.allowedTools,
                  (toolId: string) => html`<div class="tag">${renderToolLabel(this.getToolOption(toolId), toolId)}</div>`,
                  html`No allowed tools.`
                )
              },
              {
                label: 'Final Deny',
                body: renderPreviewTags(
                  effectiveToolState.deniedTools,
                  (toolId: string) => html`<div class="tag">${renderToolLabel(this.getToolOption(toolId), toolId)}</div>`,
                  html`No denied tools.`
                )
              }
            ], 'margin-top: 14px;')}
          </div>

          <div class="topology-inspector-section">
            <div class="card-header" style="padding: 0 0 10px; margin-bottom: 0; border-bottom: none;">
              <h3 style="font-size: 1rem;">Combined Markdown</h3>
            </div>
            <div class="help-text" style="margin-top: 0; margin-bottom: 12px;">Preview the layered bootstrap markdown for the selected agent. Workspace content and agent-specific overlay markdown are shown together when both exist.</div>
            <div class="topology-markdown-tabs">
              ${VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES.map((fileName) => html`
                <div class="topology-markdown-tab ${selectedMarkdownFile === fileName ? 'active' : ''}" @click=${() => { this.topologyInspectorMarkdownFile = fileName; }}>
                  ${fileName.replace('.md', '')}
                </div>
              `)}
            </div>
            <div class="help-text" style="margin-top: 0; margin-bottom: 8px;">
              ${combinedMarkdown.sourceLabels.length > 0
                ? html`${combinedMarkdown.sourceLabels.join(' + ')} for <code>${selectedMarkdownFile}</code>.`
                : html`No workspace or agent markdown is defined for <code>${selectedMarkdownFile}</code> yet.`}
            </div>
            <textarea rows=${Math.max(8, this.getMarkdownEditorRows(selectedMarkdownFile))} .value=${markdownValue} readonly placeholder="No effective markdown content for this file yet."></textarea>
          </div>
        </div>
      `;
    }
  };
