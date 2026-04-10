# OpenClaw Bootstrap Manual Steps

Use this as the main entrypoint:

```powershell
.\run-openclaw.cmd help
```

Bootstrap now starts with a Windows prerequisite phase before it does any
OpenClaw work. That prerequisite phase checks:

- hardware virtualization availability
- WSL 2 readiness
- Docker Desktop
- Ollama
- Tailscale
- Git

If something is missing, it tries to install what can be automated and then
reports all remaining blockers together instead of failing on the first one.

On a machine that is already set up, this phase should be fast:

- if Docker Desktop is already ready, bootstrap does not try to restart it
- if Ollama is already serving on `http://127.0.0.1:11434`, bootstrap leaves it alone
- if Tailscale is already signed in and running, bootstrap just records that it is ready

You can run that phase by itself with:

```powershell
.\run-openclaw.cmd prereqs
```

You do not need to run every script in this directory.

For a compact day-to-day cheat sheet, see:

`.\quick-reference.md`

## Command reference

Main operator wrapper:

- `.\run-openclaw.cmd prereqs`
  Audit Windows prerequisites, auto-install what can be installed, and report remaining blockers.
- `.\run-openclaw.cmd bootstrap`
  First-time setup or re-apply the hardened setup on the current machine.
- `.\run-openclaw.cmd backup`
  Create a portable recovery snapshot zip.
- `.\run-openclaw.cmd restore`
  Restore host state and repo-local files from the newest backup zip.
- `.\run-openclaw.cmd update`
  Take a pre-update backup, move to the newest stable OpenClaw release tag, then re-run bootstrap and verify.
- `.\run-openclaw.cmd start`
  Start Docker/OpenClaw and open the authenticated localhost dashboard.
- `.\run-openclaw.cmd status`
  Show Docker, gateway, container, and Tailscale Serve status.
- `.\run-openclaw.cmd dashboard`
  Open the localhost tokenized dashboard URL.
- `.\run-openclaw.cmd dashboard-repair`
  Approve pending dashboard device pairings, then reopen the dashboard.
- `.\run-openclaw.cmd openai-auth`
  Run the one-time OpenAI Codex OAuth flow for OpenClaw, then re-apply bootstrap.
- `.\run-openclaw.cmd gemini-auth`
  Run the one-time Gemini auth flow for OpenClaw, then re-apply bootstrap.
- `.\run-openclaw.cmd claude-auth`
  Run Anthropic auth for OpenClaw. Default is API-key auth; use `-Method paste-token` or `-Method cli` only if you intentionally need those older flows.
- `.\run-openclaw.cmd verify`
  Run the full verification report and smoke tests.
- `.\run-openclaw.cmd verify -Checks "<name1 name2 ...>"`
  Run only specific verification areas such as `voice`, `local-model`, `agent`, or `sandbox`.
- `.\run-openclaw.cmd agents`
  Apply the starter multi-agent layout from the bootstrap config.
- `.\run-openclaw.cmd watchdog`
  Run one health-check pass with optional restart/alert behavior.
- `.\run-openclaw.cmd install-watchdog`
  Install a Windows Scheduled Task for recurring watchdog checks.
- `.\run-openclaw.cmd voice-test`
  Smoke-test voice transcription through the live media config.
- `.\run-openclaw.cmd local-model-test`
  Smoke-test OpenClaw through the configured Ollama model path.
- `.\run-openclaw.cmd agent-smoke`
  Smoke-test the shared-workspace agent roles, especially the Telegram-routed agent's real file and git workflows.
- `.\run-openclaw.cmd remote-review-smoke`
  Smoke-test `main -> coder-remote -> review-local` on the shared workspace and verify that the review task uses exact full file paths.
- `.\run-openclaw.cmd temp-agent-probe`
  Create a temporary agent through the live gateway API, create one session for it, and report which files appeared under `%USERPROFILE%\.openclaw`. By default it cleans the probe back up and restarts the gateway so live state matches disk.
- `.\run-openclaw.cmd model-fit -Model <ollama-model> -EndpointKey <endpoint-key> [-MaxContextWindow <tokens>]`
  Probe a local Ollama model on a named endpoint, starting at 4k context and increasing until the configured VRAM headroom rule is reached.
- `.\run-openclaw.cmd add-local-model -Model <ollama-model> -EndpointKey <endpoint-key> [-FallbackModel <fallback-model-id>] [-AssignTo <agent-id>]`
  Preflight raw model size and disk space, pull a missing Ollama model on that endpoint, auto-probe a safe context, write it into bootstrap config, optionally write ordered `fallbackModelIds`, and optionally assign it to an agent before reapplying bootstrap.
- `.\run-openclaw.cmd remove-local-model -Model <ollama-model> [-ReplaceWith <other-ollama-model>]`
  Remove a local Ollama model from managed config and host Ollama storage. If the model is managed, retarget any managed local-agent references before reapplying bootstrap.
- `.\run-openclaw.cmd compact-storage`
  Compact Docker Desktop's WSL data disk and restart OpenClaw afterward.
- `.\run-openclaw.cmd sandbox-test`
  Smoke-test one harmless sandboxed exec action.
- `.\run-openclaw.cmd telegram-ids`
  Inspect Telegram IDs from OpenClaw logs.
- `.\run-openclaw.cmd stop`
  Stop the gateway and remove disposable sandbox worker containers.

Wrapper help note:

- `run-openclaw.cmd` is the curated top-level operator help entrypoint.
- The individual `run-*.cmd` wrappers now also expose direct parameter help for
  their backing PowerShell scripts.
- Supported help triggers on wrappers: `help`, `-Help`, `--help`, and `/?`
- Examples:
  `.\run-verify.cmd /?`
  `.\run-add-local-model.cmd help`
  `.\run-status.cmd --help`
- The top-level wrapper also forwards these help aliases to subcommands, so
  `.\run-openclaw.cmd verify /?` works too.

Endpoints are machines or PCs. If one has a local Ollama runtime, it can
declare endpoint-level desired models under `endpoint.ollama.models`. That is
useful when you have multiple Ollama PCs and want bootstrap to keep a small
starter model present on each machine even before any agent is assigned to it.

Example:

```json
"endpoints": [
  {
    "key": "review-pc",
    "ollama": {
      "baseUrl": "http://desktop-r9ab74f:11434",
      "models": [
        {
          "id": "qwen2.5:7b",
          "input": ["text"],
          "minimumContextWindow": 16384
        }
      ],
      "autoPullMissingModels": true
    }
  }
]
```

With that in place, `bootstrap` will try to pull `qwen2.5:7b` onto
`review-pc` automatically when it fits the endpoint VRAM budget.

OpenClaw model failover note:

- OpenClaw first rotates auth profiles within the current provider.
- If that does not recover the run, it falls back to the next configured
  model for that agent.
- In this toolkit, `main` can therefore move from OpenAI Codex to Gemini and
  then to local Ollama if a hosted provider hits quota or auth failure.

Direct scripts:

- `.\run-bootstrap.cmd`
  Launch bootstrap with PowerShell 7 if available.
- `.\run-verify.cmd`
  Launch verify with PowerShell 7 if available.
- `.\run-configure-agents.cmd`
  Apply the starter multi-agent layout directly.
- `.\run-backup.cmd`
  Launch backup directly.
- `.\run-restore.cmd`
  Launch restore directly.
- `.\run-update.cmd`
  Launch update directly.
- `.\run-start.cmd`
  Launch start directly.
- `.\run-status.cmd`
  Launch status directly.
- `.\run-stop.cmd`
  Launch stop directly.
- `.\run-dashboard.cmd`
  Open the tokenized localhost dashboard directly.
- `.\run-dashboard-repair.cmd`
  Repair dashboard pairing directly.
- `.\run-openai-auth.cmd`
  Run the one-time OpenAI Codex OAuth flow for OpenClaw directly.
- `.\run-gemini-auth.cmd`
  Run the one-time Gemini API-key auth flow for OpenClaw directly.
- `.\run-claude-auth.cmd`
  Run Anthropic auth for OpenClaw directly.
- `.\run-watchdog.cmd`
  Run one watchdog pass directly.
- `.\run-install-watchdog.cmd`
  Install the watchdog scheduled task directly.
- `.\run-voice-test.cmd`
  Run the voice smoke test directly.
- `.\run-local-model-test.cmd`
  Run the local-model smoke test directly.
- `.\run-agent-smoke.cmd`
  Run the shared-workspace agent capability smoke test directly.
- `.\run-remote-review-smoke.cmd`
  Run the focused `main -> coder-remote -> review-local` orchestration smoke test directly.
- `.\run-local-delegated-coder-test.cmd`
  Diagnose the exact `main -> coder-local` spawned local-model path and detect raw fake tool-call output.
- `.\run-temp-agent-probe.cmd`
  Create a temporary agent through the live gateway API and inspect which `.openclaw` files are created for it.
- `.\run-add-local-model.cmd`
  Pull, tune, and register a local Ollama model directly.
- `.\run-remove-local-model.cmd`
  Remove a local Ollama model directly.
- `.\run-compact-storage.cmd`
  Compact Docker Desktop's WSL data disk directly.
- `.\run-sandbox-test.cmd`
  Run the sandbox smoke test directly.
- `.\run-telegram-ids.cmd`
  Run Telegram ID inspection directly.

The core mental model is:

- first-time or new machine: `.\run-openclaw.cmd bootstrap`
- create a recovery snapshot: `.\run-openclaw.cmd backup`
- restore from a recovery snapshot: `.\run-openclaw.cmd restore`
- update to the newest stable release and re-apply hardening: `.\run-openclaw.cmd update`
- normal daily startup: `.\run-openclaw.cmd start`
- apply the configured starter multi-agent layout: `.\run-openclaw.cmd agents`
- inspect where a newly created API agent stores its data: `.\run-openclaw.cmd temp-agent-probe`
- run OpenAI Codex OAuth for OpenClaw when needed: `.\run-openclaw.cmd openai-auth`
- complete Gemini auth for OpenClaw when you want the research path: `.\run-openclaw.cmd gemini-auth`
- run Anthropic auth for OpenClaw when needed: `.\run-openclaw.cmd claude-auth`
- health/status check: `.\run-openclaw.cmd status`
- dashboard access: `.\run-openclaw.cmd dashboard`
- clean shutdown: `.\run-openclaw.cmd stop`

Common paste-ready examples:

```powershell
.\run-openclaw.cmd prereqs
.\run-openclaw.cmd bootstrap
.\run-openclaw.cmd start
.\run-openclaw.cmd status
.\run-openclaw.cmd dashboard
.\run-openclaw.cmd phone-dashboard
.\run-openclaw.cmd verify -Checks "voice multi-agent"
.\run-openclaw.cmd agents
.\run-openclaw.cmd agent-smoke
.\run-openclaw.cmd remote-review-smoke
.\run-openclaw.cmd temp-agent-probe -KeepAgent
```

Run the bootstrap script first:

```powershell
pwsh -ExecutionPolicy Bypass -File .\bootstrap-openclaw.ps1
```

If you are not sure which PowerShell is your default, use:

```powershell
.\run-bootstrap.cmd
```

That launcher prefers PowerShell 7 (`pwsh`) automatically and falls back to
Windows PowerShell only if needed.

The simpler operator wrapper is:

```powershell
.\run-openclaw.cmd bootstrap
```

If the dashboard later says `gateway token missing`, use:

```powershell
.\run-openclaw.cmd dashboard
```

That launcher opens the Control UI with the token attached via `#token=...`
instead of weakening auth.

If the dashboard says `pairing required`, use:

```powershell
.\run-openclaw.cmd dashboard-repair
```

That helper lists pending device-pairing requests and can approve the current
pending browser/device requests before you reopen the dashboard.

Firefox note:

- If Firefox is configured to clear cookies, site data, or history on close,
  the Control UI browser identity can be lost and `pairing required` may return
  on the next launch.
- For reliable PC dashboard access, keep site data for the dashboard browser
  profile and avoid private browsing for OpenClaw.

Temporary agent storage probe:

- Run `.\run-temp-agent-probe.cmd` when you want a
  concrete answer to "what files did OpenClaw create for this agent?"
- The helper uses the live gateway API to add an agent, optionally creates one
  session so the session store materializes on disk, and prints the paths it
  changed under `%USERPROFILE%\.openclaw`.
- By default it removes the temporary agent again and restarts the gateway at
  the end so the in-memory agent list matches the cleaned config file.
- Use `-KeepAgent` only when you intentionally want to leave the probe agent in
  place for manual inspection.

Examples:

```powershell
.\run-openclaw.cmd temp-agent-probe
.\run-openclaw.cmd temp-agent-probe -KeepAgent
```

Multi-agent note:

- The source-backed summary for the Gemini conversation about multi-agent
  workflows lives in:
  `.\multi-agent-openclaw-notes.md`

The script automates the parts we already validated on this machine:

- clone `https://github.com/openclaw/openclaw.git` with `--depth 1` if the repo is missing
- seed `.env` from `.\openclaw.env.template` if the repo does not have one yet
- Docker/OpenClaw preflight
- localhost-only Docker port publishing
- Docker Desktop raw socket mount for sandboxing
- rebuilding the gateway image with Docker CLI support when needed
- building the sandbox image when needed
- gateway auth rate limiting
- Control UI hardening
- all-session sandboxing with workspace-only filesystem access
- removal of redundant default node deny entries when no custom node allowlist is configured
- trusted Telegram allowlist configuration, including your chosen group mention policy
- voice-note transcription wiring through the configured OpenClaw media provider
- Tailscale Serve setup
- Ollama provider wiring
- optional starter multi-agent layout
- optional Gemini research-provider wiring and one-time Gemini auth helper
- health + security verification

The script still pauses for a few human-only steps when needed:

## 1. Repo clone and `.env` seeding

If `<repo-dir>` does not exist yet, bootstrap clones the repo for you:

```powershell
git clone --depth 1 https://github.com/openclaw/openclaw.git <repo-dir>
```

If `<repo-dir>\.env` does not exist yet, bootstrap seeds it from:

`.\openclaw.env.template`

Bootstrap then fills in the machine-specific values such as:

- `OPENCLAW_CONFIG_DIR`
- `OPENCLAW_WORKSPACE_DIR`
- `OPENCLAW_GATEWAY_PORT`
- `OPENCLAW_BRIDGE_PORT`
- `OPENCLAW_GATEWAY_BIND`
- `OPENCLAW_GATEWAY_TOKEN`

This is intentionally better than copying a raw machine-specific `.env`, because
the host paths are re-derived for the current Windows user profile.

If the host state under `%USERPROFILE%\.openclaw` is still completely new,
bootstrap warns you and continues. In that case you may still need manual
dashboard sign-in or other first-run onboarding for auth/secrets on that
machine.

## 2. Tailscale Serve enablement

If `tailscale serve --bg ...` fails because Serve/HTTPS is not enabled for the
node yet, the script opens:

`https://login.tailscale.com/f/serve?node=<node-id>`

On that page:

1. Enable HTTPS certificates.
2. Enable Serve for the node.
3. Return to the terminal and press Enter so the script retries.

Important:

- Private `Serve` is desired for OpenClaw.
- Do not intentionally publish `Funnel` for OpenClaw unless you truly want
  public internet exposure.

## 3. Optional channels after bootstrap

This bootstrap kit now applies your trusted Telegram policy after onboarding, but
it still expects the bot token itself to come from onboarding.

Typical follow-up examples:

- OpenAI OAuth already handled by onboarding
- Telegram bot token can be added during onboarding
- Telegram pairing is still a deliberate user action from your phone

For Telegram, the bootstrap can now enforce your trusted sender and trusted
group allowlists directly. Update
`.\openclaw-bootstrap.config.json` if your Telegram user ID,
group ID, or mention policy changes later.

To inspect Telegram user IDs and group IDs from OpenClaw's own logs, use:

```powershell
.\run-telegram-ids.cmd
```

Telegram group notes:

- BotFather privacy mode and OpenClaw mention policy are separate controls.
- BotFather `/setprivacy -> Disable` allows Telegram to deliver all group
  messages to the bot.
- OpenClaw `channels.telegram.groups.<groupId>.requireMention=false` tells
  OpenClaw to answer normal messages in that trusted group without `@mention`.
- If you change BotFather privacy mode, remove and re-add the bot in each group
  so Telegram applies the new behavior.
- Making the bot a Telegram admin is another valid way to ensure Telegram
  delivers all group messages, especially if you prefer to keep BotFather
  privacy enabled or your group restricts regular bots.
- Basic group replies do not always require admin permissions, but private-mode
  bots or restricted groups often behave better after either admin elevation or
  privacy-mode disable + re-add.
- Telegram channels are not a good primary interactive surface for OpenClaw.
  Prefer supergroups with topics when you want chat-style workflows.
- Exec approvals can now be routed into Telegram DMs in this setup.
- The managed bootstrap config enables `channels.telegram.execApprovals` with
  your own Telegram user ID as the only approver and `target: "dm"`.
- That means host-exec approval prompts should arrive as bot DMs on your phone
  instead of forcing you back to the dashboard for normal approval flows.
- If you ever want approval prompts to also appear in the originating trusted
  group/topic, change `telegram.execApprovals.target` in
  `.\openclaw-bootstrap.config.json` from `dm` to `both`.

## 4. Voice notes

The bootstrap can now configure voice-note transcription under
`tools.media.audio`.

On this machine it is set to use a local `whisper` CLI inside a custom gateway
image:

- image: `openclaw:local-voice`
- command: `whisper`
- model: `base`

Important distinction:

- Telegram voice transcription is local on this PC
- the final assistant reply after transcription still uses the conversation's
  active model

So in your current setup:

- speech-to-text is local via `whisper --model base`
- the final reasoning/response is usually still `openai-codex/gpt-5.4` unless
  you explicitly switch the conversation to a local model

The first real transcription may take longer because `whisper` can download the
selected model the first time it runs.

To smoke-test voice-note transcription without sending a real Telegram message,
use:

```powershell
pwsh -ExecutionPolicy Bypass -File .\test-voice-notes.ps1
```

Or:

```powershell
.\run-voice-test.cmd
```

This creates a short synthetic WAV on Windows, copies it into the running
gateway container, and asks OpenClaw's media-understanding runtime to
transcribe it using your live config.

`verify` now runs that voice smoke test automatically when voice notes are
enabled, so `bootstrap` covers it too. The WAV is created temporarily under your
Windows temp folder and cleaned up afterwards; you do not need to keep a
permanent sound file in `<toolkit-dir>`.

## 5. Local model smoke test

To smoke-test the configured Ollama local-model path directly through OpenClaw,
use:

```powershell
.\run-openclaw.cmd local-model-test
```

To probe a local model against your GPU budget before writing its context into
bootstrap, run:

```powershell
.\run-openclaw.cmd model-fit -Model qwen3-coder:30b -EndpointKey local -MaxContextWindow 131072
```

Do not hand-edit endpoint `models` in the bootstrap config unless you are fixing
something surgically and know exactly why. The normal workflow should be:

- add a model with `add-local-model`
- remove a model with `remove-local-model`

Bootstrap already tries to pull any configured missing Ollama models with
`ollama pull`, but `add-local-model` is the preferred path because it also
tunes the context window for your GPU budget. If you want to add a brand-new
local model end to end, use:

```powershell
.\run-openclaw.cmd add-local-model -Model qwen2.5:7b -Name "Qwen 2.5 7B" -EndpointKey review-pc
```

If you want that managed model entry to carry a fallback model, pass it explicitly:

```powershell
.\run-openclaw.cmd add-local-model -Model qwen3-coder:30b -Name "Qwen3 Coder 30B" -EndpointKey local -FallbackModel qwen2.5-coder:3b
```

`-FallbackModel` takes an Ollama model ID and writes it to the managed
`fallbackModelIds` array for that local model entry.

That one command will:

- pull the Ollama model if it is missing
- probe context automatically from 4k upward while keeping 1.5GB VRAM headroom
- write the chosen `contextWindow` and `maxTokens` into `openclaw-bootstrap.config.json`
- optionally point a managed agent at that model
- rerun bootstrap so the live gateway picks it up

When you use the `.cmd` wrappers, pass the `-Contexts` list as one quoted
space-separated string as shown above. The scripts accept commas, semicolons,
or spaces, but a quoted space-separated list is the safest choice through
`cmd.exe`.

Supported `-AssignTo` agent IDs are:

- `chat-local`
- `review-local`
- `coder-local`
- `main`
- `research`
- `chat-openai`

To remove a local model later, use:

```powershell
.\run-openclaw.cmd remove-local-model -Model deepseek-r1:8b -ReplaceWith qwen3-coder:30b
```

What it does now:

- removes the model from managed bootstrap config if it is managed there
- removes the model from host Ollama storage unless you pass `-KeepOllamaModel`
- retargets managed local-agent references if needed
- reruns bootstrap when a managed config change happened, unless you pass `-SkipBootstrap`

If the removed model is currently assigned to a managed local agent and you do
not pass `-ReplaceWith`, the script will automatically retarget that agent to
the first remaining managed local model. If no replacement local model exists,
it will stop with a clear error instead of leaving that agent broken.

Important storage note:

- On this machine, Ollama models live under `%USERPROFILE%\.ollama\models`
  and are not stored inside Docker Desktop's VHDX.
- So `ollama rm` frees Ollama host disk space directly.
- Docker Desktop compaction is a separate maintenance action for reclaiming
  space inside `%USERPROFILE%\AppData\Local\Docker\wsl\disk\docker_data.vhdx`.

If you want to compact Docker Desktop storage after model churn, use:

```powershell
.\run-openclaw.cmd compact-storage
```

Or combine it with model removal:

```powershell
.\run-openclaw.cmd remove-local-model -Model qwen3.5:35b-a3b -CompactDockerData
```

Safe preview examples:

```powershell
.\run-openclaw.cmd remove-local-model -Model deepseek-r1:8b -WhatIf
.\run-openclaw.cmd compact-storage -WhatIf
```

Current tuned local-model caps on this 32GB RTX 5090 setup:

- `qwen3.5:35b-a3b` -> `128000`
- `qwen3-coder:30b` -> `98304`
- `glm-4.7-flash:latest` -> `98304`

This temporarily switches the default model to the chosen Ollama test model,
runs one exact-response prompt, and then restores your original default model.

## 5a. Starter multi-agent layout

The bootstrap kit can now apply a starter multi-agent layout from:

`.\openclaw-bootstrap.config.json`

Path note:
all path fields in that config are now resolved relative to the config file
itself when they are not absolute. That makes the `setup` folder portable as
long as its relative layout stays the same.

The same config also owns managed context behavior for OpenClaw:

- `contextManagement.compaction`
- `contextManagement.contextPruning`
- `toolsets`

Bootstrap writes those into `agents.defaults.compaction` and
`agents.defaults.contextPruning`, and it compiles `toolsets` into per-agent
OpenClaw `tools` blocks. `verify` checks that the managed runtime state still
matches the toolkit config.

The current managed defaults are aimed at long-running chats with local models:

- compaction mode: `safeguard`
- compaction reserve floor: `4000`
- pruning mode: `cache-ttl`
- pruning TTL: `1h`
- old oversized tool output is soft-trimmed first, then hard-cleared if needed

It is controlled by enabled agents that are assigned through an endpoint's
`agents` list in the toolkit config.

If enabled, bootstrap will apply the layout automatically near the end of the
run. You can also re-apply it any time with:

```powershell
.\run-openclaw.cmd agents
```

The current starter layout creates:

- `main`
  the strong default agent that keeps your current primary hosted model and acts as the orchestrator
- `research`
  a Gemini research agent for hosted web/docs/question-answer style work
- `chat-local`
  a lighter local Ollama agent for casual chat-style work
- `chat-openai`
  an optional hosted Telegram agent you can enable when you want Telegram on OpenAI instead of a local model
- `review-local`
  a local Ollama reviewer agent with a tighter read/session-only tool policy
- `coder-local`
  a hosted coding delegate for bounded edits, refactors, and drafting work

Agent config note:

- model resolution is now driven by each agent's own `modelRef` plus
  `candidateModelRefs`
- use `markdownTemplateKeys.AGENTS.md` on the agent config to choose which
  reusable AGENTS template is written into managed `AGENTS.md`
- AGENTS template keys are reusable, so multiple agents can intentionally share
  one template
- use ordered `toolsetKeys` to stack reusable toolsets such as `research`,
  `review`, or `codingDelegate`
- use `toolOverrides.allow` / `toolOverrides.deny` when you only need a small
  per-agent tweak after the toolsets merge

Example agent-level tool override:

```json
{
  "id": "notes-helper",
  "name": "Notes Helper",
  "toolsetKeys": ["research"],
  "toolOverrides": {
    "deny": ["web_fetch"],
    "allow": ["message"]
  }
}
```

That keeps the `research` toolset as the base, then applies the direct deny and
allow overrides at the end without forcing you to create a brand-new reusable
toolset.

It also enables `tools.agentToAgent` so your stronger agent can delegate to the
other configured agents.

If you want a specific agent to stay on its own model and avoid delegation,
set this in that agent block:

```json
"subagents": {
  "enabled": false
}
```

When `enabled` is `false`, the toolkit does not register that agent's
per-agent subagent allowlist in live OpenClaw config.

Shared workspace note:

- This setup now uses one shared workspace for all managed agents.
- The shared workspace is `agents.defaults.workspace = /home/node/.openclaw/workspace`.
- On this Windows machine, that maps to `%USERPROFILE%\.openclaw\workspace`.
- `main`, `research`, `chat-local`, `review-local`, `coder-local`, and the
  optional `chat-openai` all work against that same project tree.
- This is intentional so chat, coding, and review agents can collaborate on the
  same files instead of being isolated in separate folders.
- Managed per-agent role separation now mainly comes from routing, model choice,
  and tool policy, while the shared workspace stays common.
- This is the honest default for this toolkit because with `sandbox.mode=off`,
  separate workspaces are mostly organization/default-cwd choices rather than
  strong isolation boundaries.
- Managed agents are no longer locked into only that one layout:
  if a shared workspace exists in `workspaces[]`, an individual managed agent
  can still opt out by being assigned to a private workspace.
- A private workspace can set `path` explicitly, or if omitted it now defaults
  to `/home/node/.openclaw/workspace-<agentId>`.
- If you want a private agent to keep its own home workspace but still
  collaborate with the shared project tree, set
  `sharedWorkspaceIds` on that private workspace.
- `sharedWorkspaceIds` adds config-managed instructions telling that private
  agent where the shared project workspace lives and to use exact
  absolute paths there when joining collaborative work.
- The managed toolkit layout still includes the built-in role slots, but it now
  also supports arbitrary managed extras through `agents.list`.

Example extra agent:

```json
"agents": {
  "list": [
    {
      "enabled": true,
      "id": "notes-helper",
      "name": "Notes Helper",
      "toolsetKeys": ["research"],
      "markdownTemplateKeys": {
        "AGENTS.md": "research"
      },
      "modelRef": "google/gemini-3.1-flash-lite-preview",
      "candidateModelRefs": [
        "google/gemini-3.1-flash-lite-preview"
      ],
      "subagents": {
        "requireAgentId": true,
        "allowAgents": []
      }
    }
  ]
},
"workspaces": [
  {
    "id": "workspace-notes-helper",
    "name": "Notes Helper Workspace",
    "mode": "private",
    "path": "/home/node/.openclaw/workspace-notes-helper",
    "sharedWorkspaceIds": ["shared-main"],
    "agents": ["notes-helper"]
  }
]
```

Notes for extra agents in `agents.list`:

- each extra agent needs a unique `id`
- each extra agent is assigned to either a shared or private workspace through
  `workspaces[].agents`
- private extra agents can still collaborate through `sharedWorkspaceIds`
- `markdownTemplateKeys.AGENTS.md` controls which managed `AGENTS.md` template
  is written
- `toolsetKeys` can stack reusable toolsets such as `research`, `review`, or
  `codingDelegate`
- or you can provide an explicit `tools` object directly on the agent
- removing an entry from `agents.list` now removes that managed extra agent from
  live config and cleans up its managed marker / managed workspace prompt file

Example mixed layout:

```json
"agents": {
  "list": [
    {
      "key": "researchAgent",
      "enabled": true,
      "id": "research",
      "name": "Gemini Research",
      "toolsetKeys": ["research"],
      "markdownTemplateKeys": {
        "AGENTS.md": "research"
      },
      "modelRef": "google/gemini-3.1-flash-lite-preview"
    }
  }
},
"workspaces": [
  {
    "id": "workspace-research",
    "name": "Research Workspace",
    "mode": "private",
    "path": "/home/node/.openclaw/workspace-research",
    "sharedWorkspaceIds": ["shared-main"],
    "agents": ["research"]
  }
]
```

That gives `research` its own home workspace and AGENTS file, while still
teaching it how to work against the shared project tree when needed.

Purpose routing note:

- channel routing is explicit, not magical
- trusted Telegram DM/group are routed to whichever agent you set in
  `agents.telegramRouting.targetAgentId`
- by default that target is `chat-local`
- in this Windows + Docker Desktop shared-workspace setup, `chat-local`,
  `review-local`, `coder-local`, and the optional `chat-openai` default to
  `sandbox.mode=off` so they can use the real mounted shared workspace instead
  of the broken disposable `/workspace` mount seen in sandbox sessions
- if you want Telegram on OpenAI while `main` uses Claude or another hosted
  model, enable `hostedTelegramAgent` and set
  `agents.telegramRouting.targetAgentId` to `chat-openai`
- if you want Telegram to use the default strong agent instead, set
  `agents.telegramRouting.targetAgentId` to `main`
- trusted Telegram DM/group routing is managed through
  `bindings`
- everything else defaults to `main`
- `main` learns when to delegate through bootstrap-managed per-agent
  `AGENTS.md` files written into each agent workspace
- those managed `AGENTS.md` files give `main` standing instructions to use:
  - `research` for docs/research/synthesis
  - `review-local` for diff review and verification
  - `coder-local` for bounded delegated coding chores

Important:

- bootstrap now owns the strong default model, the managed model allowlist, the
  starter agent list, and the managed Telegram bindings for this layout
- bootstrap also owns the shared workspace path for this managed layout
- the strong hosted candidate order is now:
  - `openai-codex/gpt-5.4`
  - `anthropic/claude-sonnet-4-6`
  - `google/gemini-3.1-flash-lite-preview`
  - then local Ollama fallback if no hosted candidate is authenticated
- for configured Ollama models, bootstrap now tries to pull missing models with
  `ollama pull`
- if a preferred local primary model is still unavailable, bootstrap falls back
  to another available local model instead of leaving the local agent unusable
- Telegram only routes to `chat-local` when you explicitly turn on the routing
  flags on the selected target agent and/or in `agents.telegramRouting`
- disabling the relevant agent or removing it from its endpoint's `agents` list keeps it toolkit-only
  and removes it from future bootstrap runs

Bootstrap-managed keys for this starter layout live in:

- `agents.defaults.model`
- `agents.defaults.models`
- `agents.list`
- `bindings`
- `tools.agentToAgent`

Bootstrap now keeps the global OpenClaw tool baseline neutral and compiles the
toolkit `toolsets` library into each managed agent's final `tools` block.

Current managed defaults:

- built-in global `minimal` is always applied first
- agent `toolsetKeys` are merged from top to bottom, so lower entries win
- optional agent `toolOverrides.allow` / `toolOverrides.deny` are applied after the toolsets for one-off tweaks
- `research` adds `web_search` and `web_fetch` while denying write/exec tools
- direct agent `tools` blocks still work and override the compiled preview

That means a fresh machine does not need a pre-configured
`<repo-dir>.json` just to know which strong/local models
or Telegram routes should exist. Bootstrap can reconstruct that layout from
`.\openclaw-bootstrap.config.json`.

Telegram workspace write note:

- `chat-local`, `review-local`, `coder-local`, and `chat-openai` default to
  `sandboxMode: "off"` in the bootstrap config.
- This is intentional for the current Windows + Docker Desktop deployment,
  because the shared collaborative workspace needs to be mounted directly for
  those agents to do real file work.
- `verify` now includes a chat-workspace write smoke test so this does not
  regress silently.

Gemini note:

- This setup now uses the official Google Gemini API-key provider in OpenClaw.
- It does not rely on the unofficial Gemini CLI OAuth integration.
- OpenClaw stores its own Gemini auth in the gateway auth profiles inside `%USERPROFILE%\.openclaw`.
- The supported one-time login path is:

```powershell
.\run-openclaw.cmd gemini-auth
```

- That command runs OpenClaw's interactive `google` API-key auth flow, then reruns bootstrap so the managed allowlist and agents pick Gemini up automatically.
- `verify` will explicitly tell you whether Gemini auth is ready or still waiting on this step.

Other hosted auth helpers:

- OpenAI Codex:

```powershell
.\run-openclaw.cmd openai-auth
```

- Anthropic:
  recommended supported path is API-key auth

```powershell
.\run-openclaw.cmd claude-auth
```

- `claude-auth` now defaults to Anthropic API-key auth inside OpenClaw.
- That matches Anthropic's official API-key-based auth guidance more closely than the older setup-token or CLI-style flows.
- If you intentionally want an older flow instead, use one of:

```powershell
.\run-openclaw.cmd claude-auth -Method paste-token
.\run-openclaw.cmd claude-auth -Method cli
```

Use the older flows only if you have a specific reason.

- GitHub Copilot for OpenClaw:

```powershell
.\run-openclaw.cmd copilot-auth
```

- This runs OpenClaw's built-in `github-copilot` device-login flow inside the gateway container.
- Host-side Copilot CLI or Windows Credential Manager state does not make the gateway ready by itself.

- Ollama cloud auth:

```powershell
.\run-openclaw.cmd ollama-auth
```

- Use this only for Ollama `:cloud` models and Ollama Web Search.
- Local Ollama models on your PC do **not** require Ollama sign-in.
- The toolkit now treats Ollama as three separate surfaces:
  - runtime availability
  - local model inventory
  - cloud auth state

## 6. Sandbox notes

The bootstrap now hardens Dockerized OpenClaw further by:

- rebuilding `openclaw:local` with Docker CLI support
- mounting Docker Desktop's VM socket as `/var/run/docker.sock`
- building `openclaw-sandbox-common:bookworm-slim`
- setting:
  - `agents.defaults.sandbox.mode=all`
  - `agents.defaults.sandbox.scope=session`
  - `agents.defaults.sandbox.workspaceAccess=rw`
  - `tools.fs.workspaceOnly=true`

This is the intended hardening path for your current Windows + Docker Desktop
setup.

The bootstrap also removes OpenClaw's default dangerous node denylist when it is
only acting as dead config. That keeps the security audit cleaner without
opening anything up, because those commands are still not allowlisted by
default.

To run one harmless sandbox exec smoke test manually, use:

```powershell
.\run-openclaw.cmd sandbox-test
```

## 7. Verification

You can re-run the verifier any time:

```powershell
pwsh -ExecutionPolicy Bypass -File .\verify-openclaw.ps1
```

Or use:

```powershell
.\run-verify.cmd
```

Targeted verification examples:

```powershell
.\run-openclaw.cmd verify -Checks voice
.\run-openclaw.cmd verify -Checks "local-model agent"
.\run-openclaw.cmd verify -Checks "sandbox audit"
```

The `agent` smoke test now exercises all configured collaboration roles that matter in day-to-day use:

- `chat-local` for useful git/file work in the shared workspace
- `research` for a real web-backed research task
- `review-local` for read/verification behavior
- `coder-local` for bounded write behavior

When one of those fails, the verifier now reports the specific category, such as `provider-quota`, `provider-auth`, `gateway`, `model-missing`, or `tooling`, so it is easier to tell “bad provider state” from “bad agent wiring”.

For the specific spawned-local-coder problem, use:

```powershell
.\run-openclaw.cmd local-delegate-test
```

That diagnostic does not call `research`. It reproduces the exact `main -> coder-local` spawned local-model path and reports whether the child made a real structured tool call or just printed fake `<function=...>` tool markup as plain text.

Valid check names are:

- `health`
- `docker`
- `tailscale`
- `models`
- `telegram`
- `voice`
- `local-model`
- `agent`
- `sandbox`
- `chat-write`
- `audit`
- `git`
- `multi-agent`
- `context`

Notes:

- If you do not pass `-Checks`, `verify` still runs the full suite.
- `.\bootstrap-report.txt` now reflects the checks you requested in that run, so a targeted verify writes a targeted report.

It writes a fresh status report to:

`.\bootstrap-report.txt`

`verify` now includes:

- voice-note transcription smoke test
- local Ollama model smoke test
- shared-workspace agent capability smoke test
- chat workspace write smoke test
- starter multi-agent verification
- harmless sandbox exec smoke test

The agent capability smoke test is the useful-behavior check for your current
multi-agent layout. It exercises:

- `chat-local` by creating a real temporary git repo in the shared workspace,
  writing and reading a README through OpenClaw, and running `git status`
- `review-local` by reading and validating a shared-workspace file
- `coder-local` by creating a bounded artifact in the shared workspace

You can run it by itself with:

```powershell
.\run-openclaw.cmd agent-smoke
```

To run the narrower remote handoff smoke path by itself, use:

```powershell
.\run-openclaw.cmd remote-review-smoke
```

That focuses on the `main -> coder-remote -> review-local` path and is useful
when you want to debug delegated review choreography without running the broader
agent capability smoke suite.

The multi-agent verification section checks:

- expected agent IDs
- strong default model
- shared default workspace
- managed model allowlist
- actual `chat-local` / `review-local` / `coder-local` model selection, including valid fallback
  local-model cases
- shared-workspace usage for the managed agents
- agent-to-agent delegation allowlist
- Telegram DM/group bindings to the configured Telegram target agent when those
  routing flags are enabled

## 8. Backup snapshots

One genuinely useful idea from the earlier Gemini conversation was keeping a
portable recovery snapshot of your OpenClaw state.

Use:

```powershell
.\run-openclaw.cmd backup
```

That creates a timestamped zip under:

`.\backups`

The backup includes:

- host OpenClaw state from `%USERPROFILE%\.openclaw`
- repo-local `.env`
- repo-local `docker-compose.yml`
- core setup toolkit files

By default it excludes disposable sandbox directories to keep the archive
smaller. If you ever want those too, run:

```powershell
.\run-backup.cmd -IncludeSandboxes
```

## 9. Restore and migration

To restore from the latest backup snapshot on a machine that already has the
setup toolkit, use:

```powershell
.\run-openclaw.cmd restore
```

To restore from a specific zip:

```powershell
.\run-restore.cmd -BackupPath <repo-dir>-backup-YYYYMMDD-HHMMSS.zip
```

Recommended migration flow on a new machine:

1. Copy the `<toolkit-dir>` folder and your backup zip to the new machine.
2. Run `.\run-openclaw.cmd restore -RunBootstrap`
3. Run `.\run-openclaw.cmd start`
4. Run `.\run-openclaw.cmd status`

What restore does:

- extracts the selected backup zip
- creates a safety backup first if the target machine already has OpenClaw state
- clones the OpenClaw repo if it is missing
- restores host state into `%USERPROFILE%\.openclaw`
- restores repo-local `.env` and `docker-compose.yml`
- optionally runs bootstrap afterwards

For a safe preview without writing anything, use:

```powershell
pwsh -ExecutionPolicy Bypass -File .\restore-openclaw.ps1 -WhatIf
```

## 10. Updating OpenClaw

To move to the newest stable OpenClaw release and then re-apply your hardened setup, use:

```powershell
.\run-openclaw.cmd update
```

That helper:

- creates a pre-update backup snapshot first
- stashes the managed local `docker-compose.yml` override if needed
- stashes any toolkit-managed upstream source patch files if they are currently applied
- fetches origin branches and tags
- selects the newest stable release tag by default
- checks out that release tag in detached HEAD mode
- runs bootstrap again
- runs verification again through bootstrap

During bootstrap, the toolkit reapplies any configured upstream source patches,
so the OpenClaw repo can stay close to the official release checkout instead of
carrying permanent hand edits.

It intentionally aborts if the repo contains other unexpected local changes, so
it does not silently stash or overwrite unrelated work.

Optional overrides:

- latest beta release:

```powershell
.\run-openclaw.cmd update -Channel beta
```

- specific tag, branch, or commit:

```powershell
.\run-openclaw.cmd update -Ref v2026.4.2
.\run-openclaw.cmd update -Ref main
```

Recommended policy:

- day-to-day updates: newest stable release tag
- only when you explicitly want pre-release fixes: `-Channel beta`
- only for deliberate source/dev testing: `-Ref main` or another explicit ref

## 11. Watchdog health checks

Another worthwhile extraction from the Gemini notes was a watchdog. On this
machine it runs on the Windows host, not inside the gateway container. That
means it can still detect failures when the gateway is unresponsive or Docker
Desktop is down. It also uses OpenClaw's native `health --json` probe when the
container is available instead of only testing whether the local port is open.

Run one manual watchdog check:

```powershell
.\run-openclaw.cmd watchdog
```

Run it with self-heal and Telegram alerting:

```powershell
.\run-openclaw.cmd watchdog -RestartOnFailure -AlertOnFailure
```

The watchdog behavior is:

- optional internet pre-check first, to reduce false alerts during local ISP outages
- host-side Docker engine availability check
- host-side gateway HTTP health check through `verification.healthUrl`
- native OpenClaw health probe through the running gateway container when available
- optional self-heal by starting Docker/OpenClaw if the engine is down, or `docker compose up -d openclaw-gateway` if Docker is available
- optional Telegram DM to your allowlisted account using your existing bot token

If you want it to run automatically every 5 minutes on Windows, install the
scheduled task:

```powershell
.\run-openclaw.cmd install-watchdog
```

This creates a Windows Scheduled Task named `OpenClaw Watchdog`.

Bootstrap can also install it for you if you enable this in
`.\openclaw-bootstrap.config.json`:

```json
"watchdog": {
  "installScheduledTask": true,
  "everyMinutes": 5,
  "restartOnFailure": true,
  "alertOnFailure": true,
  "skipInternetCheck": false
}
```

Recommended default:

- keep `installScheduledTask: false` until you explicitly want recurring monitoring
- use manual `watchdog` checks first
- enable the scheduled task later as an operator choice, not as an automatic bootstrap surprise

## 12. Access from phone

You now have two practical ways to use OpenClaw from your phone:

- Telegram, for chat-style interaction
- Tailscale browser access, for the full dashboard/chat UI

The browser path depends on all of these being true:

- your phone is connected to Tailscale
- your PC is on
- Docker Desktop is running
- OpenClaw is started

The safe phone browser flow is:

1. On the PC, run:

```powershell
.\run-openclaw.cmd phone-dashboard
```

2. That command prints and copies a tokenized Tailscale dashboard URL.
3. Open that exact URL on your phone.

Notes:

- The token is attached as `#token=...`, which is safer than putting it in a
  normal query string.
- The phone browser may require one-time device pairing the first time it
  connects.
- If the phone ever shows `pairing required`, run:

```powershell
.\run-openclaw.cmd dashboard-repair
```

- If the phone ever shows `origin not allowed`, re-run bootstrap or verify that
  `gateway.controlUi.allowedOrigins` still includes your Tailscale URL.

### When will you need to re-authenticate?

Usually not often.

For your setup, these are the separate auth layers:

- dashboard gateway token
- device pairing
- provider OAuth (for example OpenAI Codex)

Dashboard gateway token:

- usually one-time per browser/profile/origin
- the Control UI stores it in browser local storage after first load
- you will likely need it again if you clear site data, switch browsers, use
  private/incognito mode, or rotate the gateway token

Device pairing:

- usually one-time per browser/device
- you will likely need it again if the browser loses its local device state or
  if you remove that paired device from OpenClaw
- on Firefox, clear-on-close privacy settings can cause repeated re-pairing on
  every browser restart

Provider OAuth:

- usually refreshes automatically in the background
- you only need to sign in again if the provider login expires or the refresh
  path breaks

Practical expectation:

- PC localhost dashboard: rarely needs token or re-pairing again
- phone Tailscale dashboard: rarely needs token or re-pairing again in the same browser
- Telegram chat: does not use the dashboard token flow at all

## 13. Tailscale policy notes

One good manual hardening idea from the Gemini transcript that is still worth
keeping is a least-privilege Tailscale ACL/tag policy.

This is not something bootstrap can safely automate for you because it lives in
the Tailscale admin console, but it is worth considering if your tailnet has
multiple users or devices:

- create a tag for the OpenClaw host
- create a tag for your admin devices
- only allow those admin devices to reach the OpenClaw dashboard
- optionally require periodic reauthentication for those tagged paths

On a Windows host, the Tailscale SSH guidance from that transcript is not the
main win here, so I would treat the ACL/tags part as the valuable takeaway, not
the Linux-specific SSH flow.

## 14. Daily use

After a reboot, you do not need to rebuild or re-bootstrap OpenClaw.

Use:

```powershell
.\run-openclaw.cmd start
```

That helper:

- starts Docker Desktop if needed
- waits for the Docker engine to become ready
- starts or recreates the OpenClaw gateway container
- waits for `http://127.0.0.1:18789/healthz`
- shows Tailscale/OpenClaw summary status

To check whether everything is up, use:

```powershell
.\run-openclaw.cmd status
```

To stop OpenClaw cleanly, use:

```powershell
.\run-openclaw.cmd stop
```

That helper stops the main gateway and removes the disposable `openclaw-sbx-*`
sandbox worker containers. It does not delete your real state under
`%USERPROFILE%\.openclaw`.

If you also want it to close Docker Desktop afterwards, use:

```powershell
.\run-openclaw.cmd stop -StopDockerDesktop
```

The most important mental model is:

- `openclaw-openclaw-gateway-1` is your actual OpenClaw server
- `openclaw-sbx-*` containers are per-session sandbox workers

The gateway is long-lived and should come back after Docker Desktop starts.
Sandbox containers are disposable. If a sandbox container is gone, OpenClaw can
create a fresh one for the next message/session when needed.

Your persistent state is on the host under `%USERPROFILE%\.openclaw`
because Docker mounts that folder into the gateway as `/home/node/.openclaw`.
That host state includes things like:

- your main config
- auth profiles
- sessions/history/state
- workspace files
- sandbox directories under `%USERPROFILE%\.openclaw\sandboxes`

So deleting or expiring a sandbox container does not mean losing your whole
OpenClaw setup. It mostly means losing that one running execution environment,
which OpenClaw can rebuild.


