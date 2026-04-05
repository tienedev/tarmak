import type { PresenceUser } from '@/hooks/usePresence'
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip'

interface PresenceAvatarsProps {
  users: PresenceUser[]
  maxVisible?: number
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export function PresenceAvatars({ users, maxVisible = 5 }: PresenceAvatarsProps) {
  if (users.length === 0) return null

  const visible = users.slice(0, maxVisible)
  const overflow = users.length - maxVisible

  return (
    <TooltipProvider>
      <AvatarGroup>
        {visible.map((user) => (
          <Tooltip key={user.id}>
            <TooltipTrigger render={<span />}>
              <Avatar size="sm">
                <AvatarFallback
                  className="text-[0.6rem] font-semibold text-white"
                  style={{ backgroundColor: user.color }}
                >
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>{user.name}</TooltipContent>
          </Tooltip>
        ))}
        {overflow > 0 && (
          <AvatarGroupCount>
            <span className="text-[0.6rem]">+{overflow}</span>
          </AvatarGroupCount>
        )}
      </AvatarGroup>
    </TooltipProvider>
  )
}
