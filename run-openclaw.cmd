@echo off
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=help"
if /I "%ACTION%"=="-help" set "ACTION=help"
if /I "%ACTION%"=="--help" set "ACTION=help"
if /I "%ACTION%"=="-h" set "ACTION=help"
if /I "%ACTION%"=="-?" set "ACTION=help"
if "%ACTION%"=="/?" set "ACTION=help"
if not "%ACTION%"=="" shift

set "FIRST_FORWARD_ARG=%~1"
set "FORWARD_ARGS="
:collect_args
if "%~1"=="" goto :dispatch
set "FORWARD_ARGS=!FORWARD_ARGS! %1"
shift
goto :collect_args

:dispatch

if /I "%FIRST_FORWARD_ARG%"=="-help" set "FORWARD_ARGS=help"
if /I "%FIRST_FORWARD_ARG%"=="--help" set "FORWARD_ARGS=help"
if /I "%FIRST_FORWARD_ARG%"=="-h" set "FORWARD_ARGS=help"
if /I "%FIRST_FORWARD_ARG%"=="-?" set "FORWARD_ARGS=help"
if "%FIRST_FORWARD_ARG%"=="/?" set "FORWARD_ARGS=help"

if /I "%ACTION%"=="help" goto :help
if /I "%ACTION%"=="prereqs" goto :prereqs
if /I "%ACTION%"=="bootstrap" goto :bootstrap
if /I "%ACTION%"=="backup" goto :backup
if /I "%ACTION%"=="restore" goto :restore
if /I "%ACTION%"=="update" goto :update
if /I "%ACTION%"=="start" goto :start
if /I "%ACTION%"=="status" goto :status
if /I "%ACTION%"=="dashboard" goto :dashboard
if /I "%ACTION%"=="phone-dashboard" goto :phone_dashboard
if /I "%ACTION%"=="toolkit-dashboard" goto :toolkit_dashboard
if /I "%ACTION%"=="dashboard-repair" goto :dashboard_repair
if /I "%ACTION%"=="openai-auth" goto :openai_auth
if /I "%ACTION%"=="gemini-auth" goto :gemini_auth
if /I "%ACTION%"=="claude-auth" goto :claude_auth
if /I "%ACTION%"=="verify" goto :verify
if /I "%ACTION%"=="agents" goto :agents
if /I "%ACTION%"=="watchdog" goto :watchdog
if /I "%ACTION%"=="install-watchdog" goto :install_watchdog
if /I "%ACTION%"=="compact-storage" goto :compact_storage
if /I "%ACTION%"=="voice-test" goto :voice_test
if /I "%ACTION%"=="local-model-test" goto :local_model_test
if /I "%ACTION%"=="agent-smoke" goto :agent_smoke
if /I "%ACTION%"=="remote-review-smoke" goto :remote_review_smoke
if /I "%ACTION%"=="local-delegate-test" goto :local_delegate_test
if /I "%ACTION%"=="temp-agent-probe" goto :temp_agent_probe
if /I "%ACTION%"=="model-fit" goto :model_fit
if /I "%ACTION%"=="add-local-model" goto :add_local_model
if /I "%ACTION%"=="remove-local-model" goto :remove_local_model
if /I "%ACTION%"=="sandbox-test" goto :sandbox_test
if /I "%ACTION%"=="telegram-ids" goto :telegram_ids
if /I "%ACTION%"=="stop" goto :stop

echo Unknown action: %ACTION%
echo.
goto :help

:prereqs
call "%SCRIPT_DIR%run-prereqs.cmd" %FORWARD_ARGS%
goto :eof

:bootstrap
call "%SCRIPT_DIR%run-bootstrap.cmd" %FORWARD_ARGS%
goto :eof

:backup
call "%SCRIPT_DIR%run-backup.cmd" %FORWARD_ARGS%
goto :eof

:restore
call "%SCRIPT_DIR%run-restore.cmd" %FORWARD_ARGS%
goto :eof

:update
call "%SCRIPT_DIR%run-update.cmd" %FORWARD_ARGS%
goto :eof

:start
call "%SCRIPT_DIR%run-start.cmd" %FORWARD_ARGS%
goto :eof

:status
call "%SCRIPT_DIR%run-status.cmd" %FORWARD_ARGS%
goto :eof

:dashboard
call "%SCRIPT_DIR%run-dashboard.cmd" %FORWARD_ARGS%
goto :eof

:phone_dashboard
call "%SCRIPT_DIR%run-phone-dashboard.cmd" %FORWARD_ARGS%
goto :eof

:toolkit_dashboard
call "%SCRIPT_DIR%run-toolkit-dashboard.cmd" %FORWARD_ARGS%
goto :eof

:dashboard_repair
call "%SCRIPT_DIR%run-dashboard-repair.cmd" %FORWARD_ARGS%
goto :eof

:openai_auth
call "%SCRIPT_DIR%run-openai-auth.cmd" %FORWARD_ARGS%
goto :eof

:gemini_auth
call "%SCRIPT_DIR%run-gemini-auth.cmd" %FORWARD_ARGS%
goto :eof

:claude_auth
call "%SCRIPT_DIR%run-claude-auth.cmd" %FORWARD_ARGS%
goto :eof

:verify
call "%SCRIPT_DIR%run-verify.cmd" %FORWARD_ARGS%
goto :eof

:agents
call "%SCRIPT_DIR%run-configure-agents.cmd" %FORWARD_ARGS%
goto :eof

:watchdog
call "%SCRIPT_DIR%run-watchdog.cmd" %FORWARD_ARGS%
goto :eof

:install_watchdog
call "%SCRIPT_DIR%run-install-watchdog.cmd" %FORWARD_ARGS%
goto :eof

:compact_storage
call "%SCRIPT_DIR%run-compact-storage.cmd" %FORWARD_ARGS%
goto :eof

:voice_test
call "%SCRIPT_DIR%run-voice-test.cmd" %FORWARD_ARGS%
goto :eof

:local_model_test
call "%SCRIPT_DIR%run-local-model-test.cmd" %FORWARD_ARGS%
goto :eof

:agent_smoke
call "%SCRIPT_DIR%run-agent-smoke.cmd" %FORWARD_ARGS%
goto :eof

:remote_review_smoke
call "%SCRIPT_DIR%run-remote-review-smoke.cmd" %FORWARD_ARGS%
goto :eof

:local_delegate_test
call "%SCRIPT_DIR%run-local-delegated-coder-test.cmd" %FORWARD_ARGS%
goto :eof

:temp_agent_probe
call "%SCRIPT_DIR%run-temp-agent-probe.cmd" %FORWARD_ARGS%
goto :eof

:model_fit
call "%SCRIPT_DIR%run-model-fit.cmd" %FORWARD_ARGS%
goto :eof

:add_local_model
call "%SCRIPT_DIR%run-add-local-model.cmd" %FORWARD_ARGS%
goto :eof

:remove_local_model
call "%SCRIPT_DIR%run-remove-local-model.cmd" %FORWARD_ARGS%
goto :eof

:sandbox_test
call "%SCRIPT_DIR%run-sandbox-test.cmd" %FORWARD_ARGS%
goto :eof

:telegram_ids
call "%SCRIPT_DIR%run-telegram-ids.cmd" %FORWARD_ARGS%
goto :eof

:stop
call "%SCRIPT_DIR%run-stop.cmd" %FORWARD_ARGS%
goto :eof

:help
echo OpenClaw operator commands
echo.
echo   run-openclaw.cmd prereqs
echo     Audit Windows prerequisites, auto-install what can be installed, and report the remaining blockers.
echo.
echo   run-openclaw.cmd bootstrap
echo     First-time bootstrap or re-apply secure setup.
echo.
echo   run-openclaw.cmd backup
echo     Create a migration/recovery snapshot of host state and setup files.
echo.
echo   run-openclaw.cmd restore
echo     Restore host state and repo-local files from a backup snapshot.
echo.
echo   run-openclaw.cmd update
echo     Update to the newest stable OpenClaw release tag, then re-apply secure setup and verify it. Use -Channel beta or -Ref main/tag/commit for an override.
echo.
echo   run-openclaw.cmd start
echo     Start Docker/Ollama/OpenClaw and open the localhost dashboard with pairing auto-repair.
echo.
echo   run-openclaw.cmd status
echo     Show Docker, gateway, and Tailscale status.
echo.
echo   run-openclaw.cmd dashboard
echo     Open the localhost tokenized dashboard.
echo.
echo   run-openclaw.cmd phone-dashboard
echo     Print and copy the tokenized Tailscale dashboard URL for phone access.
echo.
echo   run-openclaw.cmd toolkit-dashboard
echo     Start the live toolkit configuration dashboard.
echo.
echo   run-openclaw.cmd dashboard-repair
echo     Approve pending dashboard pairing requests, then reopen the dashboard.
echo.
echo   run-openclaw.cmd openai-auth
echo     Run the one-time OpenAI Codex OAuth flow for OpenClaw, then re-apply bootstrap.
echo.
echo   run-openclaw.cmd gemini-auth
echo     Run the one-time Gemini API-key auth flow for OpenClaw, then re-apply bootstrap.
echo.
echo   run-openclaw.cmd claude-auth
echo     Run Anthropic auth for OpenClaw. Default is API-key auth; use -Method paste-token or -Method cli only if you intentionally want those flows.
echo.
echo   run-openclaw.cmd verify
echo     Refresh the verification report. Use -Checks to target specific verification areas.
echo.
echo   run-openclaw.cmd agents
echo     Apply the starter multi-agent layout from the bootstrap config.
echo.
echo   run-openclaw.cmd watchdog
echo     Run one watchdog health check and optional self-heal.
echo.
echo   run-openclaw.cmd install-watchdog
echo     Install a Windows Scheduled Task for the watchdog.
echo.
echo   run-openclaw.cmd compact-storage
echo     Compact Docker Desktop's WSL data VHDX and restart OpenClaw afterward.
echo.
echo   run-openclaw.cmd voice-test
echo     Smoke-test local voice-note transcription.
echo.
echo   run-openclaw.cmd local-model-test
echo     Smoke-test OpenClaw through the configured Ollama local model path.
echo.
echo   run-openclaw.cmd agent-smoke
echo     Smoke-test the shared-workspace agent roles, especially the Telegram-routed agent's file and git workflows.
echo.
echo   run-openclaw.cmd remote-review-smoke
echo     Smoke-test main spawning coder-remote for a code task and review-local for a path-aware review pass.
echo.
echo   run-openclaw.cmd local-delegate-test
echo     Diagnose the exact main -^> coder-local spawned local-model path and detect raw fake tool-call output.
echo.
echo   run-openclaw.cmd temp-agent-probe
echo     Create a temporary agent through the live gateway API, materialize one session, and report which files appeared under C:\Users\Deadline\.openclaw.
echo.
echo   run-openclaw.cmd model-fit
echo     Probe an Ollama model on a named endpoint, starting at 4k context and increasing until the VRAM headroom rule is hit.
echo.
echo   run-openclaw.cmd add-local-model
echo     Preflight raw size and disk space, pull a local Ollama model on a named endpoint, auto-tune context, optionally set -FallbackModel, and optionally assign it to an agent.
echo.
echo   run-openclaw.cmd remove-local-model
echo     Remove a managed local Ollama model from bootstrap config and retarget any managed local-agent references.
echo.
echo   run-openclaw.cmd sandbox-test
echo     Smoke-test one harmless sandboxed exec action.
echo.
echo   run-openclaw.cmd telegram-ids
echo     Inspect Telegram IDs from OpenClaw logs.
echo.
echo   run-openclaw.cmd stop
echo     Stop the gateway and remove sandbox worker containers.
echo.
echo Examples:
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd start
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd agents
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd verify -Checks voice
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd verify -Checks "local-model agent"
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd compact-storage
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd update -Channel beta
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd update -Ref main
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd model-fit -Model qwen3-coder:30b -EndpointKey local -MaxContextWindow 131072
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd agent-smoke
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd remote-review-smoke
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd local-delegate-test
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd temp-agent-probe
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd add-local-model -Model qwen2.5-coder:32b -Name "Qwen2.5 Coder 32B" -EndpointKey local -AssignTo coder-local
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd add-local-model -Model qwen3-coder:30b -Name "Qwen3 Coder 30B" -EndpointKey local -FallbackModel qwen2.5-coder:3b
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd remove-local-model -Model deepseek-r1:8b -ReplaceWith qwen3-coder:30b -CompactDockerData
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd stop -StopDockerDesktop
echo   D:\openclaw\openclaw-toolkit\run-openclaw.cmd dashboard-repair
exit /b 0


