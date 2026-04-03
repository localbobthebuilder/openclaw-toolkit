import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_BOOTSTRAP_FILES = [
  "AGENTS.md",
  "TOOLS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
] as const;

function isAgentBootstrapEvent(
  event: any,
): event is {
  type: string;
  action: string;
  context: {
    agentId?: string;
    bootstrapFiles?: Array<{
      name: string;
      path: string;
      content?: string;
      missing: boolean;
    }>;
    cfg?: Record<string, any>;
  };
} {
  return (
    event &&
    event.type === "agent" &&
    event.action === "bootstrap" &&
    event.context &&
    Array.isArray(event.context.bootstrapFiles)
  );
}

function resolveHookConfig(contextCfg: Record<string, any> | undefined): Record<string, any> {
  const entries = contextCfg?.hooks?.internal?.entries;
  const entry = entries?.["agent-bootstrap-overlays"];
  return entry && typeof entry === "object" ? entry : {};
}

function resolveOpenClawConfigDir(): string {
  const hookDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(hookDir, "..", "..");
}

function loadOverlayFiles(agentId: string, overlayDirName: string) {
  const configDir = resolveOpenClawConfigDir();
  const overlayDir = path.join(configDir, "agents", agentId, overlayDirName);
  if (!fs.existsSync(overlayDir)) {
    return [];
  }

  const loaded = [];
  for (const fileName of VALID_BOOTSTRAP_FILES) {
    const filePath = path.join(overlayDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    loaded.push({
      name: fileName,
      path: filePath,
      content: fs.readFileSync(filePath, "utf-8"),
      missing: false,
    });
  }

  return loaded;
}

const handler = async (event: any) => {
  if (!isAgentBootstrapEvent(event)) {
    return;
  }

  const agentId = typeof event.context.agentId === "string" ? event.context.agentId.trim() : "";
  if (!agentId) {
    return;
  }

  const hookConfig = resolveHookConfig(event.context.cfg);
  const overlayDirName =
    typeof hookConfig.overlayDirName === "string" && hookConfig.overlayDirName.trim().length > 0
      ? hookConfig.overlayDirName.trim()
      : "bootstrap";

  const overlayFiles = loadOverlayFiles(agentId, overlayDirName);
  if (overlayFiles.length === 0) {
    return;
  }

  event.context.bootstrapFiles = [...event.context.bootstrapFiles, ...overlayFiles];
};

export default handler;
