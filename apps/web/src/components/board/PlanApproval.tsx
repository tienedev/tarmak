import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Check, X } from 'lucide-react'

interface PlanApprovalProps {
  plan: string
  onApprove: () => void
  onReject: () => void
}

export function PlanApproval({ plan, onApprove, onReject }: PlanApprovalProps) {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2">
        {t('agent.planProposal')}
      </p>
      <pre className="text-sm whitespace-pre-wrap mb-3">{plan}</pre>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onReject} className="gap-1.5">
          <X className="size-3.5" />
          {t('agent.reject')}
        </Button>
        <Button size="sm" onClick={onApprove} className="gap-1.5">
          <Check className="size-3.5" />
          {t('agent.approve')}
        </Button>
      </div>
    </div>
  )
}
