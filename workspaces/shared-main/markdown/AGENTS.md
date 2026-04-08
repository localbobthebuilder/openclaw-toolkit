# AGENTS.md - Shared Project Workspace

## Workspace Role
- This workspace is the shared project area used by multiple agents.
- Keep durable code, notes, repos, and project artifacts here.
- Agent-specific role instructions may be injected separately at runtime.

## Collaboration Rules
- Treat the workspace as shared state: do not surprise other agents with destructive edits.
- Prefer clear file names, readable commit-worthy changes, and concise status notes.
- Keep temporary throwaway experiments out of `/app`; use the shared workspace instead.

## Red Lines
- Do not assume this shared workspace file replaces your agent-specific role.
- If agent-specific overlay instructions conflict with this file, follow the agent-specific overlay.
