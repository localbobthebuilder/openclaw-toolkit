import { LitElement } from 'lit';

type Constructor<T = {}> = new (...args: any[]) => T;

export const ToolkitDashboardStatusLogicMixin = <TBase extends Constructor<LitElement>>(Base: TBase) =>
  class ToolkitDashboardStatusLogicMixin extends Base {
    [key: string]: any;

  getConfigurationChecklist() {
    if (!this.config || typeof this.config !== 'object') {
      return {
        ready: false,
        missingRequired: 1,
        required: [
          {
            label: 'Configuration loaded',
            complete: false,
            note: 'Waiting for dashboard configuration to load.'
          }
        ],
        optional: [
          {
            label: 'Telegram routing configured',
            complete: false,
            note: 'Optional. Configure this only if you want Telegram routing.'
          },
          {
            label: 'Voice notes configured',
            complete: false,
            note: 'Optional. Configure this only if you want voice notes.'
          }
        ]
      };
    }

    const endpoints = Array.isArray(this.config.endpoints) ? this.config.endpoints : [];
    const workspaces = Array.isArray(this.config.workspaces) ? this.config.workspaces : [];
    const agents = typeof this.getManagedAgentEntries === 'function'
      ? this.getManagedAgentEntries()
      : (Array.isArray(this.config?.agents?.list) ? this.config.agents.list.map((agent: any, idx: number) => ({
          key: typeof agent?.key === 'string' && agent.key.trim().length > 0 ? agent.key : `agent:${idx}`,
          agent
        })).filter((entry: any) => entry.agent?.id) : []);
    const agentIds = agents
      .map(({ agent }: any) => String(agent?.id || '').trim())
      .filter((agentId: string) => agentId.length > 0);
    const endpointAgentIds = new Set(
      endpoints.flatMap((endpoint: any) => Array.isArray(endpoint?.agents) ? endpoint.agents : [])
        .map((agentId: any) => String(agentId || '').trim())
        .filter((agentId: string) => agentId.length > 0)
    );
    const defaultEndpoint = endpoints.find((endpoint: any) => endpoint?.default) || null;
    const defaultEndpointAgentIds = defaultEndpoint
      ? this.getEndpointAgentIds(defaultEndpoint)
      : [];
    const defaultEndpointAgentCount = defaultEndpointAgentIds.length;
    const defaultEndpointModelCount = defaultEndpoint
      ? (Array.isArray(defaultEndpoint.models) ? defaultEndpoint.models.length : 0) + (Array.isArray(defaultEndpoint.hostedModels) ? defaultEndpoint.hostedModels.length : 0)
      : 0;
    const workspacePathsConfigured = workspaces.filter((workspace: any) => String(workspace?.path || '').trim().length > 0).length;
    const agentsWithWorkspace = agents.filter(({ agent }: any) => {
      const agentId = String(agent?.id || '').trim();
      return !!agentId && workspaces.some((workspace: any) => Array.isArray(workspace?.agents) && workspace.agents.includes(agentId));
    });
    const agentsWithEndpoint = agents.filter(({ agent }: any) => endpointAgentIds.has(String(agent?.id || '').trim()));
    const telegramConfig = this.config?.telegram && typeof this.config.telegram === 'object'
      ? this.config.telegram
      : { enabled: true, defaultAccount: '', accounts: [] };
    const defaultTelegramAccountId = String(telegramConfig.defaultAccount || '').trim() || 'default';
    const telegramAccounts = Array.isArray(telegramConfig.accounts) ? telegramConfig.accounts : [];
    const telegramSetupRecords: any[] = [];
    if (typeof this.getTelegramSetupStatusRecord === 'function') {
      const defaultTelegramSetupStatus = this.getTelegramSetupStatusRecord(defaultTelegramAccountId, true);
      if (defaultTelegramSetupStatus) {
        telegramSetupRecords.push(defaultTelegramSetupStatus);
      }
      for (const account of telegramAccounts) {
        const accountId = String(account?.id || '').trim();
        if (!accountId) {
          continue;
        }
        const accountSetupStatus = this.getTelegramSetupStatusRecord(accountId, false);
        if (accountSetupStatus) {
          telegramSetupRecords.push(accountSetupStatus);
        }
      }
    }
    const telegramConfiguredByStatus = telegramSetupRecords.some((record: any) => !!record?.configured);
    const telegramConfigured = telegramConfiguredByStatus || (
      telegramConfig.enabled !== false &&
      defaultTelegramAccountId.length > 0 &&
      telegramAccounts.length > 0
    );
    const voiceNotes = this.config?.voiceNotes && typeof this.config.voiceNotes === 'object'
      ? this.config.voiceNotes
      : { enabled: false, mode: '', whisperModel: '' };
    const voiceConfigured = !voiceNotes.enabled || (
      String(voiceNotes.mode || '').trim().length > 0 &&
      String(voiceNotes.whisperModel || '').trim().length > 0
    );
    const toolsets = typeof this.getToolsetsList === 'function'
      ? this.getToolsetsList()
      : (Array.isArray(this.config?.toolsets?.list) ? this.config.toolsets.list : []);
    const customToolsetCount = toolsets.filter((toolset: any) => String(toolset?.key || '').trim() && String(toolset?.key || '').trim() !== 'minimal').length;
    const toolsetsConfigured = customToolsetCount > 0;

    const required = [
      {
        label: 'At least one endpoint defined',
        complete: endpoints.length > 0,
        note: endpoints.length > 0
          ? `${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'} defined.`
          : 'Create your first endpoint in Configuration > Endpoints so the dashboard has a place to run models.'
      },
      {
        label: 'Default endpoint chosen',
        complete: !!defaultEndpoint,
        note: defaultEndpoint
          ? `${defaultEndpoint.key} is the preferred endpoint for new work.`
          : 'Pick the endpoint that should be preferred first when agents need a home.'
      },
      {
        label: 'Default endpoint has models',
        complete: defaultEndpointModelCount > 0,
        note: defaultEndpoint
          ? defaultEndpointModelCount > 0
            ? `${defaultEndpointModelCount} local or hosted model${defaultEndpointModelCount === 1 ? '' : 's'} attached to the default endpoint.`
            : 'Add at least one local or hosted model to the default endpoint so agents have something to use.'
          : 'Choose a default endpoint first.'
      },
      {
        label: 'At least one workspace defined',
        complete: workspaces.length > 0,
        note: workspaces.length > 0
          ? `${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} defined.`
          : 'Create at least one shared or private workspace in Configuration > Workspaces so agents have home bases.'
      },
      {
        label: 'Every workspace has a path',
        complete: workspaces.length > 0 && workspacePathsConfigured === workspaces.length,
        note: workspaces.length > 0
          ? workspacePathsConfigured === workspaces.length
            ? 'Every workspace has a home-base path.'
            : `${workspaces.length - workspacePathsConfigured} workspace${workspaces.length - workspacePathsConfigured === 1 ? ' is' : 's are'} missing a home-base path.`
          : 'Create a workspace first.'
      },
      {
        label: 'At least one agent defined',
        complete: agentIds.length > 0,
        note: agentIds.length > 0
          ? `${agentIds.length} managed agent${agentIds.length === 1 ? '' : 's'} defined.`
          : 'Add your first managed agent in Configuration > Agents so the topology has something to route.'
      },
      {
        label: 'Every agent has a workspace',
        complete: agentIds.length > 0 && agentsWithWorkspace.length === agentIds.length,
        note: agentIds.length > 0
          ? agentsWithWorkspace.length === agentIds.length
            ? 'Every managed agent has a workspace home base.'
            : `${agentIds.length - agentsWithWorkspace.length} agent${agentIds.length - agentsWithWorkspace.length === 1 ? ' is' : 's are'} still missing a workspace assignment.`
          : 'Add a managed agent first.'
      },
      {
        label: 'Every agent has endpoint placement',
        complete: agentIds.length > 0 && agentsWithEndpoint.length === agentIds.length,
        state: !defaultEndpoint || defaultEndpointAgentCount === 0
          ? 'error'
          : agentsWithEndpoint.length === agentIds.length
            ? 'success'
            : 'warning',
        note: !defaultEndpoint
          ? 'Choose a default endpoint first.'
          : defaultEndpointAgentCount === 0
            ? 'The default endpoint has no agents assigned yet, so new work has nowhere to land.'
            : agentsWithEndpoint.length === agentIds.length
              ? 'Every managed agent is placed on an endpoint.'
              : `${agentIds.length - agentsWithEndpoint.length} agent${agentIds.length - agentsWithEndpoint.length === 1 ? ' is' : 's are'} still missing endpoint placement.`
      }
    ];

    const optional = [
      {
        label: 'Telegram routing configured',
        complete: telegramConfigured,
        note: telegramConfigured
          ? telegramConfiguredByStatus
            ? 'Telegram setup status reports a configured live account.'
            : 'Telegram has a default account and at least one configured account.'
          : 'Optional. Set this up only if you want Telegram routing and chat-based automation.'
      },
      {
        label: 'Voice notes configured',
        complete: voiceConfigured,
        note: voiceConfigured
          ? voiceNotes.enabled
            ? `Voice notes are enabled with ${voiceNotes.mode} and ${voiceNotes.whisperModel}.`
            : 'Voice notes are disabled, which is fine if you do not need them.'
          : 'Voice notes are enabled, but the mode or model still needs attention.'
      },
      {
        label: 'Additional toolsets defined',
        complete: toolsetsConfigured,
        note: toolsetsConfigured
          ? `${customToolsetCount} custom toolset${customToolsetCount === 1 ? '' : 's'} defined beyond the built-in minimal baseline.`
          : 'Only the built-in minimal toolset exists. Add custom toolsets when you want more specific allow/deny layers.'
      }
    ];

    const missingRequired = required.filter((item) => !item.complete).length;
    return {
      ready: missingRequired === 0,
      missingRequired,
      required,
      optional
    };
  }
  };
