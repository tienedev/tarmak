import type { SyncStatus } from '@/hooks/useSync'
import { useTranslation } from 'react-i18next'

interface ConnectionStatusProps {
  status: SyncStatus
}

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const { t } = useTranslation()
  if (status === 'connected') return null

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg glass glass-border px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
      <span
        className={`size-2 rounded-full ${
          status === 'connecting'
            ? 'animate-pulse bg-yellow-500'
            : 'bg-red-500'
        }`}
      />
      {status === 'connecting' ? t('board.reconnecting') : t('board.offline')}
    </div>
  )
}
