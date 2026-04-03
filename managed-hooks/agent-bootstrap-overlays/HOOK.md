---
name: agent-bootstrap-overlays
description: "Inject per-agent bootstrap overlays from each agent directory"
metadata: { "openclaw": { "emoji": "🧩", "events": ["agent:bootstrap"], "always": true } }
---

# Agent Bootstrap Overlays

Appends agent-specific bootstrap files from `~/.openclaw/agents/<agentId>/bootstrap/`
during `agent:bootstrap`.

This lets agents share one project workspace while still receiving different role
instructions at runtime.
