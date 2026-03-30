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

export interface AgentInfo {
  name: string;
  description: string;
  file: string;
  plugin: string;
}

export interface ProjectConfig {
  repo_url: string;
  workdir: string;
  claude_md: string | null;
  settings: Record<string, unknown> | null;
  mcp_servers: McpServer[];
  skills: SkillInfo[];
  agents: AgentInfo[];
}

export interface AgentConfig {
  global: {
    settings: Record<string, unknown> | null;
    mcp_servers: Record<string, unknown> | null;
  };
  plugins: Record<string, unknown[]> | null;
  skills: SkillInfo[];
  agents: AgentInfo[];
  hooks: Record<string, unknown[]> | null;
  projects: ProjectConfig[];
  stats: {
    totalSessions: number | null;
    totalMessages: number | null;
    modelUsage: Record<string, unknown> | null;
  } | null;
}

interface PluginInstall {
  scope: "user" | "project" | "local";
  projectPath?: string;
  installPath: string;
  version: string;
}

interface InstalledPluginsV2 {
  version: number;
  plugins: Record<string, PluginInstall[]>;
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

  // Installed plugins (v2 format, lives in plugins/ subdir)
  const pluginsData = (await readJsonSafe(
    path.join(claudeDir, "plugins", "installed_plugins.json")
  )) as InstalledPluginsV2 | null;

  const pluginInstalls = pluginsData?.plugins ?? {};

  // Discover skills & agents from all plugin installs
  const allSkills: SkillInfo[] = [];
  const allAgents: AgentInfo[] = [];

  for (const [pluginKey, installs] of Object.entries(pluginInstalls)) {
    for (const install of installs) {
      const skills = await scanSkillsDir(install.installPath, pluginKey);
      allSkills.push(...skills);
      const agents = await scanAgentsDir(install.installPath, pluginKey);
      allAgents.push(...agents);
    }
  }

  // Deduplicate by dir/file (same installPath can appear for multiple project scopes)
  const uniqueSkills = deduplicateBy(allSkills, (s) => s.dir);
  const uniqueAgents = deduplicateBy(allAgents, (a) => a.file);

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

    // Find skills & agents scoped to this project
    const projectSkills = filterForProject(pluginInstalls, workdir, uniqueSkills);
    const projectAgents = filterForProject(pluginInstalls, workdir, uniqueAgents);

    projects.push({
      repo_url: repoUrl,
      workdir,
      claude_md: projectClaudeMd,
      settings: projectSettings,
      mcp_servers: projectMcp,
      skills: projectSkills,
      agents: projectAgents,
    });
  }

  return {
    global: { settings: globalSettings, mcp_servers: globalMcp },
    plugins: pluginsData?.plugins ?? null,
    skills: uniqueSkills,
    agents: uniqueAgents,
    hooks: (globalSettings?.hooks as Record<string, unknown[]>) ?? null,
    projects,
    stats: null,
  };
}

// Scan a plugin installPath for skills/ directory
async function scanSkillsDir(
  installPath: string,
  pluginKey: string
): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  const skillsDir = path.join(installPath, "skills");
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
          plugin: pluginKey,
          enabled: true,
        });
      } catch {
        // no SKILL.md
      }
    }
  } catch {
    // no skills dir
  }
  return skills;
}

// Scan a plugin installPath for agents/ directory
async function scanAgentsDir(
  installPath: string,
  pluginKey: string
): Promise<AgentInfo[]> {
  const agents: AgentInfo[] = [];
  const agentsDir = path.join(installPath, "agents");
  try {
    const entries = await fs.readdir(agentsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const filePath = path.join(agentsDir, entry);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const nameLine = content.match(/^name:\s*(.+)$/m);
        const descLine = content.match(/^description:\s*(.+)$/m);
        agents.push({
          name: nameLine?.[1]?.trim() ?? entry.replace(/\.md$/, ""),
          description: descLine?.[1]?.trim() ?? "",
          file: filePath,
          plugin: pluginKey,
        });
      } catch {
        // unreadable
      }
    }
  } catch {
    // no agents dir
  }
  return agents;
}

// Filter skills/agents to those available for a given project workdir.
// Includes user-scoped (global) + project/local scoped matching this workdir.
function filterForProject<T extends { plugin: string }>(
  pluginInstalls: Record<string, PluginInstall[]>,
  workdir: string,
  items: T[]
): T[] {
  // Collect plugin keys available for this project
  const availablePlugins = new Set<string>();
  for (const [pluginKey, installs] of Object.entries(pluginInstalls)) {
    for (const install of installs) {
      if (
        install.scope === "user" ||
        (install.projectPath && workdir.startsWith(install.projectPath))
      ) {
        availablePlugins.add(pluginKey);
      }
    }
  }
  return items.filter((item) => availablePlugins.has(item.plugin));
}

function deduplicateBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
