# OpenClaw Quick Reference

Main entrypoint:

```powershell
D:\openclaw\openclaw-toolkit\run-openclaw.cmd help
```

Config note:

- Path values in `D:\openclaw\openclaw-toolkit\openclaw-bootstrap.config.json` are now
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
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd prereqs`
- First-time setup or new machine:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd bootstrap`
- On a machine that is already set up, bootstrap should be quick: it checks Docker/Ollama/Tailscale readiness first and only starts them if they are not already ready.
- Create a recovery snapshot:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd backup`
- Restore from the latest backup:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd restore -RunBootstrap`
- Update to the newest stable OpenClaw release and re-apply hardening:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd update`
- Daily startup:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd start`
- Health/status check:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd status`
- Open the authenticated dashboard:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd dashboard`
- Get the tokenized phone/Tailscale dashboard URL:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd phone-dashboard`
- Repair dashboard pairing:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd dashboard-repair`
- Complete the one-time OpenAI Codex OAuth for OpenClaw:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd openai-auth`
- Complete the one-time Gemini API-key auth for OpenClaw:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd gemini-auth`
- Complete Anthropic auth for OpenClaw:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd claude-auth`
- Full verification and smoke tests:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd verify`
- Targeted verification:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd verify -Checks voice`
- Multiple targeted verifications in one run:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd verify -Checks "local-model agent"`
- `agent` smoke covers `chat-local`, `research`, `review-local`, and `coder-local`, and now reports categorized failure reasons.
- Focused remote/local orchestration smoke:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd remote-review-smoke`
- Apply the configured starter multi-agent layout:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd agents`
- Compact Docker Desktop storage:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd compact-storage`
- Clean shutdown:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd stop`
- Latest beta release instead:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd update -Channel beta`
- Explicit ref when you really want it:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd update -Ref main`

Multi-agent note:

- Bootstrap owns the starter agents, model allowlist, and managed Telegram
  bindings from `D:\openclaw\openclaw-toolkit\openclaw-bootstrap.config.json`
- Bootstrap also owns the shared workspace path for the managed layout, so the
  agents collaborate on the same project tree
- `chat-local`, `review-local`, `coder-local`, and optional `chat-openai`
  currently default to `sandbox.mode=off` on this Windows Docker Desktop setup
  so they can use the real shared workspace
- `coder-local` is the dedicated coding delegate and now prefers hosted models
  instead of Ollama
- agent model behavior comes from each agent's own `modelSource`, and reusable
  `AGENTS.md` policy selection comes from each agent's `rolePolicyKey`
- per-agent delegation can be disabled with:
  `"subagents": { "enabled": false }`
- Active Windows workspace: `C:\Users\Deadline\.openclaw\workspace`
- Ollama model files live under `C:\Users\Deadline\.ollama\models`
- Docker Desktop VHDX compaction is separate and uses
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd compact-storage`
- Strong hosted candidate order: OpenAI Codex -> Claude Sonnet -> Gemini ->
  local fallback
- OpenClaw runtime failover first rotates auth profiles, then falls back to the
  next configured model; that is why `main` can keep working when OpenAI is in
  quota cooldown.
- Telegram target agent is configurable with
  `multiAgent.telegramRouting.targetAgentId` in
  `D:\openclaw\openclaw-toolkit\openclaw-bootstrap.config.json`
- Gemini in this setup uses the official Google API-key provider, and OpenClaw stores its own auth profiles in the gateway state

Useful extras:

- Voice smoke test:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd voice-test`
- Local model smoke test:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd local-model-test`
- Agent capability smoke test:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd agent-smoke`
- Remote coder/local reviewer orchestration smoke:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd remote-review-smoke`
- Local delegated coder diagnostic:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd local-delegate-test`
- Ollama GPU fit probe:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd model-fit -Model qwen3-coder:30b -EndpointKey local -MaxContextWindow 131072`
- Add a new local model end to end:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd add-local-model -Model qwen2.5:7b -Name "Qwen 2.5 7B" -EndpointKey review-pc`
- Named Ollama endpoints can also pre-provision models during `bootstrap` with endpoint `desiredModelIds`, for example keeping `qwen2.5:7b` installed on `review-pc`.
- Remove a local model:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd remove-local-model -Model deepseek-r1:8b -ReplaceWith qwen3-coder:30b`
- Sandbox smoke test:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd sandbox-test`
- One watchdog check:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd watchdog`
- Install recurring watchdog task:
  `D:\openclaw\openclaw-toolkit\run-openclaw.cmd install-watchdog`
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
  `D:\openclaw\openclaw-toolkit\manual-steps.md`
- Latest verification report:
  `D:\openclaw\openclaw-toolkit\bootstrap-report.txt`
- Backup archives:
  `D:\openclaw\openclaw-toolkit\backups`


