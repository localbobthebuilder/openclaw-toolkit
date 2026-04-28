export const VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES = [
  'AGENTS.md',
  'TOOLS.md',
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'MEMORY.md'
] as const;

export const VALID_WORKSPACE_MARKDOWN_FILES = [
  ...VALID_AGENT_BOOTSTRAP_MARKDOWN_FILES,
  'BOOTSTRAP.md',
  'BOOT.md'
] as const;

export type AvailableToolOption = {
  id: string;
  description: string;
  note?: string;
};

export const AVAILABLE_TOOL_OPTIONS: AvailableToolOption[] = [
  { id: 'read', description: 'Read files and directories' },
  { id: 'write', description: 'Write files' },
  { id: 'edit', description: 'Edit files inline' },
  { id: 'apply_patch', description: 'Patch files in place', note: 'OpenAI exclusive' },
  { id: 'exec', description: 'Run shell commands' },
  { id: 'process', description: 'Inspect running processes' },
  { id: 'code_execution', description: 'Run code snippets' },
  { id: 'web_search', description: 'Search the web' },
  { id: 'web_fetch', description: 'Fetch web pages' },
  { id: 'x_search', description: 'Search X / Twitter' },
  { id: 'memory_search', description: 'Search memory' },
  { id: 'memory_get', description: 'Read memory entries' },
  { id: 'sessions_list', description: 'List sub-agent sessions' },
  { id: 'sessions_history', description: 'Read sub-agent history' },
  { id: 'sessions_send', description: 'Send work to sub-agents' },
  { id: 'sessions_spawn', description: 'Spawn sub-agents' },
  { id: 'sessions_yield', description: 'Yield for sub-agent results' },
  { id: 'subagents', description: 'Manage sub-agents' },
  { id: 'session_status', description: 'Inspect session status' },
  { id: 'browser', description: 'Control a browser' },
  { id: 'canvas', description: 'Control canvases' },
  { id: 'message', description: 'Send messages' },
  { id: 'cron', description: 'Schedule automation' },
  { id: 'gateway', description: 'Gateway control' },
  { id: 'nodes', description: 'Nodes and devices' },
  { id: 'agents_list', description: 'List agents' },
  { id: 'update_plan', description: 'Update shared plan state' },
  { id: 'image', description: 'Understand images' },
  { id: 'image_generate', description: 'Generate images' },
  { id: 'music_generate', description: 'Generate music' },
  { id: 'video_generate', description: 'Generate video' },
  { id: 'tts', description: 'Text to speech' }
];

export const MINIMAL_CHAT_ONLY_ALLOW = ['message'];
export const MINIMAL_CHAT_ONLY_DENY = AVAILABLE_TOOL_OPTIONS
  .map((tool) => tool.id)
  .filter((toolId) => !MINIMAL_CHAT_ONLY_ALLOW.includes(toolId));
export const DELEGATION_CONTROLLED_TOOL_IDS = ['sessions_spawn', 'subagents'] as const;
export const THINKING_LEVEL_OPTIONS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive'] as const;
export const TOOL_CHOICE_OPTIONS = ['', 'auto', 'required', 'none'] as const;
