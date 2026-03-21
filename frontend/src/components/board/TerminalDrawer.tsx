import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AgentSession } from '@/lib/api'
import { agentApi } from '@/lib/agent'
import '@xterm/xterm/css/xterm.css'

interface TerminalDrawerProps {
  session: AgentSession | null
  open: boolean
  onClose: () => void
}

export function TerminalDrawer({ session, open, onClose }: TerminalDrawerProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open || !session || !termRef.current) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'Geist Mono, monospace',
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#fafafa',
      },
      convertEol: true,
      scrollback: 10000,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)
    fitAddon.fit()
    terminalRef.current = term

    if (session.status === 'running') {
      // Connect to live PTY
      const ws = new WebSocket(agentApi.getWsUrl(session.id))
      ws.binaryType = 'arraybuffer'
      ws.onmessage = (event) => {
        const data = new Uint8Array(event.data as ArrayBuffer)
        term.write(data)
      }
      ws.onclose = () => {
        term.write('\r\n\x1b[90m--- Session ended ---\x1b[0m\r\n')
      }
      wsRef.current = ws
    } else if (session.log) {
      // Show static log
      term.write(session.log)
    }

    const container = termRef.current
    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      wsRef.current?.close()
      term.dispose()
      terminalRef.current = null
    }
  }, [open, session?.id, session?.status, session?.log])

  const handleCopy = () => {
    if (session?.log) {
      navigator.clipboard.writeText(session.log)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!open || !session) return null

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[600px] max-w-[90vw] bg-[#09090b] border-l border-zinc-800 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-sm font-medium text-zinc-300">
          Terminal — {session.branch_name || session.id.slice(0, 8)}
        </span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={handleCopy} className="h-7 px-2 text-zinc-400">
            <Copy className="size-3.5" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 px-2 text-zinc-400">
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div ref={termRef} className="flex-1 p-2" />
    </div>
  )
}
