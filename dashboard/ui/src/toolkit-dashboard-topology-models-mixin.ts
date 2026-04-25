import { LitElement } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardTopologyModelsMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardTopologyModelsMixin extends Base {
    [key: string]: any;

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
  };
