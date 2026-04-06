#!/usr/bin/env node
// Host-side device pairing approver for the OpenClaw toolkit.
// Connects to the gateway WebSocket directly from the host (no Docker exec),
// eliminating the 48-second bind-mount I/O penalty.
//
// Usage: node approve-pairing.mjs <requestId> [--port N] [--host-config-dir <path>]
//
// Requires Node.js v22+ (native globalThis.WebSocket).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROTOCOL_VERSION = 3;
const DEFAULT_CLIENT_ID = "cli";
const DEFAULT_CLIENT_MODE = "cli";
const DEFAULT_ROLE = "operator";
const DEFAULT_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
  "operator.talk.secrets",
];

// --- Crypto helpers (ported from device-identity.ts) ---

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base64UrlEncode(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function derivePublicKeyRaw(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function publicKeyRawBase64Url(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function signPayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

// Matches normalizeDeviceMetadataForAuth in device-metadata-normalization.ts
function normalizeForAuth(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  return value.trim().replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

function buildPayloadV3({
  deviceId,
  clientId,
  clientMode,
  role,
  scopes,
  signedAtMs,
  token,
  nonce,
  platform,
  deviceFamily,
}) {
  return [
    "v3",
    deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(","),
    String(signedAtMs),
    token ?? "",
    nonce,
    normalizeForAuth(platform),
    normalizeForAuth(deviceFamily),
  ].join("|");
}

// --- Config resolution ---

let port = 18789;
let hostConfigDir = path.join(
  process.env.USERPROFILE || process.env.HOME || "~",
  ".openclaw"
);
let envFilePath = null;

const bootstrapConfigPath = path.join(__dirname, "openclaw-bootstrap.config.json");
if (fs.existsSync(bootstrapConfigPath)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(bootstrapConfigPath, "utf8"));
    if (cfg.gatewayPort) port = parseInt(String(cfg.gatewayPort), 10);
    if (cfg.hostConfigDir) {
      const val = String(cfg.hostConfigDir);
      hostConfigDir = path.isAbsolute(val) ? val : path.resolve(__dirname, val);
    }
    if (cfg.envFilePath) {
      const val = String(cfg.envFilePath);
      envFilePath = path.isAbsolute(val) ? val : path.resolve(__dirname, val);
    }
  } catch {}
}

// Parse CLI overrides
const args = process.argv.slice(2);
let requestId = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[++i], 10);
  } else if (args[i] === "--host-config-dir" && args[i + 1]) {
    hostConfigDir = args[++i];
  } else if (!args[i].startsWith("-") && !requestId) {
    requestId = args[i];
  }
}

if (!requestId) {
  process.stderr.write(
    "Usage: node approve-pairing.mjs <requestId> [--port N] [--host-config-dir <path>]\n"
  );
  process.exit(1);
}

// --- Load device identity ---

const identityPath = path.join(hostConfigDir, "identity", "device.json");
if (!fs.existsSync(identityPath)) {
  process.stderr.write(`Device identity not found: ${identityPath}\n`);
  process.exit(1);
}
let identity;
try {
  identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
} catch (e) {
  process.stderr.write(`Failed to parse device identity: ${e.message}\n`);
  process.exit(1);
}

function loadPairedDeviceMetadata() {
  const pairedPath = path.join(hostConfigDir, "devices", "paired.json");
  if (!fs.existsSync(pairedPath)) {
    return null;
  }
  try {
    const paired = JSON.parse(fs.readFileSync(pairedPath, "utf8"));
    const entry = paired?.[identity.deviceId];
    if (!entry || typeof entry !== "object") {
      return null;
    }
    return {
      clientId:
        typeof entry.clientId === "string" && entry.clientId.trim()
          ? entry.clientId
          : DEFAULT_CLIENT_ID,
      clientMode:
        typeof entry.clientMode === "string" && entry.clientMode.trim()
          ? entry.clientMode
          : DEFAULT_CLIENT_MODE,
      role:
        typeof entry.role === "string" && entry.role.trim()
          ? entry.role
          : DEFAULT_ROLE,
      scopes:
        Array.isArray(entry.approvedScopes) && entry.approvedScopes.length > 0
          ? entry.approvedScopes.filter((scope) => typeof scope === "string" && scope.trim())
          : Array.isArray(entry.scopes) && entry.scopes.length > 0
            ? entry.scopes.filter((scope) => typeof scope === "string" && scope.trim())
            : DEFAULT_SCOPES,
      platform:
        typeof entry.platform === "string" && entry.platform.trim()
          ? entry.platform
          : process.platform,
      deviceFamily:
        typeof entry.deviceFamily === "string" && entry.deviceFamily.trim()
          ? entry.deviceFamily
          : undefined,
    };
  } catch {
    return null;
  }
}

const pairedMetadata = loadPairedDeviceMetadata();
const clientId = pairedMetadata?.clientId ?? DEFAULT_CLIENT_ID;
const clientMode = pairedMetadata?.clientMode ?? DEFAULT_CLIENT_MODE;
const role = pairedMetadata?.role ?? DEFAULT_ROLE;
const scopes = pairedMetadata?.scopes ?? DEFAULT_SCOPES;
const platform = pairedMetadata?.platform ?? process.platform;
const deviceFamily = pairedMetadata?.deviceFamily;

// --- Load gateway token ---

function loadGatewayToken() {
  // Primary: openclaw.json
  const jsonPath = path.join(hostConfigDir, "openclaw.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const t = cfg?.gateway?.auth?.token;
      if (t) return String(t);
    } catch {}
  }
  // Fallback: .env file
  const envPath = envFilePath;
  if (envPath && fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^OPENCLAW_GATEWAY_TOKEN=(.+)$/);
        if (m && m[1].trim()) return m[1].trim();
      }
    } catch {}
  }
  return null;
}

const gatewayToken = loadGatewayToken();
if (!gatewayToken) {
  process.stderr.write(
    "Could not read gateway token from openclaw.json or .env\n"
  );
  process.exit(1);
}

// --- WebSocket pairing approval ---

const wsUrl = `ws://127.0.0.1:${port}`;
let reqCounter = 0;
function nextId() {
  return `toolkit-approve-${++reqCounter}`;
}

async function approveDevice() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let connectReqId = null;
    let approveReqId = null;
    let done = false;

    const failOnce = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      reject(err);
    };

    const succeedOnce = (payload) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(payload);
    };

    const timer = setTimeout(() => {
      failOnce(new Error("Timeout: no response from gateway after 15s"));
    }, 15000);

    ws.addEventListener("message", ({ data }) => {
      let frame;
      try { frame = JSON.parse(data); } catch { return; }

      // Server challenge → send connect request
      // Gateway sends type:"event" (per EventFrameSchema), not "evt"
      if ((frame.type === "event" || frame.type === "evt") && frame.event === "connect.challenge") {
        const nonce = frame.payload?.nonce ?? "";
        const signedAtMs = Date.now();
        const payload = buildPayloadV3({
          deviceId: identity.deviceId,
          clientId,
          clientMode,
          role,
          scopes,
          signedAtMs,
          token: gatewayToken,
          nonce,
          platform,
          deviceFamily,
        });
        const signature = signPayload(identity.privateKeyPem, payload);
        connectReqId = nextId();
        ws.send(JSON.stringify({
          type: "req",
          id: connectReqId,
          method: "connect",
          params: {
            minProtocol: PROTOCOL_VERSION,
            maxProtocol: PROTOCOL_VERSION,
            client: {
              id: clientId,
              version: "toolkit-host-approver",
              platform,
              deviceFamily,
              mode: clientMode,
            },
            caps: [],
            auth: { token: gatewayToken },
            role,
            scopes,
            device: {
              id: identity.deviceId,
              publicKey: publicKeyRawBase64Url(identity.publicKeyPem),
              signature,
              signedAt: signedAtMs,
              nonce,
            },
          },
        }));
        return;
      }

      if (frame.type !== "res") return;

      // connect response → send approve request
      if (frame.id === connectReqId) {
        if (!frame.ok) {
          failOnce(new Error(`connect rejected: ${JSON.stringify(frame.error)}`));
          return;
        }
        approveReqId = nextId();
        ws.send(JSON.stringify({
          type: "req",
          id: approveReqId,
          method: "device.pair.approve",
          params: { requestId },
        }));
        return;
      }

      // approve response
      if (frame.id === approveReqId) {
        if (!frame.ok) {
          failOnce(new Error(`device.pair.approve failed: ${JSON.stringify(frame.error)}`));
          return;
        }
        succeedOnce(frame.payload);
      }
    });

    ws.addEventListener("close", ({ code, reason }) => {
      if (!done) {
        failOnce(new Error(`WebSocket closed unexpectedly: ${code} ${reason}`));
      }
    });

    ws.addEventListener("error", (event) => {
      failOnce(new Error(`WebSocket error: ${event.message || String(event)}`));
    });
  });
}

try {
  const result = await approveDevice();
  process.stdout.write(`Approved ${requestId}: ${JSON.stringify(result ?? {})}\n`);
  process.exit(0);
} catch (err) {
  process.stderr.write(`Error approving ${requestId}: ${err.message}\n`);
  process.exit(1);
}
