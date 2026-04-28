import { LitElement, html } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

const WEB_SEARCH_PROVIDER_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'searxng', label: 'SearXNG' },
  { value: 'firecrawl', label: 'Firecrawl' },
  { value: 'ollama', label: 'Ollama Web Search' }
];

const WEB_FETCH_PROVIDER_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'firecrawl', label: 'Firecrawl' }
];

const DUCKDUCKGO_SAFE_SEARCH_OPTIONS = ['strict', 'moderate', 'off'];

export const ToolkitDashboardWebConfigMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardWebConfigMixin extends Base {
    [key: string]: any;

    ensureToolkitWebRoots(config: any = this.config) {
      const target = config || {};
      if (!target.tools || typeof target.tools !== 'object') {
        target.tools = {};
      }
      if (!target.tools.web || typeof target.tools.web !== 'object') {
        target.tools.web = {};
      }
      if (!target.tools.web.search || typeof target.tools.web.search !== 'object') {
        target.tools.web.search = {};
      }
      if (!target.tools.web.fetch || typeof target.tools.web.fetch !== 'object') {
        target.tools.web.fetch = {};
      }
      if (!target.plugins || typeof target.plugins !== 'object') {
        target.plugins = {};
      }
      if (!target.plugins.entries || typeof target.plugins.entries !== 'object') {
        target.plugins.entries = {};
      }
      return target;
    }

    ensureToolkitWebConfig(config: any = this.config) {
      const target = this.ensureToolkitWebRoots(config);

      const search = target.tools.web.search;
      search.enabled = this.normalizeBoolean(search.enabled, true);
      search.provider = typeof search.provider === 'string' ? search.provider.trim().toLowerCase() : '';
      if (!Number.isFinite(Number(search.maxResults)) || Number(search.maxResults) <= 0) {
        search.maxResults = 5;
      } else {
        search.maxResults = Math.max(1, Math.round(Number(search.maxResults)));
      }
      if (!Number.isFinite(Number(search.timeoutSeconds)) || Number(search.timeoutSeconds) <= 0) {
        search.timeoutSeconds = 30;
      } else {
        search.timeoutSeconds = Math.max(1, Math.round(Number(search.timeoutSeconds)));
      }
      if (!Number.isFinite(Number(search.cacheTtlMinutes)) || Number(search.cacheTtlMinutes) < 0) {
        search.cacheTtlMinutes = 15;
      } else {
        search.cacheTtlMinutes = Math.max(0, Math.round(Number(search.cacheTtlMinutes)));
      }
      if (!search.provider) {
        delete search.provider;
      }

      const fetchConfig = target.tools.web.fetch;
      fetchConfig.provider = typeof fetchConfig.provider === 'string' ? fetchConfig.provider.trim().toLowerCase() : '';
      if (!fetchConfig.provider) {
        delete fetchConfig.provider;
      }

      const duckduckgo = this.ensureWebProviderEntry(target, 'duckduckgo');
      duckduckgo.enabled = this.normalizeBoolean(duckduckgo.enabled, true);
      duckduckgo.config.webSearch = duckduckgo.config.webSearch && typeof duckduckgo.config.webSearch === 'object' ? duckduckgo.config.webSearch : {};
      if (typeof duckduckgo.config.webSearch.region === 'string') {
        duckduckgo.config.webSearch.region = duckduckgo.config.webSearch.region.trim();
      }
      if (!duckduckgo.config.webSearch.region) {
        delete duckduckgo.config.webSearch.region;
      }
      const duckSafeSearch = typeof duckduckgo.config.webSearch.safeSearch === 'string'
        ? duckduckgo.config.webSearch.safeSearch.trim().toLowerCase()
        : '';
      duckduckgo.config.webSearch.safeSearch = DUCKDUCKGO_SAFE_SEARCH_OPTIONS.includes(duckSafeSearch)
        ? duckSafeSearch
        : 'moderate';

      const searxng = this.ensureWebProviderEntry(target, 'searxng');
      searxng.enabled = this.normalizeBoolean(searxng.enabled, true);
      searxng.config.webSearch = searxng.config.webSearch && typeof searxng.config.webSearch === 'object' ? searxng.config.webSearch : {};
      if (typeof searxng.config.webSearch.baseUrl === 'string') {
        searxng.config.webSearch.baseUrl = searxng.config.webSearch.baseUrl.trim();
      }
      if (!searxng.config.webSearch.baseUrl) {
        delete searxng.config.webSearch.baseUrl;
      }

      const firecrawl = this.ensureWebProviderEntry(target, 'firecrawl');
      firecrawl.enabled = this.normalizeBoolean(firecrawl.enabled, true);
      firecrawl.config.webSearch = firecrawl.config.webSearch && typeof firecrawl.config.webSearch === 'object' ? firecrawl.config.webSearch : {};
      firecrawl.config.webFetch = firecrawl.config.webFetch && typeof firecrawl.config.webFetch === 'object' ? firecrawl.config.webFetch : {};
      this.normalizeStringField(firecrawl.config.webSearch, 'apiKey');
      this.normalizeStringField(firecrawl.config.webSearch, 'baseUrl');
      this.normalizeStringField(firecrawl.config.webFetch, 'apiKey');
      this.normalizeStringField(firecrawl.config.webFetch, 'baseUrl');
      firecrawl.config.webFetch.onlyMainContent = this.normalizeBoolean(firecrawl.config.webFetch.onlyMainContent, true);
      if (!Number.isFinite(Number(firecrawl.config.webFetch.maxAgeMs)) || Number(firecrawl.config.webFetch.maxAgeMs) < 0) {
        firecrawl.config.webFetch.maxAgeMs = 172800000;
      } else {
        firecrawl.config.webFetch.maxAgeMs = Math.max(0, Math.round(Number(firecrawl.config.webFetch.maxAgeMs)));
      }
      if (!Number.isFinite(Number(firecrawl.config.webFetch.timeoutSeconds)) || Number(firecrawl.config.webFetch.timeoutSeconds) <= 0) {
        firecrawl.config.webFetch.timeoutSeconds = 60;
      } else {
        firecrawl.config.webFetch.timeoutSeconds = Math.max(1, Math.round(Number(firecrawl.config.webFetch.timeoutSeconds)));
      }

      this.pruneEmptyWebProviderConfig(target, 'duckduckgo');
      this.pruneEmptyWebProviderConfig(target, 'searxng');
      this.pruneEmptyWebProviderConfig(target, 'firecrawl');
      return target;
    }

    ensureWebProviderEntry(config: any, providerId: string) {
      this.ensureToolkitWebRoots(config);
      if (!config.plugins.entries[providerId] || typeof config.plugins.entries[providerId] !== 'object') {
        config.plugins.entries[providerId] = {};
      }
      const entry = config.plugins.entries[providerId];
      if (!entry.config || typeof entry.config !== 'object') {
        entry.config = {};
      }
      return entry;
    }

    ensureWebProviderConfigSection(config: any, providerId: string, sectionName: 'webSearch' | 'webFetch') {
      const entry = this.ensureWebProviderEntry(config, providerId);
      if (!entry.config[sectionName] || typeof entry.config[sectionName] !== 'object') {
        entry.config[sectionName] = {};
      }
      return entry.config[sectionName];
    }

    getWebProviderConfigSectionSnapshot(config: any, providerId: string, sectionName: 'webSearch' | 'webFetch') {
      const section = config?.plugins?.entries?.[providerId]?.config?.[sectionName];
      return section && typeof section === 'object' ? section : {};
    }

    normalizeStringField(target: any, key: string) {
      if (!target || typeof target !== 'object') {
        return;
      }
      if (typeof target[key] === 'string') {
        target[key] = target[key].trim();
      }
      if (!target[key]) {
        delete target[key];
      }
    }

    pruneEmptyWebProviderConfig(config: any, providerId: string) {
      const entry = config?.plugins?.entries?.[providerId];
      if (!entry || typeof entry !== 'object') {
        return;
      }
      if (entry.config && typeof entry.config === 'object') {
        for (const key of Object.keys(entry.config)) {
          const value = entry.config[key];
          if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
            delete entry.config[key];
          }
        }
        if (Object.keys(entry.config).length === 0) {
          delete entry.config;
        }
      }

      const searchProvider = typeof config?.tools?.web?.search?.provider === 'string'
        ? config.tools.web.search.provider.trim().toLowerCase()
        : '';
      const fetchProvider = typeof config?.tools?.web?.fetch?.provider === 'string'
        ? config.tools.web.fetch.provider.trim().toLowerCase()
        : '';
      const shouldKeepEnabled = searchProvider === providerId || fetchProvider === providerId || !!entry.config;

      if (!shouldKeepEnabled) {
        delete entry.enabled;
      } else {
        entry.enabled = this.normalizeBoolean(entry.enabled, true);
      }

      if (Object.keys(entry).length === 0) {
        delete config.plugins.entries[providerId];
      }
    }

    getWebConfigViewSnapshot(config: any = this.config) {
      const clone = JSON.parse(JSON.stringify(config || {}));
      return this.ensureToolkitWebConfig(clone);
    }

    renderWebConfig() {
      const viewConfig = this.getWebConfigViewSnapshot(this.config);
      const search = viewConfig.tools.web.search;
      const fetchConfig = viewConfig.tools.web.fetch;
      const duckduckgo = this.getWebProviderConfigSectionSnapshot(viewConfig, 'duckduckgo', 'webSearch');
      const searxng = this.getWebProviderConfigSectionSnapshot(viewConfig, 'searxng', 'webSearch');
      const firecrawlSearch = this.getWebProviderConfigSectionSnapshot(viewConfig, 'firecrawl', 'webSearch');
      const firecrawlFetch = this.getWebProviderConfigSectionSnapshot(viewConfig, 'firecrawl', 'webFetch');

      return html`
        <div class="grid-2">
          <div class="card">
            <div class="card-header"><h3>Web Search</h3></div>
            <div class="form-group">
              <label class="toggle-switch">
                <input type="checkbox" ?checked=${search.enabled} @change=${(e: any) => {
                  search.enabled = e.target.checked;
                  this.requestUpdate();
                }}>
                Enable managed web search
              </label>
              <div class="help-text">This controls OpenClaw's managed <code>web_search</code> tool. Leave provider blank to let OpenClaw auto-detect from configured providers.</div>
            </div>
            <div class="form-group">
              <label>Search Provider</label>
              <select @change=${(e: any) => {
                const value = String(e.target.value || '').trim().toLowerCase();
                search.provider = value;
                if (!value) delete search.provider;
                this.ensureToolkitWebConfig(this.config);
                this.requestUpdate();
              }}>
                ${WEB_SEARCH_PROVIDER_OPTIONS.map((option) => html`
                  <option value=${option.value} ?selected=${(search.provider || '') === option.value}>${option.label}</option>
                `)}
              </select>
              <div class="help-text">Recommended first choices: DuckDuckGo for zero-key setup, SearXNG for self-hosted search, Firecrawl for hosted extraction/search.</div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label>Max Results</label>
                <input type="number" min="1" step="1" .value=${String(search.maxResults || 5)} @input=${(e: any) => {
                  const parsed = Number(e.target.value);
                  search.maxResults = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 5;
                  this.requestUpdate();
                }}>
              </div>
              <div class="form-group">
                <label>Timeout Seconds</label>
                <input type="number" min="1" step="1" .value=${String(search.timeoutSeconds || 30)} @input=${(e: any) => {
                  const parsed = Number(e.target.value);
                  search.timeoutSeconds = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 30;
                  this.requestUpdate();
                }}>
              </div>
            </div>
            <div class="form-group">
              <label>Cache TTL (minutes)</label>
              <input type="number" min="0" step="1" .value=${String(search.cacheTtlMinutes || 15)} @input=${(e: any) => {
                const parsed = Number(e.target.value);
                search.cacheTtlMinutes = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 15;
                this.requestUpdate();
              }}>
            </div>
          </div>

          <div class="card">
            <div class="card-header"><h3>Web Fetch Fallback</h3></div>
            <div class="form-group">
              <label>Fallback Provider</label>
              <select @change=${(e: any) => {
                const value = String(e.target.value || '').trim().toLowerCase();
                fetchConfig.provider = value;
                if (!value) delete fetchConfig.provider;
                this.ensureToolkitWebConfig(this.config);
                this.requestUpdate();
              }}>
                ${WEB_FETCH_PROVIDER_OPTIONS.map((option) => html`
                  <option value=${option.value} ?selected=${(fetchConfig.provider || '') === option.value}>${option.label}</option>
                `)}
              </select>
              <div class="help-text">When blank, OpenClaw auto-detects the first ready fetch fallback provider. In current upstream, that is usually Firecrawl when credentials are present.</div>
            </div>
            <div class="help-text">Plain <code>web_fetch</code> itself stays available without an API key. This section only controls the fallback provider path for harder pages.</div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-header"><h3>DuckDuckGo</h3></div>
            <div class="help-text" style="margin-bottom: 14px;">Key-free provider. Good first step for testing whether <code>web_search</code> is wired correctly.</div>
            <div class="form-group">
              <label>Region</label>
              <input type="text" .value=${duckduckgo.region || ''} placeholder="us-en" @input=${(e: any) => {
                const configSection = this.ensureWebProviderConfigSection(this.config, 'duckduckgo', 'webSearch');
                configSection.region = String(e.target.value || '').trim();
                if (!configSection.region) delete configSection.region;
                this.requestUpdate();
              }}>
            </div>
            <div class="form-group">
              <label>SafeSearch</label>
              <select @change=${(e: any) => {
                const value = String(e.target.value || '').trim().toLowerCase();
                const configSection = this.ensureWebProviderConfigSection(this.config, 'duckduckgo', 'webSearch');
                configSection.safeSearch = DUCKDUCKGO_SAFE_SEARCH_OPTIONS.includes(value) ? value : 'moderate';
                this.requestUpdate();
              }}>
                ${DUCKDUCKGO_SAFE_SEARCH_OPTIONS.map((value) => html`
                  <option value=${value} ?selected=${(duckduckgo.safeSearch || 'moderate') === value}>${value}</option>
                `)}
              </select>
            </div>
          </div>

          <div class="card">
            <div class="card-header"><h3>SearXNG</h3></div>
            <div class="help-text" style="margin-bottom: 14px;">Best self-hosted option for current OpenClaw web search setup.</div>
            <div class="form-group">
              <label>Base URL</label>
              <input type="text" .value=${searxng.baseUrl || ''} placeholder="http://host.docker.internal:8888" @input=${(e: any) => {
                const configSection = this.ensureWebProviderConfigSection(this.config, 'searxng', 'webSearch');
                configSection.baseUrl = String(e.target.value || '').trim();
                if (!configSection.baseUrl) delete configSection.baseUrl;
                this.requestUpdate();
              }}>
              <div class="help-text">Point this at your SearXNG instance. OpenClaw docs also support <code>SEARXNG_BASE_URL</code> env-based setup.</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Firecrawl</h3></div>
          <div class="help-text" style="margin-bottom: 14px;">Advanced provider for hosted or experimental self-hosted setups. Upstream docs are written around <code>https://api.firecrawl.dev</code>, so custom base URLs should be treated as experimental.</div>
          <div class="grid-2">
            <div>
              <div class="form-group">
                <label>Search API Key</label>
                <input type="text" .value=${firecrawlSearch.apiKey || ''} placeholder="fc-... or dummy key" @input=${(e: any) => {
                  const configSection = this.ensureWebProviderConfigSection(this.config, 'firecrawl', 'webSearch');
                  configSection.apiKey = String(e.target.value || '').trim();
                  if (!configSection.apiKey) delete configSection.apiKey;
                  this.requestUpdate();
                }}>
              </div>
              <div class="form-group">
                <label>Search Base URL</label>
                <input type="text" .value=${firecrawlSearch.baseUrl || ''} placeholder="https://api.firecrawl.dev" @input=${(e: any) => {
                  const configSection = this.ensureWebProviderConfigSection(this.config, 'firecrawl', 'webSearch');
                  configSection.baseUrl = String(e.target.value || '').trim();
                  if (!configSection.baseUrl) delete configSection.baseUrl;
                  this.requestUpdate();
                }}>
              </div>
            </div>
            <div>
              <div class="form-group">
                <label>Fetch API Key</label>
                <input type="text" .value=${firecrawlFetch.apiKey || ''} placeholder="fc-... or dummy key" @input=${(e: any) => {
                  const configSection = this.ensureWebProviderConfigSection(this.config, 'firecrawl', 'webFetch');
                  configSection.apiKey = String(e.target.value || '').trim();
                  if (!configSection.apiKey) delete configSection.apiKey;
                  this.requestUpdate();
                }}>
              </div>
              <div class="form-group">
                <label>Fetch Base URL</label>
                <input type="text" .value=${firecrawlFetch.baseUrl || ''} placeholder="https://api.firecrawl.dev" @input=${(e: any) => {
                  const configSection = this.ensureWebProviderConfigSection(this.config, 'firecrawl', 'webFetch');
                  configSection.baseUrl = String(e.target.value || '').trim();
                  if (!configSection.baseUrl) delete configSection.baseUrl;
                  this.requestUpdate();
                }}>
              </div>
            </div>
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label class="toggle-switch">
                <input type="checkbox" ?checked=${firecrawlFetch.onlyMainContent ?? true} @change=${(e: any) => {
                  const configSection = this.ensureWebProviderConfigSection(this.config, 'firecrawl', 'webFetch');
                  configSection.onlyMainContent = e.target.checked;
                  this.requestUpdate();
                }}>
                Only Main Content
              </label>
            </div>
            <div class="form-group">
              <label>Fetch Timeout Seconds</label>
              <input type="number" min="1" step="1" .value=${String(firecrawlFetch.timeoutSeconds || 60)} @input=${(e: any) => {
                const parsed = Number(e.target.value);
                const configSection = this.ensureWebProviderConfigSection(this.config, 'firecrawl', 'webFetch');
                configSection.timeoutSeconds = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 60;
                this.requestUpdate();
              }}>
            </div>
          </div>
          <div class="form-group">
            <label>Fetch Cache Max Age (ms)</label>
            <input type="number" min="0" step="1000" .value=${String(firecrawlFetch.maxAgeMs || 172800000)} @input=${(e: any) => {
              const parsed = Number(e.target.value);
              const configSection = this.ensureWebProviderConfigSection(this.config, 'firecrawl', 'webFetch');
              configSection.maxAgeMs = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 172800000;
              this.requestUpdate();
            }}>
          </div>
        </div>
      `;
    }
  };
