import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useBoardStore } from '@/stores/board'
import { agentApi, type AgentConfig, type McpServer, type SkillInfo } from '@/lib/agent'
import { ArrowLeft, Terminal, Server, Puzzle, FileText, Loader2, RefreshCw, AlertCircle, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'

interface DevGroundPageProps {
  boardId: string
}

export function DevGroundPage({ boardId }: DevGroundPageProps) {
  const { t } = useTranslation()
  const { currentBoard, loading, fetchBoard, clearCurrentBoard } = useBoardStore()
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)

  useEffect(() => {
    fetchBoard(boardId)
    return () => clearCurrentBoard()
  }, [boardId, fetchBoard, clearCurrentBoard])

  const loadConfig = async () => {
    setConfigLoading(true)
    setConfigError(null)
    try {
      const data = await agentApi.getConfig()
      setConfig(data)
    } catch {
      setConfigError(t('devGround.agentNotReachable'))
    } finally {
      setConfigLoading(false)
    }
  }

  useEffect(() => {
    loadConfig()
  }, [])

  if (loading && !currentBoard) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 glass-heavy glass-border px-6">
          <div className="h-4 w-4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        </header>
      </div>
    )
  }

  if (!currentBoard) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">{t('board.notFound')}</p>
        <Button variant="outline" size="sm" onClick={() => (window.location.hash = '#/')}>
          <ArrowLeft className="size-3.5" data-icon="inline-start" />
          {t('board.backToBoards')}
        </Button>
      </div>
    )
  }

  // Find project config matching this board's repo_url
  const projectConfig = config?.projects.find((p) => p.repo_url === currentBoard.repo_url)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 glass-heavy glass-border px-6">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('board.backToBoards')}
          onClick={() => (window.location.hash = `#/boards/${boardId}`)}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <h1 className="truncate text-sm font-bold">
          {currentBoard.name}
        </h1>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-sm font-medium text-muted-foreground">{t('sidebar.devGround')}</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={loadConfig}
          disabled={configLoading}
          aria-label={t('devGround.refresh')}
        >
          <RefreshCw className={`size-3.5 ${configLoading ? 'animate-spin' : ''}`} />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6 space-y-6">
          {/* Error state */}
          {configError && (
            <div className="flex items-center gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-3">
              <AlertCircle className="size-4 text-yellow-500 shrink-0" />
              <p className="text-sm text-yellow-600 dark:text-yellow-400">{configError}</p>
              <Button variant="outline" size="sm" className="ml-auto" onClick={loadConfig}>
                {t('common.retry')}
              </Button>
            </div>
          )}

          {/* Loading */}
          {configLoading && !config && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {config && (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* MCP Servers */}
              <ConfigCard
                icon={<Server className="size-4" />}
                title={t('devGround.mcpServers')}
                count={projectConfig?.mcp_servers.length ?? 0}
              >
                {projectConfig && projectConfig.mcp_servers.length > 0 ? (
                  <div className="max-h-64 overflow-y-auto space-y-2 -mx-1 px-1">
                    {projectConfig.mcp_servers.map((server) => (
                      <McpServerRow key={`${server.scope}-${server.name}`} server={server} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-2">{t('devGround.noMcpServers')}</p>
                )}
              </ConfigCard>

              {/* Skills — use project-level skills if available, fallback to global */}
              {(() => {
                const skills = projectConfig?.skills ?? config.skills
                return (
                  <ConfigCard
                    icon={<Puzzle className="size-4" />}
                    title={t('devGround.skills')}
                    count={skills.filter((s) => s.enabled).length}
                    subtitle={skills.some((s) => !s.enabled)
                      ? `${skills.filter((s) => !s.enabled).length} ${t('devGround.disabled')}`
                      : undefined}
                  >
                    {skills.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto space-y-2 -mx-1 px-1">
                        {skills.map((skill) => (
                          <SkillRow key={`${skill.plugin}-${skill.dir}`} skill={skill} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">{t('devGround.noSkills')}</p>
                    )}
                  </ConfigCard>
                )
              })()}

              {/* Hooks */}
              {config.hooks && Object.keys(config.hooks).length > 0 && (
                <ConfigCard
                  icon={<Zap className="size-4" />}
                  title={t('devGround.hooks')}
                  count={Object.keys(config.hooks).length}
                >
                  <div className="max-h-64 overflow-y-auto space-y-2 -mx-1 px-1">
                    {Object.entries(config.hooks).map(([event, entries]) => (
                      <HookRow key={event} event={event} entries={entries} />
                    ))}
                  </div>
                </ConfigCard>
              )}

              {/* CLAUDE.md */}
              <div className="lg:col-span-2">
                <ConfigCard
                  icon={<FileText className="size-4" />}
                  title="CLAUDE.md"
                  count={projectConfig?.claude_md ? 1 : 0}
                >
                  {projectConfig?.claude_md ? (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-3 py-2 text-xs font-mono">
                      {projectConfig.claude_md}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground py-2">{t('devGround.noClaudeMd')}</p>
                  )}
                </ConfigCard>
              </div>

              {/* Stats */}
              {config.stats && (
                <div className="lg:col-span-2">
                  <ConfigCard
                    icon={<Terminal className="size-4" />}
                    title={t('devGround.stats')}
                  >
                    <div className="flex gap-6">
                      {config.stats.totalSessions != null && (
                        <StatItem label={t('devGround.totalSessions')} value={config.stats.totalSessions} />
                      )}
                      {config.stats.totalMessages != null && (
                        <StatItem label={t('devGround.totalMessages')} value={config.stats.totalMessages} />
                      )}
                    </div>
                  </ConfigCard>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ConfigCard({
  icon,
  title,
  count,
  subtitle,
  children,
}: {
  icon: React.ReactNode
  title: string
  count?: number
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="ml-auto flex items-center gap-2">
          {subtitle && (
            <span className="text-[0.6rem] text-muted-foreground">{subtitle}</span>
          )}
          {count != null && (
            <Badge variant="secondary" className="text-[0.6rem]">{count}</Badge>
          )}
        </div>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  )
}

function McpServerRow({ server }: { server: McpServer }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-muted/30 px-3 py-2">
      <div className="size-2 rounded-full bg-green-500 shrink-0" />
      <span className="text-sm font-medium">{server.name}</span>
      <Badge variant="outline" className="text-[0.55rem] ml-auto">{server.scope}</Badge>
    </div>
  )
}

function SkillRow({ skill }: { skill: SkillInfo }) {
  const pluginShort = skill.plugin?.split('@')[0] ?? ''
  return (
    <div className={`rounded-lg px-3 py-2 ${skill.enabled ? 'bg-muted/30' : 'bg-muted/10 opacity-50'}`}>
      <div className="flex items-center gap-2">
        <div className={`size-1.5 rounded-full shrink-0 ${skill.enabled ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
        <span className="text-sm font-medium">{skill.name}</span>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {pluginShort && (
            <Badge variant="outline" className="text-[0.55rem]">{pluginShort}</Badge>
          )}
        </div>
      </div>
      {skill.description && (
        <p className="mt-0.5 ml-3.5 text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
      )}
    </div>
  )
}

function HookRow({ event, entries }: { event: string; entries: Array<{ command: string }> }) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-2">
        <code className="text-xs font-semibold font-mono">{event}</code>
        <Badge variant="secondary" className="text-[0.5rem] ml-auto">{entries.length}</Badge>
      </div>
      <div className="mt-1 space-y-1">
        {entries.map((entry, i) => (
          <p key={i} className="text-xs text-muted-foreground font-mono truncate">
            {entry.command}
          </p>
        ))}
      </div>
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-bold">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
