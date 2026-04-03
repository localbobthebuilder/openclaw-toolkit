# OpenClaw Toolkit

Portable PowerShell toolkit for setting up, hardening, operating, verifying, backing up, and updating a Docker-based OpenClaw installation on Windows.

## What This Repo Contains

- Bootstrap and prerequisite automation
- Dashboard, start, stop, status, and repair helpers
- Provider auth helpers for OpenAI, Gemini, and Anthropic
- Local model management and GPU-fit probing
- Verification and smoke tests
- Backup, restore, update, and watchdog helpers
- Operator documentation and quick reference

## Main Entry Point

Use the wrapper command:

```powershell
D:\openclaw\openclaw-toolkit\run-openclaw.cmd help
```

Common commands:

```powershell
D:\openclaw\openclaw-toolkit\run-openclaw.cmd prereqs
D:\openclaw\openclaw-toolkit\run-openclaw.cmd bootstrap
D:\openclaw\openclaw-toolkit\run-openclaw.cmd start
D:\openclaw\openclaw-toolkit\run-openclaw.cmd status
D:\openclaw\openclaw-toolkit\run-openclaw.cmd dashboard
D:\openclaw\openclaw-toolkit\run-openclaw.cmd verify
D:\openclaw\openclaw-toolkit\run-openclaw.cmd update
```

## Important Notes

- Generated state is intentionally not tracked.
- `backups/` and `bootstrap-report.txt` are git-ignored.
- The toolkit expects the OpenClaw checkout to live next to this folder by default.

## Documentation

- [manual-steps.md](/D:/openclaw/openclaw-toolkit/manual-steps.md)
- [quick-reference.md](/D:/openclaw/openclaw-toolkit/quick-reference.md)
