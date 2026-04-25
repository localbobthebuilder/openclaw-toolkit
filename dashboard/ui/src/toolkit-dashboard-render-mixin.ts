import { LitElement } from 'lit';
import { ToolkitDashboardAgentsWorkspacesMixin } from './toolkit-dashboard-agents-workspaces-mixin';
import { ToolkitDashboardConfigMixin } from './toolkit-dashboard-config-mixin';
import { ToolkitDashboardManagementMixin } from './toolkit-dashboard-management-mixin';
import { ToolkitDashboardTelegramMixin } from './toolkit-dashboard-telegram-mixin';
import { ToolkitDashboardTopologyMixin } from './toolkit-dashboard-topology-mixin';
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
    const WithGraph = ToolkitDashboardTopologyGraphMixin(WithTopology);
    const WithSession = ToolkitDashboardTopologySessionMixin(WithGraph);
    const WithShell = ToolkitDashboardShellViewMixin(WithSession);
    const WithTopologyView = ToolkitDashboardTopologyViewMixin(WithShell);
    const WithWorkspaces = ToolkitDashboardWorkspacesMixin(WithTopologyView);
    const WithAgents = ToolkitDashboardAgentsWorkspacesMixin(WithWorkspaces);
    return ToolkitDashboardManagementMixin(WithAgents);
  })() {
    [key: string]: any;
  };
