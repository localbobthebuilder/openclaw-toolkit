import { LitElement } from 'lit';
import { ToolkitDashboardAgentsWorkspacesMixin } from './toolkit-dashboard-agents-workspaces-mixin';
import { ToolkitDashboardConfigMixin } from './toolkit-dashboard-config-mixin';
import { ToolkitDashboardManagementMixin } from './toolkit-dashboard-management-mixin';
import { ToolkitDashboardTelegramMixin } from './toolkit-dashboard-telegram-mixin';
import { ToolkitDashboardTopologyMixin } from './toolkit-dashboard-topology-mixin';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardRenderMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardRenderMixin extends ToolkitDashboardManagementMixin(ToolkitDashboardAgentsWorkspacesMixin(ToolkitDashboardTopologyMixin(ToolkitDashboardConfigMixin(ToolkitDashboardTelegramMixin(Base))))) {
    [key: string]: any;
  };
