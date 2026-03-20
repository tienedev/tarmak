import { useNotificationStore } from '@/stores/notifications'
import type { ServerNotification } from '@/lib/api'
import { useEffect } from 'react'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { Bell, Check, X } from 'lucide-react'

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function NotificationBell() {
  const { notifications, markRead, markAllRead, dismiss, unreadCount, fetch, connectSSE, disconnectSSE, fetchUnreadCount } =
    useNotificationStore()
  // unreadCount is now a plain number, not a function
  const count = unreadCount

  useEffect(() => {
    connectSSE()
    fetchUnreadCount()
    return () => disconnectSSE()
  }, [connectSSE, disconnectSSE, fetchUnreadCount])

  return (
    <Popover onOpenChange={(open) => { if (open) fetch() }}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-xs" className="relative" aria-label="Notifications" />
        }
      >
        <Bell className="size-3.5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-red-500 text-[0.6rem] font-bold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <PopoverHeader className="flex items-center justify-between border-b px-3 py-2.5">
          <PopoverTitle className="text-sm">Notifications</PopoverTitle>
          {count > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="h-5 gap-1 text-[0.65rem] text-muted-foreground"
              onClick={markAllRead}
            >
              <Check className="size-3" />
              Mark all read
            </Button>
          )}
        </PopoverHeader>

        {notifications.length > 0 ? (
          <ScrollArea className="max-h-72">
            <div className="flex flex-col">
              {notifications.map((notif: ServerNotification) => (
                <div
                  key={notif.id}
                  onClick={() => {
                    if (notif.board_id) window.location.hash = `#/boards/${notif.board_id}`
                    if (!notif.read) markRead(notif.id)
                  }}
                  className={cn(
                    'group flex cursor-pointer items-start gap-2.5 border-b border-border/40 px-3 py-2.5 transition-colors last:border-0 hover:bg-accent/50',
                    !notif.read && 'bg-accent/30',
                  )}
                >
                  {/* Unread dot */}
                  <span
                    className={cn(
                      'mt-1.5 size-1.5 shrink-0 rounded-full transition-colors',
                      notif.read ? 'bg-transparent' : 'bg-blue-500',
                    )}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-foreground">
                      {notif.title}
                    </p>
                    <span className="text-[0.65rem] text-muted-foreground">
                      {formatTimeAgo(new Date(notif.created_at).getTime())}
                    </span>
                  </div>

                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    {!notif.read && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); markRead(notif.id) }}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Mark as read"
                      >
                        <Check className="size-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); dismiss(notif.id) }}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Dismiss"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="py-8 text-center">
            <Bell className="mx-auto mb-2 size-5 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground/60">No notifications</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
