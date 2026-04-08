# OpenClaw Quick Reference

Main entrypoint:

```powershell
run-openclaw.cmd help
```

Config note:

- Path values in `<toolkit-dir>\openclaw-bootstrap.config.json` are now
  portable. Relative paths are resolved from the config file's own folder.
- The same config also owns managed compaction and context-pruning settings
  for OpenClaw sessions.
- The same config also owns the managed global tool-policy baseline.
- Current managed defaults: `safeguard` compaction with
  `reserveTokensFloor=4000` + `cache-ttl` pruning.
- Current managed tool baseline: `minimal` profile + explicit allow/deny lists,
  with extra web tools only on the `research` agent.
- Toolkit-managed upstream source patches are reapplied during `bootstrap` and
  `update`, so the OpenClaw repo can stay upstream-clean between releases.

Most important commands:

- Audit/install Windows prerequisites before bootstrap:
  `run-openclaw.cmd prereqs`
- First-time setup or new machine:
  `run-openclaw.cmd bootstrap`
- On a machine that is already set up, bootstrap should be quick: it checks Docker/Ollama/Tailscale readiness first and only starts them if they are not already ready.
- Create a recovery snapshot:
  `run-openclaw.cmd backup`
- Restore from the latest backup:
  `run-openclaw.cmd restore -RunBootstrap`
- Update to the newest stable OpenClaw release and re-apply hardening:
  `run-openclaw.cmd update`
- Daily startup:
  `run-openclaw.cmd start`
- Launch interactive in-container onboarding after services are up:
  `run-openclaw.cmd onboard`
- Health/status check:
  `run-openclaw.cmd status`
- Open the authenticated dashboard:
  `run-openclaw.cmd dashboard`
- Get the tokenized phone/Tailscale dashboard URL:
  `run-openclaw.cmd phone-dashboard`
- Repair dashboard pairing:
  `run-openclaw.cmd dashboard-repair`
- Complete the one-time OpenAI Codex OAuth for OpenClaw:
  `run-openclaw.cmd openai-auth`
- Sign in to Ollama for cloud models and Ollama Web Search:
  `run-openclaw.cmd ollama-auth`
- Complete the one-time Gemini API-key auth for OpenClaw:
  `run-openclaw.cmd gemini-auth`
- Complete Anthropic auth for OpenClaw:
  `run-openclaw.cmd claude-auth`
- Complete GitHub Copilot auth for OpenClaw:
  `run-openclaw.cmd copilot-auth`
- Full verification and smoke tests:
  `run-openclaw.cmd verify`
- Targeted verification:
  `run-openclaw.cmd verify -Checks voice`
- Multiple targeted verifications in one run:
  `run-openclaw.cmd verify -Checks "local-model agent"`
- `agent` smoke covers `chat-local`, `research`, `review-local`, and `coder-local`, and now reports categorized failure reasons.
- Focused remote/local orchestration smoke:
  `run-openclaw.cmd remote-review-smoke`
- Apply the configured starter multi-agent layout:
  `run-openclaw.cmd agents`
- Inspect where a newly created API agent stores its state:
  `run-openclaw.cmd temp-agent-probe`
- Compact Docker Desktop storage:
  `run-openclaw.cmd compact-storage`
- Clean shutdown:
  `run-openclaw.cmd stop`
- Latest beta release instead:
  `run-openclaw.cmd update -Channel beta`
- Explicit ref when you really want it:
  `run-openclaw.cmd update -Ref main`

Multi-agent note:

- Bootstrap owns the starter agents, model allowlist, and managed Telegram
  bindings from `<toolkit-dir>\openclaw-bootstrap.config.json`
- Bootstrap also owns the shared workspace path for the managed layout, so the
  agents collaborate on the same project tree
- `chat-local`, `review-local`, `coder-local`, and optional `chat-openai`
  currently default to `sandbox.mode=off` on this Windows Docker Desktop setup
  so they can use the real shared workspace
- `coder-local` is the dedicated coding delegate and now prefers hosted models
  instead of Ollama
- agent model behavior comes from each agent's `modelRef` and
  `candidateModelRefs`, while reusable `AGENTS.md` selection comes from each
  agent's `markdownTemplateKeys.AGENTS.md`
- per-agent delegation can be disabled with:
  `"subagents": { "enabled": false }`
- Active Windows workspace: `%USERPROFILE%\.openclaw\workspace`
- Ollama model files live under `%USERPROFILE%\.ollama\models`
- Docker Desktop VHDX compaction is separate and uses
  `run-openclaw.cmd compact-storage`
- Strong hosted candidate order: OpenAI Codex -> Claude Sonnet -> Gemini ->
  local fallback
- OpenClaw runtime failover first rotates auth profiles, then falls back to the
  next configured model; that is why `main` can keep working when OpenAI is in
  quota cooldown.
- Telegram target agent is configurable with
  `agents.telegramRouting.targetAgentId` in
  `<toolkit-dir>\openclaw-bootstrap.config.json`
- Gemini in this setup uses the official Google API-key provider, and OpenClaw stores its own auth profiles in the gateway state

Useful extras:

- Voice smoke test:
  `run-openclaw.cmd voice-test`
- Local model smoke test:
  `run-openclaw.cmd local-model-test`
- Agent capability smoke test:
  `run-openclaw.cmd agent-smoke`
- Remote coder/local reviewer orchestration smoke:
  `run-openclaw.cmd remote-review-smoke`
- Local delegated coder diagnostic:
  `run-openclaw.cmd local-delegate-test`
- Temporary API-created agent storage probe:
  `run-openclaw.cmd temp-agent-probe`
- Ollama GPU fit probe:
  `run-openclaw.cmd model-fit -Model qwen3-coder:30b -EndpointKey local -MaxContextWindow 131072`
- Add a new local model end to end:
  `run-openclaw.cmd add-local-model -Model qwen2.5:7b -EndpointKey review-pc`
- Add a new local model with a configured fallback model ID:
  `run-openclaw.cmd add-local-model -Model qwen3-coder:30b -EndpointKey local -FallbackModel qwen2.5-coder:3b`
- Endpoints can also pre-provision local models during `bootstrap` by listing them under endpoint `ollama.models`; bootstrap will pull what fits and warn on oversized models.
- Remove a local model:
  `run-openclaw.cmd remove-local-model -Model deepseek-r1:8b -ReplaceWith qwen3-coder:30b`
- Sandbox smoke test:
  `run-openclaw.cmd sandbox-test`
- One watchdog check:
  `run-openclaw.cmd watchdog`
- Install recurring watchdog task:
  `run-openclaw.cmd install-watchdog`
- The watchdog runs on the Windows host, not inside the gateway, so it can still catch Docker/gateway outages.
- Telegram exec approvals are configured to arrive in your Telegram DM by
  default, so host-exec approval prompts do not require the dashboard in normal
  use

Re-auth notes:

- Dashboard token: usually one-time per browser/profile/origin
- Device pairing: usually one-time per browser/device
- You may need both again if you clear browser/site data or switch browsers
- Firefox clear-on-close can force repeated PC dashboard re-pairing
- Provider OAuth usually refreshes automatically until the provider login expires

Files worth knowing:

- Full manual:
  `<toolkit-dir>\manual-steps.md`
- Source-backed multi-agent notes:
  `<toolkit-dir>\multi-agent-openclaw-notes.md`
- Latest verification report:
  `<toolkit-dir>\bootstrap-report.txt`
- Backup archives:
  `<toolkit-dir>\backups`


