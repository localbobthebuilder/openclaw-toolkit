# Multi-Agent OpenClaw Notes

This note distills useful ideas from `D:\openclaw\how_to_multi_agent_in_open_claw.txt`
against the official OpenClaw docs/source in `D:\openclaw\openclaw`.

## Confirmed OpenClaw facts

- OpenClaw can run multiple agents with different models at the same time.
  The documented model is multiple isolated agents in one gateway process,
  each with its own workspace, `agentDir`, and session store.
- `openclaw agents add <name>` is the standard way to create a new isolated
  agent. Source-backed CLI flags include `--workspace`, `--model`,
  `--agent-dir`, `--bind`, `--non-interactive`, and `--json`.
- Cross-agent orchestration is real, but the native primitives are
  `sessions_spawn` for background subagents and `sessions_send` for
  cross-session messaging. Cross-agent session access is gated by
  `tools.agentToAgent`.
- Subagents can use different models from the caller. OpenClaw supports
  `agents.defaults.subagents.model`, per-agent subagent overrides, and
  explicit model overrides on `sessions_spawn`.
- Per-agent auth isolation is real. Each agent reads its own
  `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`.
- Prompt caching is real. The current supported knobs are
  `cacheRetention`, `contextPruning.mode: "cache-ttl"`, heartbeat keep-warm,
  and `diagnostics.cacheTrace`.
- Cache usage shows up in `cacheRead` and `cacheWrite`, and OpenClaw surfaces
  that in status/usage tooling.

## Practical patterns we can use

- Model specialization:
  route different channels or workloads to different agents with different
  models, for example a fast chat agent, a hosted research agent, and a
  stronger coder/reviewer path.
- Reviewer and coder separation:
  use separate agents with different tool policies and models, then hand work
  off through `sessions_spawn`, `sessions_send`, or shared files.
- Cost shaping:
  keep expensive models on the main or delegate agents and use cheaper models
  for subagents, reviewers, or bursty notification-style roles.
- Read-only review roles:
  enforce this through per-agent tool allow/deny policy, not by editing
  `TOOLS.md`.
- Shared project handoff:
  one agent can write a summary or artifact to a project path and another agent
  can read it later, provided your workspace/sandbox/tool policy allows it.

## Important corrections to the Gemini conversation

- OpenClaw documents agents as isolated by design.
  The official multi-agent docs explicitly frame the goal as separate workspace
  plus `agentDir` plus sessions. Shared-workspace collaboration is possible as
  a deliberate configuration choice, but it is not the default mental model.
- `skills.load.extraDirs` is not a shared project-folder feature.
  In the docs, `skills.load.extraDirs` is for additional skill directories.
  It is not the official mechanism for sharing arbitrary project folders across
  agents.
- `TOOLS.md` does not grant capabilities.
  The agent-workspace docs explicitly say `TOOLS.md` is guidance only and does
  not control tool availability.
- Reviewer read-only behavior should be enforced in config.
  The right control plane is per-agent tool policy and sandbox/tool guards, not
  a hand-written read-only `TOOLS.md` block.
- Some command examples in the Gemini thread were invented.
  `openclaw agents add` does not have a `--description` flag in current source.
- The made-up prompt-caching config is wrong.
  The supported knobs are `cacheRetention`, pruning, heartbeat, and
  `diagnostics.cacheTrace`, not a top-level `gateway.cache.enabled/ttl/priority`
  block.
- The claim that OpenClaw needs a custom heartbeat script to support caching is
  overstated.
  Official docs already describe native heartbeat keep-warm and cache-trace
  diagnostics.
- The claim that OpenClaw injects a volatile current clock into the prompt by
  default is outdated for current docs.
  Current system-prompt docs say the prompt keeps only the time zone in the
  cache-stable time section and tells the agent to use `session_status` when it
  needs the current time.

## Shared-workspace nuance

- The workspace is the agent's home and the default cwd for file tools.
- It is not a hard sandbox by itself.
  Official docs say absolute paths can still reach elsewhere on the host unless
  sandboxing is enabled.
- That means multiple agents can be aimed at the same host project tree if you
  intentionally configure that.
- The risk is not that OpenClaw forbids it by default, but that you are giving
  multiple isolated "brains" access to the same mutable files. That can be very
  useful for collaboration and very risky if tool policy is too open.

## What this means for this toolkit

- This toolkit intentionally uses a shared-workspace role pattern on top of
  OpenClaw's isolated-agent model.
- In `openclaw-bootstrap.config.json`, the managed role policies explicitly say
  the workspace is a shared project area used by multiple agents.
- The toolkit then differentiates agents mainly by model selection, tool policy,
  and role overlays rather than by separate host project trees.
- That makes the following pattern valid here:
  one agent researches, another codes, another reviews, all against the same
  durable workspace, while still keeping per-agent auth/session/model state
  isolated under `~/.openclaw/agents/<agentId>/...`.

## Shared workspace versus private homes

- If sandboxing is off, separate workspaces are mainly a default cwd and prompt
  organization choice, not a strong security boundary.
- That means "every agent has its own workspace, but they all really work in
  one chosen project tree through absolute paths" is operationally very close
  to "the shared project tree is their configured workspace".
- The shared-workspace approach is still useful because it is more honest about
  the real workflow: the default cwd, file tools, and workspace instructions all
  point at the project the agents are actually collaborating on.
- Private workspaces are still useful when you want an agent to have its own
  scratch area, local notes, or role-specific home files while keeping the main
  project tree collaborative.
- In short:
  shared workspace is better for direct collaboration;
  private workspaces are better for role-specific homes;
  sandboxing and tool policy are what really decide isolation.

## Mixed workspace support in this toolkit

- The toolkit now supports a mixed layout for the managed role slots.
- Global shared collaboration still comes from `multiAgent.sharedWorkspace`.
- Any managed agent can opt out of that shared default with
  `workspaceMode: "private"`.
- A private agent can set its own `workspace`, or if omitted the toolkit now
  defaults it to `/home/node/.openclaw/workspace-<agentId>` (with `main`
  defaulting to `/home/node/.openclaw/workspace`).
- A private agent can also opt into shared-project collaboration guidance with
  `sharedWorkspaceAccess: true`. That does not change hard permissions by
  itself; it just tells the agent where the shared project tree lives and how to
  use it.
- The toolkit is not fully generic yet:
  it manages a fixed set of role slots such as `main`, `research`,
  `chat-local`, `review-local`, and the coder/reviewer delegates.
  For totally new extra agents outside those slots, use native OpenClaw agent
  creation or extend the toolkit schema further.

## Recommended house view

- Treat "isolated agents" as the OpenClaw base model.
- Treat "shared project workspace" as an intentional higher-level workflow we
  configure on top of that base model when we want collaboration.
- Enforce safety with tool policy, sandboxing, and exact file-path handoff
  discipline.
- Prefer native orchestration tools first:
  `sessions_spawn`, `sessions_send`, `tools.agentToAgent`, bindings, and
  per-agent model/tool policy.
- Reach for custom orchestration code only after the native primitives stop
  being enough.

## Sources checked

- `docs/concepts/multi-agent.md`
- `docs/concepts/agent-workspace.md`
- `docs/concepts/session-tool.md`
- `docs/tools/subagents.md`
- `docs/reference/prompt-caching.md`
- `docs/reference/token-use.md`
- `docs/concepts/system-prompt.md`
- `src/cli/program/register.agent.ts`
- `openclaw-toolkit/openclaw-bootstrap.config.json`
