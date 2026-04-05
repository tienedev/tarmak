import fs from "node:fs";
import path from "node:path";
import { confirm, input } from "@inquirer/prompts";

interface InitOptions {
  server?: string;
  stdio?: boolean;
}

function parseFlags(args: string[]): InitOptions {
  const opts: InitOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server" && args[i + 1]) {
      opts.server = args[++i];
    }
    if (args[i] === "--stdio") {
      opts.stdio = true;
    }
  }
  return opts;
}

function mergeMcpConfig(dir: string, mcpEntry: Record<string, unknown>): void {
  const mcpPath = path.join(dir, ".mcp.json");
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(mcpPath)) {
    existing = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
  }
  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  servers.tarmak = mcpEntry;
  existing.mcpServers = servers;
  fs.writeFileSync(mcpPath, `${JSON.stringify(existing, null, 2)}\n`);
}

function mergeClaudeSettings(dir: string): void {
  const claudeDir = path.join(dir, ".claude");
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  const settingsPath = path.join(claudeDir, "settings.json");
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    existing = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  }
  const plugins = (existing.plugins ?? []) as string[];
  if (!plugins.includes("tarmak")) {
    plugins.push("tarmak");
  }
  existing.plugins = plugins;
  fs.writeFileSync(settingsPath, `${JSON.stringify(existing, null, 2)}\n`);
}

async function checkServer(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function runInit(args: string[]): Promise<void> {
  const opts = parseFlags(args);
  const cwd = process.cwd();

  console.log("\n  Tarmak Setup\n");

  let mode: "sse" | "stdio";
  let serverUrl = "";

  if (opts.server) {
    mode = "sse";
    serverUrl = opts.server;
  } else if (opts.stdio) {
    mode = "stdio";
  } else {
    const hasServer = await confirm({
      message: "Do you have a running Tarmak server?",
      default: false,
    });

    if (hasServer) {
      mode = "sse";
      serverUrl = await input({
        message: "Server URL?",
        default: "http://localhost:4000",
      });
    } else {
      mode = "stdio";
    }
  }

  // Validate server connectivity if SSE mode
  if (mode === "sse") {
    const reachable = await checkServer(serverUrl);
    if (reachable) {
      console.log(`  Server reachable at ${serverUrl}`);
    } else {
      console.log(`  Warning: server not reachable at ${serverUrl} (config written anyway)`);
    }
  }

  // Write .mcp.json
  const mcpEntry =
    mode === "sse"
      ? { type: "sse", url: `${serverUrl.replace(/\/$/, "")}/mcp/sse` }
      : { command: "npx", args: ["tarmak", "mcp"] };

  mergeMcpConfig(cwd, mcpEntry);
  console.log("  Writing .mcp.json ...       OK");

  // Write .claude/settings.json
  mergeClaudeSettings(cwd);
  console.log("  Setting up skills plugin ... OK");

  console.log("\n  Done! Claude Code can now use Tarmak tools.\n");
}
