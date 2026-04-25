import { LitElement, html } from 'lit';
import {
  VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES,
  VALID_WORKSPACE_MARKDOWN_FILES
} from './toolkit-dashboard-constants';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTopologyMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTopologyMixin extends Base {
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
          <div class="toolset-preview-rows" style="margin-top: 12px;">
            <div class="toolset-preview-row">
              <div class="toolset-preview-label">Allowed Delegatees</div>
              ${delegateTargets.length === 0
                ? html`<div class="toolset-preview-empty">No delegate targets configured.</div>`
                : html`<div class="toolset-preview-tags">
                    ${delegateTargets.map((targetId: string) => {
                      const targetEntry = this.getTopologyAgentEntryById(targetId);
                      return html`<div class="tag">${targetEntry ? `${targetEntry.name} (${targetId})` : targetId}</div>`;
                    })}
                  </div>`}
            </div>
          </div>
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
                  return html`
                    <div class="applied-toolset-card">
                      <div class="applied-toolset-header">
                        <strong>${toolset.name || toolset.key}</strong>
                        ${toolset.key === 'minimal' ? html`<span class="badge">Global</span>` : ''}
                      </div>
                      <div class="toolset-preview-rows">
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Allow</div>
                          ${allowedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No allowed tools.</div>`
                            : html`<div class="toolset-preview-tags">${allowedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}</div>`}
                        </div>
                        <div class="toolset-preview-row">
                          <div class="toolset-preview-label">Deny</div>
                          ${deniedTools.length === 0
                            ? html`<div class="toolset-preview-empty">No denied tools.</div>`
                            : html`<div class="toolset-preview-tags">${deniedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}</div>`}
                        </div>
                      </div>
                    </div>
                  `;
                })}
              </div>
            </div>
          </details>
          <div class="toolset-preview-rows" style="margin-top: 14px;">
            <div class="toolset-preview-row">
              <div class="toolset-preview-label">Final Allow</div>
              ${effectiveToolState.allowedTools.length === 0
                ? html`<div class="toolset-preview-empty">No allowed tools.</div>`
                : html`<div class="toolset-preview-tags">${effectiveToolState.allowedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}</div>`}
            </div>
            <div class="toolset-preview-row">
              <div class="toolset-preview-label">Final Deny</div>
              ${effectiveToolState.deniedTools.length === 0
                ? html`<div class="toolset-preview-empty">No denied tools.</div>`
                : html`<div class="toolset-preview-tags">${effectiveToolState.deniedTools.map((toolId: string) => html`<div class="tag">${this.renderToolLabel(toolId)}</div>`)}</div>`}
            </div>
          </div>
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


  renderLogs() {
    return html`
      <header>
        <h2>Process Output</h2>
        ${this.isRunning ? html`
          <button class="btn btn-danger" @click=${() => this.cancelCommand()}>⏹ Cancel</button>
        ` : ''}
      </header>
      <div class="log-container">
        ${this.logs.map((line: string) => html`<div class="log-entry">${line}</div>`)}
      </div>
    `;
  }


  renderOps() {
    const ops = [
      { id: 'prereqs', name: 'Check Prerequisites', desc: 'Audit Windows, Docker, and WSL setup' },
      { id: 'bootstrap', name: 'Bootstrap', desc: 'Full installation/hardening' },
      { id: 'update', name: 'Update', desc: 'Update OpenClaw repo and rebuild' },
      { id: 'verify', name: 'Verify', desc: 'Run smoke tests and health checks' },
      { id: 'agent-smoke', name: 'Agent Smoke Test', desc: 'Run the managed agent behavior smoke for shared-workspace file/git, research, review, and coder flows' },
      { id: 'start', name: 'Start', desc: 'Start all services and OpenClaw' },
      { id: 'onboard', name: 'Interactive Onboarding', desc: 'Launch openclaw onboard in a separate PowerShell window so you can answer prompts and make onboarding choices' },
      { id: 'telegram-setup', name: 'Telegram Setup', desc: 'Launch the interactive Telegram channel setup wizard in a separate PowerShell window without storing any token in toolkit config' },
      { id: 'telegram-ids', name: 'Telegram Seen IDs', desc: 'Scan recent Telegram gateway logs for user and group IDs when you need values for allowlists or group routing' },
      { id: 'cleanup-containers', name: 'Preview Container Cleanup', desc: 'List stale OpenClaw Docker containers, such as exited sandbox workers, without removing anything' },
      { id: 'cleanup-containers', args: ['-Remove'], name: 'Cleanup Container Leftovers', desc: 'Remove stopped OpenClaw Docker leftovers. Running gateway containers are skipped.', confirmText: 'Remove stopped OpenClaw Docker leftovers?\n\nThis targets exited OpenClaw sandbox workers and stopped containers from the OpenClaw Docker Compose project. Running gateway containers are skipped.' },
      { id: 'reset-config', name: 'Reset Configuration', desc: 'Restore the managed bootstrap config to the toolkit starter defaults. The current config is backed up first as openclaw-bootstrap.config.json.bak.', confirmText: 'Reset the managed bootstrap config to the toolkit starter defaults?\n\nThis overwrites openclaw-bootstrap.config.json and saves the previous file as openclaw-bootstrap.config.json.bak.' },
      { id: 'stop', name: 'Stop', desc: 'Stop all services and OpenClaw' },
      { id: 'cli', args: ['--version'], name: 'OpenClaw CLI Version', desc: 'Run openclaw --version inside the gateway container and stream the result' },
      { id: 'cli', args: ['doctor'], name: 'OpenClaw Doctor', desc: 'Run openclaw doctor inside the gateway container and stream config diagnostics' },
      { id: 'cli', args: ['gateway', 'status'], name: 'OpenClaw Gateway Status', desc: 'Run openclaw gateway status inside the gateway container and stream the result' },
      { id: 'toolkit-dashboard-rebuild', name: 'Rebuild Toolkit Dashboard', desc: 'Rebuild UI and restart the toolkit dashboard server. Page will auto-reconnect.' }
    ];

    return html`
      <header><h2>Available Operations</h2></header>
      <div class="grid-2">
        ${ops.map(op => html`
          <div class="card">
            <h3>${op.name}</h3>
            <p style="color: #888; font-size: 0.85rem; margin: 10px 0 20px;">${op.desc}</p>
            <button class="btn btn-primary" ?disabled=${this.isRunning} @click=${() => this.runOperation(op)}>Run Action</button>
          </div>
        `)}
      </div>
    `;
  }


  renderConfig() {
    if (!this.config) return html`<p>Loading config...</p>`;

    return html`
      <header>
        <div style="display: flex; gap: 10px;">
          <div class="tab ${this.configSection === 'general' ? 'active' : ''}" @click=${() => this.configSection = 'general'}>General</div>
          <div class="tab ${this.configSection === 'sandbox' ? 'active' : ''}" @click=${() => this.configSection = 'sandbox'}>Sandbox</div>
          <div class="tab ${this.configSection === 'endpoints' ? 'active' : ''}" @click=${() => this.configSection = 'endpoints'}>Endpoints</div>
          <div class="tab ${this.configSection === 'models' ? 'active' : ''}" @click=${() => this.configSection = 'models'}>Models Catalog</div>
          <div class="tab ${this.configSection === 'markdownTemplates' ? 'active' : ''}" @click=${() => this.configSection = 'markdownTemplates'}>Template Markdowns</div>
          <div class="tab ${this.configSection === 'toolsets' ? 'active' : ''}" @click=${() => this.configSection = 'toolsets'}>Toolsets</div>
          <div class="tab ${this.configSection === 'agents' ? 'active' : ''}" @click=${() => this.configSection = 'agents'}>Agents</div>
          <div class="tab ${this.configSection === 'workspaces' ? 'active' : ''}" @click=${() => this.configSection = 'workspaces'}>Workspaces</div>
          <div class="tab ${this.configSection === 'features' ? 'active' : ''}" @click=${() => this.configSection = 'features'}>Features</div>
        </div>
        <div style="display: flex; gap: 10px;">
           <button class="btn btn-ghost" ?disabled=${this.hasConfigValidationErrors} @click=${this.saveConfig}>Save Only</button>
           <button class="btn btn-primary" ?disabled=${this.hasConfigValidationErrors} @click=${this.applyAndRestart}>Save & Apply (Restart Agents)</button>
        </div>
      </header>

      ${this.hasConfigValidationErrors ? html`
        <div class="card" style="border-color: #ff9800; margin-bottom: 20px;">
          <div class="help-text" style="color: #ff9800; margin: 0;">${this.getValidationErrors()[0]}</div>
        </div>
      ` : ''}

      ${this.renderConfigSection()}
    `;
  }


  renderConfigSection() {
    switch (this.configSection) {
      case 'general': return this.renderGeneralConfig();
      case 'sandbox': return this.renderSandboxConfig();
      case 'endpoints': return this.renderEndpointsConfig();
      case 'models': return this.renderModelsConfig();
      case 'markdownTemplates': return this.renderTemplateMarkdownsConfig();
      case 'toolsets': return this.renderToolsetsConfig();
      case 'agents': return this.renderAgentsConfig();
      case 'workspaces': return this.renderWorkspacesConfig();
      case 'features': return this.renderFeaturesConfig();
      default: return html``;
    }
  }


  renderGeneralConfig() {
    return html`
      <div class="card">
        <div class="card-header"><h3>Base Settings</h3></div>
        <div class="grid-2">
          <div class="form-group">
            <label>Gateway Port</label>
            <input type="number" .value=${this.config.gatewayPort} @input=${(e: any) => this.config.gatewayPort = parseInt(e.target.value)}>
          </div>
          <div class="form-group">
            <label>Gateway Bind</label>
            <select @change=${(e: any) => this.config.gatewayBind = e.target.value}>
              <option value="lan" ?selected=${this.config.gatewayBind === 'lan'}>LAN</option>
              <option value="localhost" ?selected=${this.config.gatewayBind === 'localhost'}>Localhost</option>
            </select>
          </div>
        </div>
        <div class="form-group">
            <label class="toggle-switch">
                <input type="checkbox" ?checked=${this.config.ollama.enabled} @change=${(e: any) => { this.config.ollama.enabled = e.target.checked; this.requestUpdate(); }}>
                Enable Ollama Local Models Support
            </label>
        </div>
        <div class="form-group">
            <label class="toggle-switch">
                <input type="checkbox" ?checked=${this.config.skills.enableAll} @change=${(e: any) => { this.config.skills.enableAll = e.target.checked; this.requestUpdate(); }}>
                Enable All Skills
            </label>
            <div class="help-text">Recommended. When off, bootstrap disables skills for the default agent and toolkit-managed agents.</div>
        </div>
        <div class="form-group">
          <label>Auto-Pull VRAM Budget (%)</label>
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            .value=${String(Math.round((typeof this.config.ollama.pullVramBudgetFraction === 'number' ? this.config.ollama.pullVramBudgetFraction : 0.7) * 100))}
            @input=${(e: any) => {
              const parsed = Number(e.target.value);
              const normalized = Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) / 100 : 0.7;
              this.config.ollama.pullVramBudgetFraction = normalized;
              this.requestUpdate();
            }}>
          <div class="help-text">Auto-pull rejects local models above this percentage of an endpoint's total GPU VRAM.</div>
        </div>
        <div class="form-group">
          <label>Model Fit VRAM Headroom (MiB)</label>
          <input
            type="number"
            min="0"
            step="128"
            .value=${String(Math.round(typeof this.config.ollama.vramHeadroomMiB === 'number' ? this.config.ollama.vramHeadroomMiB : 1536))}
            @input=${(e: any) => {
              const parsed = Number(e.target.value);
              const normalized = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 1536;
              this.config.ollama.vramHeadroomMiB = normalized;
              this.requestUpdate();
            }}>
          <div class="help-text">Reserve this much GPU VRAM when probing the largest safe local-model context window.</div>
        </div>
      </div>
    `;
  }


  renderSandboxConfig() {
    return html`
      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h3>Sandbox Defaults</h3></div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${this.config.sandbox.enabled} @change=${(e: any) => { this.config.sandbox.enabled = e.target.checked; this.requestUpdate(); }}>
              Enable sandbox support
            </label>
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label>Mode</label>
              <select @change=${(e: any) => { this.config.sandbox.mode = e.target.value; this.requestUpdate(); }}>
                <option value="off" ?selected=${this.config.sandbox.mode === 'off'}>off</option>
                <option value="all" ?selected=${this.config.sandbox.mode === 'all'}>all</option>
                <option value="workspace-write" ?selected=${this.config.sandbox.mode === 'workspace-write'}>workspace-write</option>
              </select>
            </div>
            <div class="form-group">
              <label>Scope</label>
              <select @change=${(e: any) => { this.config.sandbox.scope = e.target.value; this.requestUpdate(); }}>
                <option value="session" ?selected=${this.config.sandbox.scope === 'session'}>session</option>
                <option value="task" ?selected=${this.config.sandbox.scope === 'task'}>task</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Workspace Access</label>
            <select @change=${(e: any) => { this.config.sandbox.workspaceAccess = e.target.value; this.requestUpdate(); }}>
              <option value="ro" ?selected=${this.config.sandbox.workspaceAccess === 'ro'}>read-only</option>
              <option value="rw" ?selected=${this.config.sandbox.workspaceAccess === 'rw'}>read-write</option>
            </select>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${this.config.sandbox.toolsFsWorkspaceOnly} @change=${(e: any) => { this.config.sandbox.toolsFsWorkspaceOnly = e.target.checked; this.requestUpdate(); }}>
              Limit filesystem tools to workspace only
            </label>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${this.config.sandbox.applyPatchWorkspaceOnly} @change=${(e: any) => { this.config.sandbox.applyPatchWorkspaceOnly = e.target.checked; this.requestUpdate(); }}>
              Limit apply_patch to workspace only
            </label>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Sandbox Images and Docker Socket</h3></div>
          <div class="form-group">
            <label>Docker Socket Source</label>
            <input type="text" .value=${this.config.sandbox.dockerSocketSource || ''} @input=${(e: any) => { this.config.sandbox.dockerSocketSource = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Docker Socket Target</label>
            <input type="text" .value=${this.config.sandbox.dockerSocketTarget || ''} @input=${(e: any) => { this.config.sandbox.dockerSocketTarget = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Docker Socket Group</label>
            <input type="text" .value=${this.config.sandbox.dockerSocketGroup || ''} @input=${(e: any) => { this.config.sandbox.dockerSocketGroup = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label class="toggle-switch">
              <input type="checkbox" ?checked=${this.config.sandbox.buildGatewayImageWithDockerCli} @change=${(e: any) => { this.config.sandbox.buildGatewayImageWithDockerCli = e.target.checked; this.requestUpdate(); }}>
              Build gateway image with Docker CLI
            </label>
          </div>
          <div class="form-group">
            <label>Gateway Image Tag</label>
            <input type="text" .value=${this.config.sandbox.gatewayImageTag || ''} @input=${(e: any) => { this.config.sandbox.gatewayImageTag = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Sandbox Base Image</label>
            <input type="text" .value=${this.config.sandbox.sandboxBaseImage || ''} @input=${(e: any) => { this.config.sandbox.sandboxBaseImage = e.target.value; this.requestUpdate(); }}>
          </div>
          <div class="form-group">
            <label>Sandbox Image</label>
            <input type="text" .value=${this.config.sandbox.sandboxImage || ''} @input=${(e: any) => { this.config.sandbox.sandboxImage = e.target.value; this.requestUpdate(); }}>
          </div>
        </div>
      </div>
    `;
  }

  getConfigEndpoints() {
    return this.getConfigEndpointsFrom(this.config);
  }

  getSortedConfigEndpoints() {
    return [...this.getConfigEndpoints()].sort((left: any, right: any) => {
      const leftDefault = left?.default ? 0 : 1;
      const rightDefault = right?.default ? 0 : 1;
      if (leftDefault !== rightDefault) {
        return leftDefault - rightDefault;
      }
      return String(left?.name || left?.key || '').localeCompare(String(right?.name || right?.key || ''));
    });
  }

  getDefaultEndpoint() {
    const endpoints = this.getSortedConfigEndpoints();
    return endpoints.find((endpoint: any) => !!endpoint?.default) || endpoints[0] || null;
  }

  canRemoveEndpoint(endpoint: any) {
    return !endpoint?.default;
  }

  getEndpointsForModelRef(modelRef: string | undefined) {
    if (typeof modelRef !== 'string' || modelRef.length === 0) {
      return [];
    }

    return this.getConfigEndpoints().filter((endpoint: any) =>
      this.getEndpointModelOptions(endpoint).some((option: any) => option.ref === modelRef)
    );
  }

  resolveAgentEndpoint(agent: any) {
    const agentId = String(agent?.id || '').trim();
    if (!agentId) {
      return null;
    }

    for (const endpoint of this.getConfigEndpoints()) {
      if (this.getEndpointAgentIds(endpoint).includes(agentId)) {
        return endpoint;
      }
    }

    return null;
  }

  getEndpointOllama(endpoint: any) {
    if (endpoint?.ollama && typeof endpoint.ollama === 'object') {
      return endpoint.ollama;
    }
    if (endpoint && (endpoint.baseUrl || endpoint.hostBaseUrl || endpoint.providerId || Array.isArray(endpoint.models))) {
      return endpoint;
    }
    return null;
  }

  ensureEndpointOllama(endpoint: any) {
    let runtime = this.getEndpointOllama(endpoint);
    if (runtime && runtime !== endpoint) {
      return runtime;
    }
    if (runtime === endpoint) {
      return endpoint;
    }

    const suffix = String(endpoint?.key || 'local').replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'local';
    endpoint.ollama = {
      enabled: true,
      providerId: suffix === 'local' ? 'ollama' : `ollama-${suffix}`,
      hostBaseUrl: 'http://127.0.0.1:11434',
      baseUrl: 'http://host.docker.internal:11434',
      apiKey: suffix === 'local' ? 'ollama-local' : `ollama-${suffix}`,
      autoPullMissingModels: true,
      models: []
    };
    return endpoint.ollama;
  }

  getEndpointModels(endpoint: any) {
    const runtime = this.getEndpointOllama(endpoint);
    if (Array.isArray(runtime?.models)) {
      return runtime.models;
    }
    return [];
  }

  sanitizeModelEntries(models: any[] | undefined) {
    if (!Array.isArray(models)) return [];
    return models.map((model: any) => {
      const clone = JSON.parse(JSON.stringify(model));
      delete clone.name;
      delete clone.vramEstimateMiB;
      this.normalizeParamsRecord(clone);
      this.setOrderedFallbackModelIds(clone, this.getOrderedFallbackModelIds(clone));
      return clone;
    });
  }

  sanitizeSharedCatalogEntries(models: any[] | undefined) {
    return this.sanitizeModelEntries(models).map((model: any) => {
      delete model.fallbackModelIds;
      return model;
    });
  }

  isReasoningCapableModel(model: any) {
    return this.normalizeBoolean(model?.reasoning, false);
  }

  getOrderedFallbackModelIds(model: any) {
    const fallbackIds: string[] = [];
    if (Array.isArray(model?.fallbackModelIds)) {
      for (const rawFallbackId of model.fallbackModelIds) {
        const fallbackId = String(rawFallbackId || '').trim();
        if (fallbackId && !fallbackIds.includes(fallbackId)) {
          fallbackIds.push(fallbackId);
        }
      }
    }
    return fallbackIds;
  }

  setOrderedFallbackModelIds(model: any, fallbackIds: string[]) {
    const normalized: string[] = [];
    const selfId = typeof model?.id === 'string' ? model.id.trim() : '';
    for (const rawFallbackId of Array.isArray(fallbackIds) ? fallbackIds : []) {
      const fallbackId = String(rawFallbackId || '').trim();
      if (!fallbackId || fallbackId === selfId || normalized.includes(fallbackId)) {
        continue;
      }
      normalized.push(fallbackId);
    }

    if (normalized.length > 0) {
      model.fallbackModelIds = normalized;
    } else {
      delete model.fallbackModelIds;
    }
    for (const key of Object.keys(model || {})) {
      if (key.startsWith('fallbackModel') && key !== 'fallbackModelIds') {
        delete model[key];
      }
    }
  }

  describeOrderedLocalFallbacks(model: any) {
    const fallbackIds = this.getOrderedFallbackModelIds(model);
    if (fallbackIds.length === 0) {
      return 'No local fallbacks';
    }
    return `Fallback order: ${fallbackIds.map((fallbackId: string) => `ollama/${fallbackId}`).join(' -> ')}`;
  }

  renderOrderedLocalFallbackEditor(model: any, availableModelIds: string[]) {
    const fallbackIds = this.getOrderedFallbackModelIds(model);
    const availableFallbackIds = availableModelIds.filter((fallbackId: string) => fallbackId !== String(model?.id || '') && !fallbackIds.includes(fallbackId));
    return html`
      <div class="form-group fallback-editor">
        <label>Ordered Local Fallbacks</label>
        <div class="help-text" style="margin-top: 0;">OpenClaw tries fallbacks top-to-bottom. The toolkit also uses this order when it needs to step down to a smaller local model.</div>
        ${fallbackIds.length > 0 ? html`
          <div class="fallback-list">
            ${fallbackIds.map((fallbackId: string, index: number) => html`
              <div class="fallback-row">
                <span class="fallback-label">${index + 1}. ollama/${fallbackId}</span>
                <span class="fallback-actions">
                  <button class="btn btn-ghost" style="padding: 4px 8px;" ?disabled=${index === 0} @click=${() => {
                    const nextFallbackIds = [...fallbackIds];
                    [nextFallbackIds[index - 1], nextFallbackIds[index]] = [nextFallbackIds[index], nextFallbackIds[index - 1]];
                    this.setOrderedFallbackModelIds(model, nextFallbackIds);
                    this.requestUpdate();
                  }}>Up</button>
                  <button class="btn btn-ghost" style="padding: 4px 8px;" ?disabled=${index === fallbackIds.length - 1} @click=${() => {
                    const nextFallbackIds = [...fallbackIds];
                    [nextFallbackIds[index], nextFallbackIds[index + 1]] = [nextFallbackIds[index + 1], nextFallbackIds[index]];
                    this.setOrderedFallbackModelIds(model, nextFallbackIds);
                    this.requestUpdate();
                  }}>Down</button>
                  <button class="btn btn-danger" style="padding: 4px 8px;" @click=${() => {
                    this.setOrderedFallbackModelIds(model, fallbackIds.filter((_: string, candidateIndex: number) => candidateIndex !== index));
                    this.requestUpdate();
                  }}>Remove</button>
                </span>
              </div>
            `)}
          </div>
        ` : html`<div class="item-sub" style="margin-top: 10px;">No local fallbacks configured.</div>`}
        ${availableFallbackIds.length > 0 ? html`
          <select class="fallback-select" @change=${(e: any) => {
            const value = String(e.target.value || '').trim();
            if (value) {
              this.setOrderedFallbackModelIds(model, [...fallbackIds, value]);
              this.requestUpdate();
            }
            e.target.value = '';
          }}>
            <option value="">+ Add fallback at the end</option>
            ${availableFallbackIds.map((fallbackId: string) => html`<option value=${fallbackId}>${fallbackId}</option>`)}
          </select>
        ` : ''}
      </div>
    `;
  }

  getLegacyManagedAgentKeys() {
    return [
      'strongAgent',
      'researchAgent',
      'localChatAgent',
      'hostedTelegramAgent',
      'localReviewAgent',
      'localCoderAgent',
      'remoteReviewAgent',
      'remoteCoderAgent'
    ];
  }

  inferModelSourceFromAgent(agent: any) {
    const refs: string[] = [];
    if (typeof agent?.modelRef === 'string' && agent.modelRef.length > 0) {
      refs.push(agent.modelRef);
    }
    if (Array.isArray(agent?.candidateModelRefs)) {
      for (const ref of agent.candidateModelRefs) {
        if (typeof ref === 'string' && ref.length > 0 && !refs.includes(ref)) {
          refs.push(ref);
        }
      }
    }
    for (const ref of refs) {
      if (ref.startsWith('ollama/')) {
        return 'local';
      }
    }
    for (const ref of refs) {
      if (ref.includes('/')) {
        return 'hosted';
      }
    }
    return 'hosted';
  }

  sanitizeAgentRecord(agent: any, key?: string) {
    const clone = JSON.parse(JSON.stringify(agent || {}));
    if (key) clone.key = key;
    delete clone.modelSource;
    clone.enabled = this.normalizeBoolean(clone.enabled, true);
    clone.thinkingDefault = this.normalizeThinkingDefault(clone.thinkingDefault);
    this.normalizeParamsRecord(clone);
    delete clone.endpointKey;
    clone.markdownTemplateKeys = this.normalizeMarkdownTemplateSelections(clone, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
    delete clone.rolePolicyKey;
    clone.toolsetKeys = this.ensureAgentToolsetKeys(clone);
    const normalizedToolOverrides = this.normalizeAgentToolOverrides(clone);
    if (normalizedToolOverrides) {
      clone.toolOverrides = normalizedToolOverrides;
    } else {
      delete clone.toolOverrides;
    }
    if (!Array.isArray(clone.candidateModelRefs)) {
      clone.candidateModelRefs = [];
    }
    clone.subagents = this.ensureSubagentsConfig(clone);
    if (typeof clone.modelRef !== 'string') {
      clone.modelRef = '';
    }
    clone.modelSource = this.inferModelSourceFromAgent(clone);
    return clone;
  }

  buildPersistedConfig(config: any) {
    const clone = JSON.parse(JSON.stringify(config));
    const defaultTelegramAccountId = (clone.telegram?.defaultAccount && String(clone.telegram.defaultAccount).trim()) || 'default';
    clone.agents = clone.agents || { telegramRouting: {}, list: [] };
    clone.agents.telegramRouting = clone.agents.telegramRouting || {};
    clone.agents.telegramRouting.routes = this.normalizeTelegramRouteList(
      Array.isArray(clone.agents.telegramRouting.routes) ? clone.agents.telegramRouting.routes : [],
      defaultTelegramAccountId
    );
    clone.workspaces = Array.isArray(clone.workspaces) ? clone.workspaces.map((workspace: any) => this.normalizeWorkspaceRecord(workspace)) : [];
    this.ensureToolsetsConfig(clone);
    const normalizedEndpoints = this.getConfigEndpointsFrom(clone).map((endpoint: any) => this.normalizeEndpointRecord(endpoint));
    if (Array.isArray(clone.endpoints)) {
      // Canonicalize any flat endpoint.vramHeadroomMiB into endpoint.ollama.vramHeadroomMiB
      for (const ep of normalizedEndpoints) {
        if (ep && typeof ep === 'object') {
          if (typeof ep.vramHeadroomMiB !== 'undefined' && ep.vramHeadroomMiB !== null) {
            if (!ep.ollama || typeof ep.ollama !== 'object') {
              ep.ollama = {};
            }
            if (typeof ep.ollama.vramHeadroomMiB === 'undefined' || ep.ollama.vramHeadroomMiB === null) {
              const parsed = Number(ep.vramHeadroomMiB);
              if (Number.isFinite(parsed) && parsed >= 0) {
                ep.ollama.vramHeadroomMiB = Math.round(parsed);
              }
            }
            delete ep.vramHeadroomMiB;
          }
          if (ep.ollama && typeof ep.ollama === 'object' && typeof ep.ollama.vramHeadroomMiB !== 'undefined' && ep.ollama.vramHeadroomMiB !== null) {
            const parsedRuntime = Number(ep.ollama.vramHeadroomMiB);
            if (Number.isFinite(parsedRuntime) && parsedRuntime >= 0) {
              ep.ollama.vramHeadroomMiB = Math.round(parsedRuntime);
            } else {
              delete ep.ollama.vramHeadroomMiB;
            }
          }
        }
      }
      clone.endpoints = normalizedEndpoints;
    }
    this.normalizeEndpointAgentAssignments(clone);
    this.normalizeWorkspaceAssignments(clone);
    if (Array.isArray(clone.agents?.list)) {
      clone.agents.list = clone.agents.list.map((agent: any) => {
        const normalized = this.sanitizeAgentRecord(agent, agent?.key);
        delete normalized.modelSource;
        delete normalized.workspaceMode;
        delete normalized.workspace;
        delete normalized.sharedWorkspaceAccess;
        delete normalized.rolePolicyKey;
        return normalized;
      });
    }
    clone.toolsets.list = this.getToolsetsList(clone).map((toolset: any) => this.createToolsetRecord(toolset));
    delete clone.toolPolicy;
    if (clone.telegram && typeof clone.telegram === 'object') {
      delete clone.telegram.botToken;
      delete clone.telegram.tokenFile;
      clone.telegram.defaultAccount = (typeof clone.telegram.defaultAccount === 'string' && clone.telegram.defaultAccount.trim())
        ? clone.telegram.defaultAccount.trim()
        : 'default';
      clone.telegram.accounts = Array.isArray(clone.telegram.accounts)
        ? clone.telegram.accounts.map((account: any) => {
            const normalized = this.normalizeTelegramAccountRecord(account);
            delete normalized.botToken;
            delete normalized.tokenFile;
            return normalized;
          }).filter((account: any) => typeof account.id === 'string' && account.id.trim().length > 0)
        : [];
    }
    for (const workspace of Array.isArray(clone.workspaces) ? clone.workspaces : []) {
      delete workspace.allowSharedWorkspaceAccess;
    }
    return clone;
  }

  sanitizeConfigModelNames(config: any) {
    const clone = JSON.parse(JSON.stringify(config));
    if (!clone) return clone;
    const defaultTelegramAccountId = (clone.telegram?.defaultAccount && String(clone.telegram.defaultAccount).trim()) || 'default';
    if (!clone.agents || typeof clone.agents !== 'object') {
      clone.agents = { telegramRouting: {}, list: [] };
    }
    clone.agents.telegramRouting = clone.agents.telegramRouting || {};
    clone.agents.telegramRouting.routes = this.normalizeTelegramRouteList(
      Array.isArray(clone.agents.telegramRouting.routes) ? clone.agents.telegramRouting.routes : [],
      defaultTelegramAccountId
    );
    if (!Array.isArray(clone.agents.list)) {
      clone.agents.list = [];
    }
    if (!Array.isArray(clone.workspaces)) {
      clone.workspaces = [];
    }
    this.ensureToolsetsConfig(clone);
    const normalizedEndpoints = this.getConfigEndpointsFrom(clone).map((endpoint: any) => this.normalizeEndpointRecord(endpoint));
    if (Array.isArray(clone.endpoints)) {
      clone.endpoints = normalizedEndpoints;
    }
    this.normalizeEndpointAgentAssignments(clone);
    clone.workspaces = clone.workspaces.map((workspace: any) => this.normalizeWorkspaceRecord(workspace));
    this.normalizeWorkspaceAssignments(clone);
    clone.agents.list = clone.agents.list.map((agent: any) => {
      const normalized = this.sanitizeAgentRecord(agent, agent?.key);
      delete normalized.workspaceMode;
      delete normalized.workspace;
      delete normalized.sharedWorkspaceAccess;
      return normalized;
    });
    clone.toolsets.list = this.getToolsetsList(clone).map((toolset: any) => this.createToolsetRecord(toolset));
    delete clone.toolPolicy;
    if (!clone.ollama) clone.ollama = {};
    if (!clone.skills || typeof clone.skills !== 'object') clone.skills = {};
    if (!clone.voiceNotes || typeof clone.voiceNotes !== 'object') clone.voiceNotes = {};
    if (typeof clone.skills.enableAll !== 'boolean') {
      clone.skills.enableAll = clone.skills.enableAll === false || clone.skills.enableAll === 'false' ? false : true;
    }
    if (typeof clone.voiceNotes.enabled !== 'boolean') {
      clone.voiceNotes.enabled = clone.voiceNotes.enabled === true || clone.voiceNotes.enabled === 'true';
    }
    if (typeof clone.voiceNotes.mode !== 'string' || !clone.voiceNotes.mode.trim()) {
      clone.voiceNotes.mode = 'local-whisper';
    }
    if (typeof clone.voiceNotes.gatewayImageTag !== 'string' || !clone.voiceNotes.gatewayImageTag.trim()) {
      clone.voiceNotes.gatewayImageTag = 'openclaw:local-voice';
    }
    if (typeof clone.voiceNotes.whisperModel !== 'string' || !clone.voiceNotes.whisperModel.trim()) {
      clone.voiceNotes.whisperModel = 'base';
    }
    if (clone.telegram && typeof clone.telegram === 'object') {
      delete clone.telegram.botToken;
      delete clone.telegram.tokenFile;
      clone.telegram.enabled = this.normalizeBoolean(clone.telegram.enabled, true);
      clone.telegram.defaultAccount = (typeof clone.telegram.defaultAccount === 'string' && clone.telegram.defaultAccount.trim())
        ? clone.telegram.defaultAccount.trim()
        : 'default';
      if (Array.isArray(clone.telegram.groups)) {
        clone.telegram.groups = clone.telegram.groups.map((group: any) => this.normalizeTelegramGroupRecord(group));
      } else {
        clone.telegram.groups = [];
      }
      if (Array.isArray(clone.telegram.accounts)) {
        clone.telegram.accounts = clone.telegram.accounts.map((account: any) => {
          const normalized = this.normalizeTelegramAccountRecord(account);
          delete normalized.botToken;
          delete normalized.tokenFile;
          return normalized;
        }).filter((account: any) => typeof account.id === 'string' && account.id.trim().length > 0);
      } else {
        clone.telegram.accounts = [];
      }
      if (clone.telegram.execApprovals && typeof clone.telegram.execApprovals === 'object') {
        clone.telegram.execApprovals = this.normalizeTelegramExecApprovalsRecord(clone.telegram.execApprovals);
      }
    }
    if (typeof clone.ollama.pullVramBudgetFraction !== 'number' || !Number.isFinite(clone.ollama.pullVramBudgetFraction) || clone.ollama.pullVramBudgetFraction <= 0 || clone.ollama.pullVramBudgetFraction > 1) {
      const parsedBudget = Number(clone.ollama.pullVramBudgetFraction);
      clone.ollama.pullVramBudgetFraction = Number.isFinite(parsedBudget) && parsedBudget > 0 && parsedBudget <= 1 ? parsedBudget : 0.7;
    }
    if (typeof clone.ollama.vramHeadroomMiB !== 'number' || !Number.isFinite(clone.ollama.vramHeadroomMiB) || clone.ollama.vramHeadroomMiB < 0) {
      const parsedHeadroom = Number(clone.ollama.vramHeadroomMiB);
      clone.ollama.vramHeadroomMiB = Number.isFinite(parsedHeadroom) && parsedHeadroom >= 0 ? Math.round(parsedHeadroom) : 1536;
    }

    const normalizeEndpoint = (endpoint: any) => {
      const normalized: any = {
        key: endpoint?.key || 'local',
        default: this.normalizeBoolean(endpoint?.default, false)
      };

      if (endpoint?.name) normalized.name = endpoint.name;
      if (endpoint?.telemetry) normalized.telemetry = endpoint.telemetry;
      normalized.agents = this.getEndpointAgentIds(endpoint);
      if (Array.isArray(endpoint?.hostedModels)) {
        normalized.hostedModels = this.sanitizeModelEntries(endpoint.hostedModels);
      }

      const rawRuntime = endpoint?.ollama || endpoint;
      const hasRuntime = !!endpoint?.ollama ||
        !!endpoint?.baseUrl ||
        !!endpoint?.hostBaseUrl ||
        !!endpoint?.providerId ||
        Array.isArray(endpoint?.models) ||
        (typeof rawRuntime?.vramHeadroomMiB !== 'undefined' && rawRuntime.vramHeadroomMiB !== null);

      if (hasRuntime) {
        const runtime: any = {};
        runtime.enabled = this.normalizeBoolean(rawRuntime?.enabled, true);
        if (rawRuntime?.providerId) runtime.providerId = rawRuntime.providerId;
        if (rawRuntime?.baseUrl) runtime.baseUrl = rawRuntime.baseUrl;
        if (rawRuntime?.hostBaseUrl) runtime.hostBaseUrl = rawRuntime.hostBaseUrl;
        if (rawRuntime?.apiKey) runtime.apiKey = rawRuntime.apiKey;
        runtime.autoPullMissingModels = this.normalizeBoolean(rawRuntime?.autoPullMissingModels, true);
        if (Array.isArray(rawRuntime?.models)) {
          runtime.models = this.sanitizeModelEntries(rawRuntime.models);
        }
        // Per-endpoint VRAM headroom override (MiB)
        if (typeof rawRuntime?.vramHeadroomMiB !== 'undefined') {
          const parsed = Number(rawRuntime.vramHeadroomMiB);
          if (Number.isFinite(parsed) && parsed >= 0) {
            runtime.vramHeadroomMiB = Math.round(parsed);
          }
        }
        normalized.ollama = runtime;
      }

      return normalized;
    };

    if (Array.isArray(clone.modelCatalog)) {
      clone.modelCatalog = this.sanitizeSharedCatalogEntries(clone.modelCatalog);
    } else if (Array.isArray(clone.ollama.models)) {
      clone.modelCatalog = this.sanitizeSharedCatalogEntries(clone.ollama.models);
      delete clone.ollama.models;
    }

    if (Array.isArray(clone.endpoints)) {
      clone.endpoints = clone.endpoints.map((endpoint: any) => normalizeEndpoint(endpoint));
    } else {
      clone.endpoints = [];
    }

    return clone;
  }

  getEndpointHostedModels(endpoint: any) {
    if (Array.isArray(endpoint?.hostedModels)) {
      return endpoint.hostedModels;
    }
    return [];
  }

  isHostedCatalogModel(model: any) {
    return typeof model?.modelRef === 'string' && model.modelRef.includes('/');
  }

  isLocalCatalogModel(model: any) {
    return typeof model?.id === 'string' && model.id.length > 0;
  }

  getEndpointLabel(endpoint: any) {
    if (endpoint?.name) {
      return `${endpoint.key} (${endpoint.name})`;
    }
    return String(endpoint?.key || 'endpoint');
  }

  getCatalogModelAssignments(model: any) {
    if (this.isLocalCatalogModel(model)) {
      return this.getConfigEndpoints().filter((endpoint: any) =>
        this.getEndpointModels(endpoint).some((entry: any) => String(entry?.id || '') === String(model.id))
      );
    }

    if (this.isHostedCatalogModel(model)) {
      return this.getConfigEndpoints().filter((endpoint: any) =>
        this.getEndpointHostedModels(endpoint).some((entry: any) => String(entry?.modelRef || '') === String(model.modelRef))
      );
    }

    return [];
  }

  cloneModelCatalogEntry(model: any) {
    const clone = JSON.parse(JSON.stringify(model));
    delete clone.name;
    delete clone.fallbackModelIds;
    return clone;
  }

  getSharedModelCatalog() {
    if (Array.isArray(this.config?.modelCatalog)) {
      return this.config.modelCatalog;
    }
    if (Array.isArray(this.config?.ollama?.models)) {
      return this.config.ollama.models;
    }
    return [];
  }

  getKnownLocalModelCatalog() {
    const models: any[] = [];
    const seen = new Set<string>();

    for (const model of this.getSharedModelCatalog()) {
      if (this.isLocalCatalogModel(model) && !seen.has(model.id)) {
        seen.add(model.id);
        models.push(model);
      }
    }

    for (const endpoint of this.getConfigEndpoints()) {
      for (const model of this.getEndpointModels(endpoint)) {
        if (this.isLocalCatalogModel(model) && !seen.has(model.id)) {
          seen.add(model.id);
          models.push(model);
        }
      }
    }

    return models;
  }

  getKnownHostedModelCatalog() {
    const models: any[] = [];
    const seen = new Set<string>();

    for (const endpoint of this.getConfigEndpoints()) {
      for (const model of this.getEndpointHostedModels(endpoint)) {
        if (this.isHostedCatalogModel(model) && !seen.has(model.modelRef)) {
          seen.add(model.modelRef);
          models.push(model);
        }
      }
    }

    for (const model of this.getSharedModelCatalog()) {
      if (this.isHostedCatalogModel(model) && !seen.has(model.modelRef)) {
        seen.add(model.modelRef);
        models.push(model);
      }
    }

    return models;
  }

  ensureSharedModelCatalog() {
    if (!Array.isArray(this.config?.modelCatalog)) {
      this.config.modelCatalog = [
        ...this.getKnownLocalModelCatalog().map((model: any) => this.cloneModelCatalogEntry(model)),
        ...this.getKnownHostedModelCatalog().map((model: any) => this.cloneModelCatalogEntry(model))
      ];
    }
    return this.config.modelCatalog;
  }

  getRemainingLocalModelIds(excludedModelId: string) {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const model of this.getKnownLocalModelCatalog()) {
      const modelId = typeof model?.id === 'string' ? model.id.trim() : '';
      if (!modelId || modelId === excludedModelId || seen.has(modelId)) {
        continue;
      }
      seen.add(modelId);
      ids.push(modelId);
    }
    return ids;
  }

  getMutableManagedAgentsForModelEdits() {
    const agents: any[] = Array.isArray(this.config?.agents?.list) ? [...this.config.agents.list] : [];
    if (this.editingAgentDraft) {
      agents.push(this.editingAgentDraft);
    }
    return agents;
  }

  applyLocalModelRemovalToAgent(agent: any, removedModelRef: string, fallbackReplacementRef: string) {
    if (!agent || typeof agent !== 'object') {
      return { changed: false, becameModelLess: false };
    }

    const currentCandidates = Array.isArray(agent.candidateModelRefs)
      ? agent.candidateModelRefs.filter((ref: any) => typeof ref === 'string' && ref.length > 0)
      : [];
    const nextCandidates = currentCandidates.filter((ref: string) => ref !== removedModelRef);
    const nextModelRef = nextCandidates.find((ref: string) => typeof ref === 'string' && ref.length > 0) || fallbackReplacementRef;

    let changed = false;
    let becameModelLess = false;
    if (typeof agent.modelRef === 'string' && agent.modelRef === removedModelRef) {
      if (!nextModelRef) {
        agent.modelRef = '';
        changed = true;
        becameModelLess = true;
      } else {
        agent.modelRef = nextModelRef;
        changed = true;
      }
    }

    if (Array.isArray(agent.candidateModelRefs) && nextCandidates.length !== currentCandidates.length) {
      agent.candidateModelRefs = nextCandidates;
      changed = true;
    }

    if (changed) {
      this.syncAgentModelSource(agent);
    }

    return { changed, becameModelLess };
  }

  removeLocalCatalogModelFromConfig(idx: number, model: any) {
    const models = this.ensureSharedModelCatalog();
    const modelId = typeof model?.id === 'string' ? model.id.trim() : '';
    if (!modelId) {
      return false;
    }

    const removedModelRef = `ollama/${modelId}`;
    const remainingLocalIds = this.getRemainingLocalModelIds(modelId);
    const fallbackReplacementRef = remainingLocalIds.length > 0 ? `ollama/${remainingLocalIds[0]}` : '';
    const modelLessAgents = new Set<string>();

    for (const agent of this.getMutableManagedAgentsForModelEdits()) {
      const previewAgent = this.cloneValue(agent);
      const result = this.applyLocalModelRemovalToAgent(previewAgent, removedModelRef, fallbackReplacementRef);
      if (result.becameModelLess) {
        modelLessAgents.add(this.getAgentDisplayLabel(agent));
      }
    }

    if (modelLessAgents.size > 0) {
      const proceed = confirm(
        `Remove local model "${modelId}" even though it is the last local option for some agents?\n\nThese agents will become model-less: ${[...modelLessAgents].join(', ')}.\n\nYou can still save this change and assign new models later.`
      );
      if (!proceed) {
        return false;
      }
    }

    for (const agent of this.getMutableManagedAgentsForModelEdits()) {
      this.applyLocalModelRemovalToAgent(agent, removedModelRef, fallbackReplacementRef);
    }

    this.config.modelCatalog = models.filter((_: any, modelIdx: number) => modelIdx !== idx);
    if (Array.isArray(this.config?.ollama?.models)) {
      this.config.ollama.models = this.config.ollama.models.filter((entry: any) => String(entry?.id || '') !== modelId);
    }

    for (const endpoint of this.getConfigEndpoints()) {
      const runtime = this.getEndpointOllama(endpoint);
      if (runtime && Array.isArray(runtime.models)) {
        runtime.models = runtime.models.filter((entry: any) => String(entry?.id || '') !== modelId);
      }
    }

    this.requestUpdate();
    return true;
  }

  getOllamaModelCatalog() {
    return this.getKnownLocalModelCatalog();
  }

  isLocalModelRef(modelRef: string | undefined) {
    return typeof modelRef === 'string' && modelRef.startsWith('ollama/');
  }

  getEndpointModelOptions(endpoint: any) {
    const options: any[] = [];
    const seen = new Set<string>();

    for (const model of this.getEndpointModels(endpoint)) {
      const ref = `ollama/${model.id}`;
      if (!seen.has(ref)) {
        seen.add(ref);
        options.push({
          ref,
          label: model.id,
          kind: 'local'
        });
      }
    }

    for (const model of this.getEndpointHostedModels(endpoint)) {
      const ref = model.modelRef;
      if (typeof ref === 'string' && ref.length > 0 && !seen.has(ref)) {
        seen.add(ref);
        options.push({
          ref,
          label: ref,
          kind: 'hosted'
        });
      }
    }

    return options;
  }

  getAvailableFallbackModelIds(endpoint?: any) {
    if (endpoint) {
      return this.getEndpointModels(endpoint).map((model: any) => model.id);
    }
    return this.getKnownLocalModelCatalog().map((model: any) => model.id);
  }

  getManagedAgentEntries() {
    const agents = Array.isArray(this.config?.agents?.list) ? this.config.agents.list : [];
    const entries = agents
      .map((agent: any, idx: number) => ({ key: typeof agent?.key === 'string' && agent.key.trim().length > 0 ? agent.key : `agent:${idx}`, agent }))
      .filter((entry: any) => entry.agent?.id);
    entries.sort((left: any, right: any) => {
      const leftMain = this.isMainAgentEntry(left.key, left.agent) ? 0 : 1;
      const rightMain = this.isMainAgentEntry(right.key, right.agent) ? 0 : 1;
      if (leftMain !== rightMain) {
        return leftMain - rightMain;
      }
      return String(left.agent?.name || left.agent?.id || left.key).localeCompare(String(right.agent?.name || right.agent?.id || right.key));
    });
    return entries;
  }

  getAgentDisplayLabel(agent: any) {
    const agentId = typeof agent?.id === 'string' ? agent.id.trim() : '';
    const agentName = typeof agent?.name === 'string' ? agent.name.trim() : '';
    return agentName && agentName !== agentId ? `${agentName} (${agentId})` : (agentId || 'main');
  }

  getDefaultRoutingAgentEntry() {
    const agents = Array.isArray(this.config?.agents?.list) ? this.config.agents.list : [];
    const entries = agents
      .map((agent: any, idx: number) => ({ key: typeof agent?.key === 'string' && agent.key.trim().length > 0 ? agent.key : `agent:${idx}`, agent }))
      .filter((entry: any) => entry.agent?.id);

    return entries.find((entry: any) => entry.agent?.default === true)
      || entries[0]
      || { key: 'main', agent: { id: 'main', name: 'main' } };
  }

  getTelegramSetupStatusRecord(accountId: string, isDefault: boolean) {
    const status = this.telegramSetupStatus && typeof this.telegramSetupStatus === 'object'
      ? this.telegramSetupStatus
      : { defaultAccount: null, accounts: {} };
    if (isDefault) {
      return status.defaultAccount || null;
    }

    const accounts = status.accounts && typeof status.accounts === 'object' ? status.accounts : {};
    return accountId ? (accounts[accountId] || null) : null;
  }

  isMainAgentEntry(key: string, agent: any) {
    return key === 'strongAgent' || agent?.isMain === true;
  }

  canRemoveAgent(key: string, agent: any) {
    return !this.isMainAgentEntry(key, agent);
  }

  removeAgentReferences(agentId: string) {
    for (const { agent } of this.getManagedAgentEntries()) {
      const subagents = this.ensureSubagentsConfig(agent);
      subagents.allowAgents = subagents.allowAgents.filter((candidateId: string) => candidateId !== agentId);
    }

    for (const workspace of this.getWorkspaces()) {
      workspace.agents = this.getWorkspaceAgentIds(workspace).filter((candidateId: string) => candidateId !== agentId);
    }

    for (const endpoint of this.getConfigEndpoints()) {
      endpoint.agents = this.getEndpointAgentIds(endpoint).filter((candidateId: string) => candidateId !== agentId);
    }

    const telegramRouting = this.ensureTelegramRoutingConfig();
    if (telegramRouting) {
      telegramRouting.routes = this.getTelegramRouteList().filter((route: any) => String(route?.targetAgentId || '') !== agentId);
    }

    if (this.topologyLinkSourceAgentId === agentId) {
      this.topologyLinkSourceAgentId = null;
    }
    if (this.topologyHoverAgentId === agentId) {
      this.topologyHoverAgentId = null;
    }
    if (this.topologyHoverEdgeKey && this.topologyHoverEdgeKey.startsWith(`${agentId}->`)) {
      this.topologyHoverEdgeKey = null;
    }
    if (this.topologySelectedAgentId === agentId) {
      this.topologySelectedAgentId = null;
    }
  }

  getAllowedAgentChoices(currentAgentId?: string) {
    return this.getManagedAgentEntries()
      .filter(({ agent }: any) => agent.id !== currentAgentId)
      .map(({ agent }: any) => ({
        id: agent.id,
        label: agent.name ? `${agent.name} (${agent.id})` : agent.id
      }));
  }

  getAgentEnabledState(_key: string, agent: any) {
    return !!agent?.enabled;
  }

  getAgentEffectiveWorkspaceMode(agent: any) {
    return this.getWorkspaceForAgentId(agent?.id)?.mode || 'private';
  }

  getTopologyAgentEntries() {
    return this.getManagedAgentEntries().map(({ key, agent }: any) => ({
      key,
      agent,
      id: String(agent?.id || key),
      name: String(agent?.name || agent?.id || key),
      enabled: this.getAgentEnabledState(key, agent),
      isMain: this.isMainAgentEntry(key, agent),
      endpoint: this.resolveAgentEndpoint(agent),
      workspaceMode: this.getAgentEffectiveWorkspaceMode(agent),
      modelSource: agent?.modelSource || (this.isLocalModelRef(agent?.modelRef) ? 'local' : 'hosted')
    }));
  }

  getTopologyAgentEntryById(agentId: string | null | undefined) {
    if (!agentId) return null;
    return this.getTopologyAgentEntries().find((entry: any) => entry.id === agentId) || null;
  }

  getTopologyAgentEntryByKey(agentKey: string | null | undefined) {
    if (!agentKey) return null;
    return this.getTopologyAgentEntries().find((entry: any) => entry.key === agentKey) || null;
  }

  getTopologySelectedAgentEntry() {
    return this.getTopologyAgentEntryById(this.topologySelectedAgentId)
      || this.getTopologyAgentEntries()[0]
      || null;
  }

  getEffectiveAgentBootstrapMarkdown(agent: any, fileName: string) {
    const selectedTemplateKey = this.getMarkdownTemplateSelection(agent, fileName, VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES);
    const agentTemplateFiles = this.ensureAgentTemplateFiles(agent);
    return {
      selectedTemplateKey,
      effectiveValue: selectedTemplateKey
        ? this.getMarkdownTemplateContent('agents', fileName, selectedTemplateKey)
        : (agentTemplateFiles[fileName] || '')
    };
  }

  getEffectiveWorkspaceBootstrapMarkdown(workspace: any, fileName: string) {
    if (!workspace || !VALID_WORKSPACE_MARKDOWN_FILES.includes(fileName as any)) {
      return {
        selectedTemplateKey: '',
        effectiveValue: ''
      };
    }

    const selectedTemplateKey = this.getMarkdownTemplateSelection(workspace, fileName, VALID_WORKSPACE_MARKDOWN_FILES);
    const workspaceTemplateFiles = this.ensureWorkspaceTemplateFiles(workspace);
    let effectiveValue = selectedTemplateKey
      ? this.getMarkdownTemplateContent('workspaces', fileName, selectedTemplateKey)
      : (workspaceTemplateFiles[fileName] || '');

    if (!effectiveValue && fileName === 'AGENTS.md') {
      effectiveValue = this.buildWorkspaceBootstrapPlaceholder(workspace, fileName);
    }

    return {
      selectedTemplateKey,
      effectiveValue
    };
  }

  getCombinedAgentBootstrapMarkdown(agent: any, fileName: string) {
    const workspace = this.getWorkspaceForAgentId(agent?.id);
    const workspaceMarkdown = this.getEffectiveWorkspaceBootstrapMarkdown(workspace, fileName);
    const agentMarkdown = this.getEffectiveAgentBootstrapMarkdown(agent, fileName);
    const sections: string[] = [];
    const sourceLabels: string[] = [];

    const workspaceValue = typeof workspaceMarkdown.effectiveValue === 'string'
      ? workspaceMarkdown.effectiveValue.trim()
      : '';
    if (workspaceValue) {
      const workspaceLabel = workspace?.name || workspace?.id || 'workspace';
      sections.push(`## Workspace ${fileName} (${workspaceLabel})`, '', workspaceValue);
      sourceLabels.push(
        workspaceMarkdown.selectedTemplateKey
          ? `Workspace template ${workspaceMarkdown.selectedTemplateKey}`
          : 'Workspace markdown'
      );
    }

    const agentValue = typeof agentMarkdown.effectiveValue === 'string'
      ? agentMarkdown.effectiveValue.trim()
      : '';
    if (agentValue) {
      const agentLabel = agent?.name || agent?.id || 'agent';
      sections.push(`## Agent ${fileName} (${agentLabel})`, '', agentValue);
      sourceLabels.push(
        agentMarkdown.selectedTemplateKey
          ? `Agent template ${agentMarkdown.selectedTemplateKey}`
          : 'Agent overlay markdown'
      );
    }

    return {
      sourceLabels,
      effectiveValue: sections.join('\n').trim()
    };
  }

  addToolset() {
    const nextToolsets = [...this.getToolsetsList()];
    let counter = nextToolsets.length + 1;
    let key = `toolset-${counter}`;
    while (this.getToolsetByKey(key)) {
      counter += 1;
      key = `toolset-${counter}`;
    }
    nextToolsets.push(this.createToolsetRecord({ key, name: `Toolset ${counter}`, allow: [], deny: [] }));
    this.ensureToolsetsConfig(this.config);
    this.config.toolsets.list = nextToolsets;
    this.requestUpdate();
  }

  getAgentDelegationTargets(agent: any) {
    const subagents = this.ensureSubagentsConfig(agent);
    return subagents.allowAgents;
  }

  getTopologyPreviewSourceAgentId() {
    return this.topologyLinkSourceAgentId || this.topologyHoverAgentId;
  }

  getVisibleTopologyEdges() {
    if (this.topologyShowAllArrows) {
      return this.topologyEdges;
    }
    const previewSourceAgentId = this.getTopologyPreviewSourceAgentId();
    if (!previewSourceAgentId) {
      return [];
    }
    return this.topologyEdges.filter((edge: any) => edge.sourceId === previewSourceAgentId);
  }

  getTopologyEdgeColor(edge: any) {
    if (this.topologyHoverEdgeKey === edge.key) {
      return '#ff4fc3';
    }
    const isHoveredSource = this.topologyHoverAgentId === edge.sourceId;
    if (edge.active) {
      return '#00bcd4';
    }
    if (isHoveredSource) {
      return '#ff8a65';
    }
    if (edge.main) {
      return '#ffd54f';
    }
    return '#6ec6ff';
  }

  getTopologyProtectedLaneMetrics() {
    return {
      laneSpacing: 12,
      leftPadding: 18,
      rightPadding: 12,
      centerGap: 24
    };
  }

  getTopologySlotLaneCounts(slot: any, columnCount: number) {
    if (columnCount < 2) {
      return { leftLaneCount: 0, rightLaneCount: 0 };
    }

    const slotEntries = Array.isArray(slot?.agents) ? slot.agents : [];
    const columnByAgentId = new Map<string, number>();
    slotEntries.forEach((entry: any, index: number) => {
      columnByAgentId.set(String(entry?.id || ''), index % columnCount);
    });

    let leftLaneCount = 0;
    let rightLaneCount = 0;
    for (const entry of slotEntries) {
      for (const targetId of this.getAgentDelegationTargets(entry.agent)) {
        const targetColumn = columnByAgentId.get(String(targetId || ''));
        if (targetColumn === 0) {
          leftLaneCount += 1;
        } else if (targetColumn === 1) {
          rightLaneCount += 1;
        }
      }
    }

    return { leftLaneCount, rightLaneCount };
  }

  getTopologySlotColumnGap(slot: any, columnCount: number) {
    if (columnCount < 2) {
      return 16;
    }

    const { laneSpacing, leftPadding, rightPadding, centerGap } = this.getTopologyProtectedLaneMetrics();
    const { leftLaneCount, rightLaneCount } = this.getTopologySlotLaneCounts(slot, columnCount);
    const leftSpread = Math.max(0, leftLaneCount - 1) * laneSpacing;
    const rightSpread = Math.max(0, rightLaneCount - 1) * laneSpacing;
    const requiredGap = leftPadding + rightPadding + centerGap + leftSpread + rightSpread;
    return Math.min(220, Math.max(92, requiredGap));
  }

  hasDelegationEdge(sourceAgentId: string, targetAgentId: string) {
    const sourceEntry = this.getTopologyAgentEntryById(sourceAgentId);
    if (!sourceEntry) return false;
    return this.getAgentDelegationTargets(sourceEntry.agent).includes(targetAgentId);
  }

  getTopologyReachableAgents(startAgentId: string, visited = new Set<string>()) {
    if (visited.has(startAgentId)) {
      return visited;
    }
    visited.add(startAgentId);
    const sourceEntry = this.getTopologyAgentEntryById(startAgentId);
    if (!sourceEntry) {
      return visited;
    }
    for (const targetId of this.getAgentDelegationTargets(sourceEntry.agent)) {
      if (this.getTopologyAgentEntryById(targetId)) {
        this.getTopologyReachableAgents(targetId, visited);
      }
    }
    return visited;
  }

  wouldCreateDelegationCycle(sourceAgentId: string, targetAgentId: string) {
    if (!sourceAgentId || !targetAgentId) return false;
    if (sourceAgentId === targetAgentId) return true;
    const reachable = this.getTopologyReachableAgents(targetAgentId, new Set<string>());
    return reachable.has(sourceAgentId);
  }

  setTopologyNotice(message: string) {
    this.topologyNotice = message;
  }

  clearTopologyNotice() {
    this.topologyNotice = '';
  }

  getTopologySessionsForAgent(agentId: string) {
    return this.topologyAgentSessions.filter((session: any) => session.agentId === agentId);
  }

  async getGatewayAuthToken() {
    if (!this.gatewayAuthTokenPromise) {
      this.gatewayAuthTokenPromise = fetch(this.getBaseUrl() + '/api/gateway-auth', { cache: 'no-store' })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.details || payload.error || `Gateway auth lookup failed (${response.status})`);
          }
          const token = String(payload.token || '').trim();
          if (!token) {
            throw new Error('OpenClaw gateway token is empty.');
          }
          return token;
        });
    }
    return this.gatewayAuthTokenPromise;
  }

  async getTopologyAgentSessionUrl(sessionKey: string) {
    const token = await this.getGatewayAuthToken();
    const chatUrl = new URL(this.getOpenClawChatBaseUrl());
    chatUrl.searchParams.set('session', sessionKey);
    chatUrl.hash = `token=${encodeURIComponent(token)}`;
    return chatUrl.toString();
  }

  openTopologyAgentSession(sessionKey: string, url: string) {
    const opened = window.open(url, '_blank');
    if (opened) {
      this.monitorTopologyAgentSessionWindow(sessionKey, opened);
    }
    return opened;
  }

  monitorTopologyAgentSessionWindow(sessionKey: string, opened: Window) {
    const existingTimer = this.topologyAgentSessionPollTimers.get(sessionKey);
    if (existingTimer) {
      window.clearInterval(existingTimer);
    }
    this.topologyAgentSessionWindows.set(sessionKey, opened);
    const timer = window.setInterval(() => {
      if (!opened.closed) {
        return;
      }
      window.clearInterval(timer);
      this.topologyAgentSessionPollTimers.delete(sessionKey);
      this.topologyAgentSessionWindows.delete(sessionKey);
      if (this.topologyAgentSessions.some((session: any) => session.key === sessionKey)) {
        this.closeTopologyAgentSession(sessionKey, false);
      }
    }, 1500);
    this.topologyAgentSessionPollTimers.set(sessionKey, timer);
  }

  async createTopologyAgentSession(agentId: string) {
    const entry = this.getTopologyAgentEntryById(agentId);
    if (!entry || this.topologyAgentSessionBusyKey) {
      return;
    }
    this.topologyAgentSessionError = '';
    this.topologyAgentSessionBusyKey = `create:${agentId}`;
    const pendingWindow = window.open('about:blank', '_blank');
    if (pendingWindow) {
      pendingWindow.document.title = `${entry.name} - OpenClaw`;
      pendingWindow.document.body.innerHTML = '<p style="font-family: sans-serif; padding: 16px;">Creating OpenClaw agent session...</p>';
    }
    try {
      const label = `${entry.name} dashboard chat ${new Date().toLocaleTimeString()}`;
      const response = await fetch(this.getBaseUrl() + '/api/agent-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, label })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.details || payload.error || `Session create failed (${response.status})`);
      }
      const key = String(payload.key || '').trim();
      if (!key) {
        throw new Error('OpenClaw did not return a session key.');
      }
      const chatUrl = await this.getTopologyAgentSessionUrl(key);
      let opened = pendingWindow;
      if (opened && !opened.closed) {
        opened.location.href = chatUrl;
        this.monitorTopologyAgentSessionWindow(key, opened);
      } else {
        opened = this.openTopologyAgentSession(key, chatUrl);
      }
      this.topologyAgentSessions = [
        {
          key,
          sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined,
          agentId,
          label,
          url: chatUrl,
          createdAt: Date.now()
        },
        ...this.topologyAgentSessions
      ];
      this.setTopologyNotice(opened
        ? `Opened a persistent ${entry.name} session. Closing that chat tab will best-effort delete it.`
        : `Created ${entry.name} session. Popup was blocked; use the session chip/link to open it.`);
    } catch (err: any) {
      if (pendingWindow && !pendingWindow.closed) {
        pendingWindow.close();
      }
      this.topologyAgentSessionError = String(err?.message || err);
      this.setTopologyNotice(`Could not create agent session: ${this.topologyAgentSessionError}`);
    } finally {
      this.topologyAgentSessionBusyKey = null;
    }
  }

  async closeTopologyAgentSession(sessionKey: string, closeWindow = true) {
    if (!sessionKey || this.topologyAgentSessionBusyKey) {
      return;
    }
    this.topologyAgentSessionError = '';
    this.topologyAgentSessionBusyKey = `close:${sessionKey}`;
    const timer = this.topologyAgentSessionPollTimers.get(sessionKey);
    if (timer) {
      window.clearInterval(timer);
      this.topologyAgentSessionPollTimers.delete(sessionKey);
    }
    const opened = this.topologyAgentSessionWindows.get(sessionKey);
    this.topologyAgentSessionWindows.delete(sessionKey);
    if (closeWindow && opened && !opened.closed) {
      opened.close();
    }
    try {
      const response = await fetch(this.getBaseUrl() + '/api/agent-sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: sessionKey })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.details || payload.error || `Session delete failed (${response.status})`);
      }
      this.topologyAgentSessions = this.topologyAgentSessions.filter((session: any) => session.key !== sessionKey);
      this.setTopologyNotice('Closed and deleted the dashboard-created agent session.');
    } catch (err: any) {
      this.topologyAgentSessionError = String(err?.message || err);
      this.setTopologyNotice(`Could not delete agent session: ${this.topologyAgentSessionError}`);
    } finally {
      this.topologyAgentSessionBusyKey = null;
    }
  }

  selectTopologyAgent(agentId: string) {
    this.topologySelectedAgentId = agentId;
  }

  setTopologyAgentEnabled(agentId: string, enabled: boolean) {
    const entry = this.getTopologyAgentEntryById(agentId);
    if (!entry) {
      return;
    }
    entry.agent.enabled = enabled;
    if (!enabled && this.topologyLinkSourceAgentId === agentId) {
      this.topologyLinkSourceAgentId = null;
    }
    this.topologySelectedAgentId = agentId;
    this.setTopologyNotice(enabled
      ? `${entry.name} is enabled again and will be included in toolkit-managed OpenClaw config.`
      : `${entry.name} is now disabled and will stay in toolkit config only until re-enabled.`);
    this.requestUpdate();
  }

  setTopologyAgentDelegationEnabled(agentId: string, enabled: boolean) {
    const entry = this.getTopologyAgentEntryById(agentId);
    if (!entry) {
      return;
    }
    const subagents = this.ensureSubagentsConfig(entry.agent);
    subagents.enabled = enabled;
    if (!enabled && this.topologyLinkSourceAgentId === agentId) {
      this.topologyLinkSourceAgentId = null;
    }
    this.topologySelectedAgentId = agentId;
    this.setTopologyNotice(enabled
      ? `${entry.name} can delegate again using its configured allowed agents.`
      : `${entry.name} delegation is now turned off. Existing delegate targets were kept.`);
    this.requestUpdate();
  }

  selectTopologyDelegationSource(agentId: string) {
    if (this.topologyLinkSourceAgentId === agentId) {
      this.topologyLinkSourceAgentId = null;
      this.clearTopologyNotice();
      return;
    }
    this.topologyLinkSourceAgentId = agentId;
    const sourceEntry = this.getTopologyAgentEntryById(agentId);
    if (sourceEntry) {
      this.setTopologyNotice(`Wiring delegation from ${sourceEntry.name}. Click another agent to add or remove a delegation arrow.`);
    }
  }

  toggleTopologyDelegation(sourceAgentId: string, targetAgentId: string) {
    if (sourceAgentId === targetAgentId) {
      this.setTopologyNotice('An agent cannot delegate to itself.');
      return;
    }

    const sourceEntry = this.getTopologyAgentEntryById(sourceAgentId);
    const targetEntry = this.getTopologyAgentEntryById(targetAgentId);
    if (!sourceEntry || !targetEntry) {
      this.setTopologyNotice('Could not find one of the selected agents.');
      return;
    }

    const subagents = this.ensureSubagentsConfig(sourceEntry.agent);
    const allowedAgents = this.getAgentDelegationTargets(sourceEntry.agent);
    const existingIndex = allowedAgents.indexOf(targetAgentId);
    if (existingIndex >= 0) {
      allowedAgents.splice(existingIndex, 1);
      this.setTopologyNotice(`${sourceEntry.name} no longer delegates to ${targetEntry.name}.`);
      this.requestUpdate();
      return;
    }

    if (this.wouldCreateDelegationCycle(sourceAgentId, targetAgentId)) {
      this.setTopologyNotice(`Blocked circular delegation: ${targetEntry.name} already leads back to ${sourceEntry.name}.`);
      return;
    }

    subagents.enabled = true;
    allowedAgents.push(targetAgentId);
    this.setTopologyNotice(`${sourceEntry.name} can now delegate to ${targetEntry.name}.`);
    this.requestUpdate();
  }

  handleTopologyAgentClick(agentId: string) {
    this.topologySelectedAgentId = agentId;
    if (!this.topologyLinkSourceAgentId) {
      return;
    }
    if (this.topologyLinkSourceAgentId === agentId) {
      this.topologyLinkSourceAgentId = null;
      this.clearTopologyNotice();
      return;
    }
    this.toggleTopologyDelegation(this.topologyLinkSourceAgentId, agentId);
  }

  setAgentEndpointAssignment(agent: any, endpointKey: string | null) {
    const agentId = String(agent?.id || '').trim();
    if (agentId) {
      for (const endpoint of this.getConfigEndpoints()) {
        endpoint.agents = this.getEndpointAgentIds(endpoint).filter((candidateId: string) => candidateId !== agentId);
      }
      if (endpointKey && endpointKey.length > 0) {
        const targetEndpoint = this.getConfigEndpoints().find((candidate: any) => candidate.key === endpointKey);
        if (targetEndpoint) {
          targetEndpoint.agents = [...this.getEndpointAgentIds(targetEndpoint), agentId];
        }
      }
    }
    const endpoint = endpointKey ? this.getConfigEndpoints().find((candidate: any) => candidate.key === endpointKey) : null;
    this.syncAgentEndpointModelSelection(agent, endpoint);
  }

  assignTopologyAgentToEndpoint(agentKey: string, endpointKey: string | null) {
    const entry = this.getTopologyAgentEntryByKey(agentKey);
    if (!entry) return;
    this.setAgentEndpointAssignment(entry.agent, endpointKey);
    this.clearTopologyNotice();
    this.requestUpdate();
  }

  startTopologyDrag(agentKey: string) {
    this.topologyDraggedAgentKey = agentKey;
    this.clearTopologyNotice();
  }

  endTopologyDrag() {
    this.topologyDraggedAgentKey = null;
    this.topologyHoverEndpointKey = null;
  }

  handleTopologyDrop(endpointKey: string | null) {
    if (!this.topologyDraggedAgentKey) return;
    this.assignTopologyAgentToEndpoint(this.topologyDraggedAgentKey, endpointKey);
    this.topologyDraggedAgentKey = null;
    this.topologyHoverEndpointKey = null;
  }

  openTopologyAgentEditor(agentKey: string) {
    const entry = this.getTopologyAgentEntryByKey(agentKey);
    if (entry) {
      this.topologySelectedAgentId = entry.id;
    }
    this.startEditingAgent(agentKey);
    this.activeTab = 'config';
    this.configSection = 'agents';
  }

  getTopologySlots() {
    const slots = this.getSortedConfigEndpoints().map((endpoint: any) => ({
      key: endpoint.key,
      endpointKey: endpoint.key,
      title: this.getEndpointLabel(endpoint),
      subtitle: endpoint.default ? 'Default workbench' : 'Endpoint workbench',
      icon: endpoint.default ? '💻' : '🖥️',
      endpoint,
      agents: [] as any[]
    }));

    const roamingSlot = {
      key: '__roaming__',
      endpointKey: null,
      title: 'Roaming Bench',
      subtitle: 'Agents without a resolved endpoint',
      icon: '🧰',
      endpoint: null,
      agents: [] as any[]
    };

    for (const entry of this.getTopologyAgentEntries()) {
      const slot = entry.endpoint
        ? slots.find((candidate: any) => candidate.endpointKey === entry.endpoint.key)
        : roamingSlot;
      (slot || roamingSlot).agents.push(entry);
    }

    return [...slots, roamingSlot];
  }

  syncAgentModelSource(agent: any) {
    const primaryRef = typeof agent?.modelRef === 'string' && agent.modelRef.length > 0
      ? agent.modelRef
      : (Array.isArray(agent?.candidateModelRefs) && agent.candidateModelRefs.length > 0 ? agent.candidateModelRefs[0] : '');

    agent.modelSource = this.isLocalModelRef(primaryRef) ? 'local' : 'hosted';
  }

  syncAgentEndpointModelSelection(agent: any, endpoint: any) {
    if (!agent) {
      return;
    }

    if (!endpoint) {
      this.syncAgentModelSource(agent);
      return;
    }

    const allowedRefs = new Set(this.getEndpointModelOptions(endpoint).map((option: any) => option.ref));
    if (allowedRefs.size === 0) {
      this.syncAgentModelSource(agent);
      return;
    }

    const currentCandidates = Array.isArray(agent?.candidateModelRefs) ? agent.candidateModelRefs : [];
    if (!allowedRefs.has(agent?.modelRef)) {
      const firstCompatibleCandidate = currentCandidates.find((ref: string) => allowedRefs.has(ref));
      if (firstCompatibleCandidate) {
        agent.modelRef = firstCompatibleCandidate;
      }
    }

    this.syncAgentModelSource(agent);
  }

  syncAllAgentModelSources() {
    for (const { agent } of this.getManagedAgentEntries()) {
      this.syncAgentModelSource(agent);
    }
  }

  syncAllAgentSelections() {
    for (const { agent } of this.getManagedAgentEntries()) {
      const endpoint = this.resolveAgentEndpoint(agent);
      this.syncAgentEndpointModelSelection(agent, endpoint);
    }
  }
  };
