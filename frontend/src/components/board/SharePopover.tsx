import { useState, useEffect } from 'react'
import { api, type InviteLink } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { useNotificationStore } from '@/stores/notifications'
import { Link2, Copy, Check, Trash2 } from 'lucide-react'

interface SharePopoverProps {
  boardId: string
}

export function SharePopover({ boardId }: SharePopoverProps) {
  const user = useAuthStore((s) => s.user)
  const addNotification = useNotificationStore((s) => s.add)
  const [role, setRole] = useState('member')
  const [invites, setInvites] = useState<InviteLink[]>([])
  const [generatedLink, setGeneratedLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) {
      api.listInvites(boardId).then(setInvites).catch(() => {
        addNotification('Failed to load invite links')
      })
    }
  }, [open, boardId])

  const handleGenerate = async () => {
    if (!user) return
    setLoading(true)
    try {
      const res = await api.createInvite({
        board_id: boardId,
        role,
      })
      const fullUrl = `${window.location.origin}${window.location.pathname}#/invite${res.invite_url.replace('/invite', '')}`
      setGeneratedLink(fullUrl)
      const updated = await api.listInvites(boardId)
      setInvites(updated)
    } catch {
      addNotification('Failed to generate invite link')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generatedLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRevoke = async (id: string) => {
    try {
      await api.revokeInvite(id)
      setInvites((prev) => prev.filter((i) => i.id !== id))
      if (generatedLink) setGeneratedLink('')
    } catch {
      addNotification('Failed to revoke invite')
    }
  }

  const daysLeft = (expiresAt: string) => {
    const diff = new Date(expiresAt).getTime() - Date.now()
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="xs" className="gap-1.5 text-xs text-muted-foreground" />
        }
      >
        <Link2 className="size-3.5" />
        Share
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium">Share this board</p>

          <div className="flex gap-2">
            <Select value={role} onValueChange={(v) => setRole(v ?? 'member')}>
              <SelectTrigger size="sm" className="flex-1">
                {role === 'member' ? 'Member' : 'Viewer'}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleGenerate} disabled={loading}>
              Generate link
            </Button>
          </div>

          {generatedLink && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                  {generatedLink}
                </code>
                <Button size="icon" variant="ghost" onClick={handleCopy} className="size-7 shrink-0">
                  {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
              <p className="text-[0.65rem] text-muted-foreground">Link expires in 7 days</p>
            </div>
          )}

          {invites.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">Active links</p>
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-2 text-xs">
                  <code className="truncate text-muted-foreground">
                    {inv.token.slice(0, 8)}...
                  </code>
                  <span className="text-muted-foreground">{inv.role}</span>
                  <span className="text-muted-foreground/60">{daysLeft(inv.expires_at)}d left</span>
                  <div className="flex-1" />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6 shrink-0"
                    onClick={() => handleRevoke(inv.id)}
                  >
                    <Trash2 className="size-3 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
