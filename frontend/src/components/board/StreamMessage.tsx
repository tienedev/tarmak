import type { StreamMessage as StreamMessageType } from '@/hooks/useSessionStream'

export function StreamMessage({ message }: { message: StreamMessageType }) {
  switch (message.type) {
    case 'assistant':
      return (
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
      )
    case 'tool_use':
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">✎ {message.tool}</span>
          {message.input?.file_path && (
            <span className="truncate">{String(message.input.file_path)}</span>
          )}
        </div>
      )
    case 'tool_result':
      return (
        <div className="text-xs text-muted-foreground/70 font-mono truncate">
          → {message.output}
        </div>
      )
    case 'result':
      return (
        <div className="text-sm font-medium text-green-600 dark:text-green-400">
          {message.content}
        </div>
      )
    case 'error':
      return (
        <div className="text-sm text-red-500">{message.message}</div>
      )
    default:
      return null
  }
}
