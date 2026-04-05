// agent/src/config.ts
import fs from "fs/promises";
import path from "path";
import os from "os";

export interface McpServer {
  name: string;
  scope: "global" | "user" | "project" | "local";
  command: string | null;
  args: string[] | null;
}

export interface SkillInfo {
  name: string;
  description: string;
  dir: string;
  plugin: string;
  enabled: boolean;
}

export interface ProjectConfig {
  repo_url: string;
  workdir: string;
  claude_md: string | null;
  settings: Record<string, unknown> | null;
  mcp_servers: McpServer[];
  skills: SkillInfo[];
}

export interface AgentConfig {
  global: {
    settings: Record<string, unknown> | null;
    mcp_servers: Record<string, unknown> | null;
  };
  plugins: Record<string, unknown[]> | null;
  skills: SkillInfo[];
  hooks: Record<string, unknown[]> | null;
  projects: ProjectConfig[];
  stats: {
    totalSessions: number | null;
    totalMessages: number | null;
    modelUsage: Record<string, unknown> | null;
  } | null;
}

export async function getConfig(
  workdirs: Map<string, string>
): Promise<AgentConfig> {
  const claudeDir = path.join(os.homedir(), ".claude");

  // Global settings
  const globalSettings = await readJsonSafe(
    path.join(claudeDir, "settings.json")
  );

  // Global MCP servers
  const globalMcp =
    (globalSettings?.mcpServers as Record<string, unknown>) ?? null;

  // Installed plugins
  const plugins = (await readJsonSafe(
    path.join(claudeDir, "installed_plugins.json")
  )) as Record<string, unknown[]> | null;

  // Skills from plugins
  const skills = await discoverSkills(claudeDir);

  // Per-project configs
  const projects: ProjectConfig[] = [];
  for (const [repoUrl, workdir] of workdirs) {
    const projectClaudeMd = await readFileSafe(
      path.join(workdir, "CLAUDE.md")
    );
    const projectSettings = await readJsonSafe(
      path.join(workdir, ".claude", "settings.json")
    );
    const projectMcp = await discoverMcpServers(workdir);
    const projectSkills = await discoverProjectSkills(workdir, claudeDir);

    projects.push({
      repo_url: repoUrl,
      workdir,
      claude_md: projectClaudeMd,
      settings: projectSettings,
      mcp_servers: projectMcp,
      skills: projectSkills,
    });
  }

  return {
    global: { settings: globalSettings, mcp_servers: globalMcp },
    plugins,
    skills,
    hooks: (globalSettings?.hooks as Record<string, unknown[]>) ?? null,
    projects,
    stats: null,
  };
}

async function discoverSkills(claudeDir: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  const pluginsFile = path.join(claudeDir, "installed_plugins.json");
  try {
    const raw = await fs.readFile(pluginsFile, "utf-8");
    const installed = JSON.parse(raw) as Record<string, unknown[]>;
    const cacheDir = path.join(claudeDir, "plugins", "cache");

    for (const [pluginName, _] of Object.entries(installed)) {
      const skillsDir = path.join(cacheDir, pluginName, "skills");
      try {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
          try {
            const content = await fs.readFile(skillMd, "utf-8");
            const nameLine = content.match(/^name:\s*(.+)$/m);
            const descLine = content.match(/^description:\s*(.+)$/m);
            skills.push({
              name: nameLine?.[1]?.trim() ?? entry.name,
              description: descLine?.[1]?.trim() ?? "",
              dir: path.join(skillsDir, entry.name),
              plugin: pluginName,
              enabled: true,
            });
          } catch {
            // no SKILL.md
          }
        }
      } catch {
        // no skills dir
      }
    }
  } catch {
    // no plugins file
  }
  return skills;
}

async function discoverMcpServers(workdir: string): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  const settingsPath = path.join(workdir, ".claude", "settings.json");
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    const mcp = settings?.mcpServers as Record<string, { command?: string; args?: string[] }> | undefined;
    if (mcp) {
      for (const [name, cfg] of Object.entries(mcp)) {
        servers.push({
          name,
          scope: "project",
          command: cfg.command ?? null,
          args: cfg.args ?? null,
        });
      }
    }
  } catch {
    // no settings
  }
  return servers;
}

async function discoverProjectSkills(
  _workdir: string,
  _claudeDir: string
): Promise<SkillInfo[]> {
  // Project-scoped skills discovery — simplified for now
  return [];
}

async function readJsonSafe(
  filepath: string
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filepath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readFileSafe(filepath: string): Promise<string | null> {
  try {
    return await fs.readFile(filepath, "utf-8");
  } catch {
    return null;
  }
}
