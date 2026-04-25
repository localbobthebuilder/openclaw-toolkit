import { LitElement } from 'lit';
import { renderModelCatalogConfig } from './toolkit-dashboard-model-catalog-renderer';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardModelsMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardModelsMixin extends Base {
    [key: string]: any;

    renderModelsConfig() {
      return renderModelCatalogConfig(this);
    }
  };
