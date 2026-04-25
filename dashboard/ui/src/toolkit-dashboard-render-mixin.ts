import { LitElement } from 'lit';
import { ToolkitDashboardAgentsWorkspacesMixin } from './toolkit-dashboard-agents-workspaces-mixin';
import { ToolkitDashboardConfigMixin } from './toolkit-dashboard-config-mixin';
import { ToolkitDashboardManagementMixin } from './toolkit-dashboard-management-mixin';
import { ToolkitDashboardTelegramMixin } from './toolkit-dashboard-telegram-mixin';
import { ToolkitDashboardTopologyCatalogMixin } from './toolkit-dashboard-topology-catalog-mixin';
import { ToolkitDashboardTopologyAgentsMixin } from './toolkit-dashboard-topology-agents-mixin';
import { ToolkitDashboardTopologyModelsMixin } from './toolkit-dashboard-topology-models-mixin';
import { ToolkitDashboardStatusLogicMixin } from './toolkit-dashboard-status-logic-mixin';
import { ToolkitDashboardTopologyMixin } from './toolkit-dashboard-topology-mixin';
import { ToolkitDashboardTopologyAssignmentMixin } from './toolkit-dashboard-topology-assignment-mixin';
import { ToolkitDashboardTopologyGraphMixin } from './toolkit-dashboard-topology-graph-mixin';
import { ToolkitDashboardTopologySessionMixin } from './toolkit-dashboard-topology-session-mixin';
import { ToolkitDashboardTopologyViewMixin } from './toolkit-dashboard-topology-view-mixin';
import { ToolkitDashboardShellViewMixin } from './toolkit-dashboard-shell-view-mixin';
import { ToolkitDashboardWorkspacesMixin } from './toolkit-dashboard-workspaces-mixin';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardRenderMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardRenderMixin extends (() => {
    const WithTelegram = ToolkitDashboardTelegramMixin(Base);
    const WithConfig = ToolkitDashboardConfigMixin(WithTelegram);
    const WithTopology = ToolkitDashboardTopologyMixin(WithConfig);
    const WithModels = ToolkitDashboardTopologyModelsMixin(WithTopology);
    const WithCatalog = ToolkitDashboardTopologyCatalogMixin(WithModels);
    const WithAgents = ToolkitDashboardTopologyAgentsMixin(WithCatalog);
    const WithStatusLogic = ToolkitDashboardStatusLogicMixin(WithAgents);
    const WithGraph = ToolkitDashboardTopologyGraphMixin(WithStatusLogic);
    const WithSession = ToolkitDashboardTopologySessionMixin(WithGraph);
    const WithAssignment = ToolkitDashboardTopologyAssignmentMixin(WithSession);
    const WithShell = ToolkitDashboardShellViewMixin(WithAssignment);
    const WithTopologyView = ToolkitDashboardTopologyViewMixin(WithShell);
    const WithWorkspaces = ToolkitDashboardWorkspacesMixin(WithTopologyView);
    const WithAgentsWorkspaces = ToolkitDashboardAgentsWorkspacesMixin(WithWorkspaces);
    return ToolkitDashboardManagementMixin(WithAgentsWorkspaces);
  })() {
    [key: string]: any;
  };
