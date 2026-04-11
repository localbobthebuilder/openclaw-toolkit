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
if /I "%ACTION%"=="onboard" goto :onboard
if /I "%ACTION%"=="status" goto :status
if /I "%ACTION%"=="dashboard" goto :dashboard
if /I "%ACTION%"=="phone-dashboard" goto :phone_dashboard
if /I "%ACTION%"=="toolkit-dashboard" goto :toolkit_dashboard
if /I "%ACTION%"=="toolkit-dashboard-stop" goto :toolkit_dashboard_stop
if /I "%ACTION%"=="toolkit-dashboard-rebuild" goto :toolkit_dashboard_rebuild
if /I "%ACTION%"=="dashboard-repair" goto :dashboard_repair
if /I "%ACTION%"=="openai-auth" goto :openai_auth
if /I "%ACTION%"=="ollama-auth" goto :ollama_auth
if /I "%ACTION%"=="gemini-auth" goto :gemini_auth
if /I "%ACTION%"=="claude-auth" goto :claude_auth
if /I "%ACTION%"=="copilot-auth" goto :copilot_auth
if /I "%ACTION%"=="verify" goto :verify
if /I "%ACTION%"=="agents" goto :agents
if /I "%ACTION%"=="reset-config" goto :reset_config
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
if /I "%ACTION%"=="cli" goto :cli
if /I "%ACTION%"=="add-local-model" goto :add_local_model
if /I "%ACTION%"=="remove-local-model" goto :remove_local_model
if /I "%ACTION%"=="sandbox-test" goto :sandbox_test
if /I "%ACTION%"=="telegram-setup" goto :telegram_setup
if /I "%ACTION%"=="telegram-ids" goto :telegram_ids
if /I "%ACTION%"=="stop" goto :stop

echo Unknown action: %ACTION%
echo.
set "HELP_EXIT_CODE=1"
goto :help

:prereqs
call "%SCRIPT_DIR%run-prereqs.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:bootstrap
call "%SCRIPT_DIR%run-bootstrap.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:backup
call "%SCRIPT_DIR%run-backup.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:restore
call "%SCRIPT_DIR%run-restore.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:update
call "%SCRIPT_DIR%run-update.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:start
call "%SCRIPT_DIR%run-start.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:onboard
call "%SCRIPT_DIR%run-openclaw-onboard.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:status
call "%SCRIPT_DIR%run-status.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:dashboard
call "%SCRIPT_DIR%run-dashboard.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:phone_dashboard
call "%SCRIPT_DIR%run-phone-dashboard.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:toolkit_dashboard
call "%SCRIPT_DIR%run-toolkit-dashboard.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:toolkit_dashboard_stop
call "%SCRIPT_DIR%run-toolkit-dashboard.cmd" stop
exit /b %ERRORLEVEL%

:toolkit_dashboard_rebuild
call "%SCRIPT_DIR%rebuild-toolkit-dashboard.cmd"
exit /b %ERRORLEVEL%

:dashboard_repair
call "%SCRIPT_DIR%run-dashboard-repair.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:openai_auth
call "%SCRIPT_DIR%run-openai-auth.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:ollama_auth
call "%SCRIPT_DIR%run-ollama-auth.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:gemini_auth
call "%SCRIPT_DIR%run-gemini-auth.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:claude_auth
call "%SCRIPT_DIR%run-claude-auth.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:copilot_auth
call "%SCRIPT_DIR%run-copilot-auth.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:verify
call "%SCRIPT_DIR%run-verify.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:agents
call "%SCRIPT_DIR%run-configure-agents.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:reset_config
call "%SCRIPT_DIR%run-reset-config.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:watchdog
call "%SCRIPT_DIR%run-watchdog.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:install_watchdog
call "%SCRIPT_DIR%run-install-watchdog.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:compact_storage
call "%SCRIPT_DIR%run-compact-storage.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:voice_test
call "%SCRIPT_DIR%run-voice-test.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:local_model_test
call "%SCRIPT_DIR%run-local-model-test.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:agent_smoke
call "%SCRIPT_DIR%run-agent-smoke.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:remote_review_smoke
call "%SCRIPT_DIR%run-remote-review-smoke.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:local_delegate_test
call "%SCRIPT_DIR%run-local-delegated-coder-test.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:temp_agent_probe
call "%SCRIPT_DIR%run-temp-agent-probe.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:model_fit
call "%SCRIPT_DIR%run-model-fit.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:cli
call "%SCRIPT_DIR%run-openclaw-cli.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:add_local_model
call "%SCRIPT_DIR%run-add-local-model.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:remove_local_model
call "%SCRIPT_DIR%run-remove-local-model.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:sandbox_test
call "%SCRIPT_DIR%run-sandbox-test.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:telegram_setup
call "%SCRIPT_DIR%run-telegram-setup.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:telegram_ids
call "%SCRIPT_DIR%run-telegram-ids.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:stop
call "%SCRIPT_DIR%run-stop.cmd" %FORWARD_ARGS%
exit /b %ERRORLEVEL%

:help
if not defined HELP_EXIT_CODE set "HELP_EXIT_CODE=0"
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
echo   run-openclaw.cmd onboard
echo     Launch interactive OpenClaw onboarding inside the gateway container in a new PowerShell window when needed.
echo.
echo   run-openclaw.cmd telegram-setup
echo     Launch the interactive Telegram channel setup wizard inside the gateway container in a new PowerShell window.
echo.
echo   run-openclaw.cmd status
echo     Show Docker, gateway, and Tailscale status.
echo.
echo   run-openclaw.cmd cli --version
echo   run-openclaw.cmd cli doctor
echo   run-openclaw.cmd cli gateway status
echo     Run the official OpenClaw CLI inside the gateway container and stream the result.
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
echo   run-openclaw.cmd toolkit-dashboard-rebuild
echo     Rebuild the toolkit dashboard UI and restart the backend server.
echo.
echo   run-openclaw.cmd toolkit-dashboard-stop
echo     Stop the live toolkit configuration dashboard.
echo.
echo   run-openclaw.cmd dashboard-repair
echo     Approve pending dashboard pairing requests, then reopen the dashboard.
echo.
echo   run-openclaw.cmd openai-auth
echo     Run the one-time OpenAI Codex OAuth flow for OpenClaw, then re-apply bootstrap.
echo.
echo   run-openclaw.cmd ollama-auth
echo     Run host-side Ollama sign-in for cloud Ollama models and Ollama Web Search.
echo.
echo   run-openclaw.cmd gemini-auth
echo     Run the one-time Gemini API-key auth flow for OpenClaw, then re-apply bootstrap.
echo.
echo   run-openclaw.cmd claude-auth
echo     Run Anthropic auth for OpenClaw. Default is API-key auth; use -Method paste-token or -Method cli only if you intentionally want those flows.
echo.
echo   run-openclaw.cmd copilot-auth
echo     Run OpenClaw's built-in GitHub Copilot device-login flow inside the gateway container.
echo.
echo   run-openclaw.cmd verify
echo     Refresh the verification report. Use -Checks to target specific verification areas.
echo.
echo   run-openclaw.cmd agents
echo     Apply the starter multi-agent layout from the bootstrap config.
echo.
echo   run-openclaw.cmd reset-config
echo     Reset the managed bootstrap config to the checked-in starter defaults and save the previous file as openclaw-bootstrap.config.json.bak.
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
echo     Smoke-test the shared-workspace agent roles, especially coder-local's file and git workflows.
echo.
echo   run-openclaw.cmd remote-review-smoke
echo     Smoke-test main spawning coder-remote for a code task and review-local for a path-aware review pass.
echo.
echo   run-openclaw.cmd local-delegate-test
echo     Diagnose the exact main -^> coder-local spawned local-model path and detect raw fake tool-call output.
echo.
echo   run-openclaw.cmd temp-agent-probe
echo     Create a temporary agent through the live gateway API, materialize one session, and report which files appeared under %%USERPROFILE%%\.openclaw.
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
echo   %~f0 start
echo   %~f0 agents
echo   %~f0 verify -Checks voice
echo   %~f0 verify -Checks "local-model agent"
echo   %~f0 compact-storage
echo   %~f0 update -Channel beta
echo   %~f0 update -Ref main
echo   %~f0 model-fit -Model qwen3-coder:30b -EndpointKey local -MaxContextWindow 131072
echo   %~f0 agent-smoke
echo   %~f0 remote-review-smoke
echo   %~f0 local-delegate-test
echo   %~f0 temp-agent-probe
echo   %~f0 add-local-model -Model qwen2.5-coder:32b -Name "Qwen2.5 Coder 32B" -EndpointKey local -AssignTo coder-local
echo   %~f0 add-local-model -Model qwen3-coder:30b -Name "Qwen3 Coder 30B" -EndpointKey local -FallbackModel qwen2.5-coder:3b
echo   %~f0 remove-local-model -Model deepseek-r1:8b -ReplaceWith qwen3-coder:30b -CompactDockerData
echo   %~f0 stop -StopDockerDesktop
echo   %~f0 dashboard-repair
exit /b %HELP_EXIT_CODE%


