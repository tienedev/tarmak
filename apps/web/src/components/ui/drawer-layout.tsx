import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface DrawerLayoutProps {
  open: boolean
  onClose: () => void
  title: string
  /** Visible subtitle below title. When omitted, an sr-only description is generated from title. */
  description?: string
  /** Max-width value, e.g. "380px", "560px" */
  width?: string
  /** Sticky area between header and body — filters, tabs, actions */
  toolbar?: React.ReactNode
  /** Sticky bottom bar */
  footer?: React.ReactNode
  children: React.ReactNode
  /** When true, children manage their own scrolling and padding (e.g. split layouts) */
  rawBody?: boolean
}

export function DrawerLayout({
  open,
  onClose,
  title,
  description,
  width = '380px',
  toolbar,
  footer,
  children,
  rawBody,
}: DrawerLayoutProps) {
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent
        side="right"
        className="flex w-full flex-col overflow-hidden p-0"
        style={{ maxWidth: width }}
      >
        {/* ---- Header ---- */}
        <header className="shrink-0 border-b px-6 pt-5 pb-4">
          <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
          <SheetDescription
            className={cn(
              description
                ? 'mt-0.5 text-xs text-muted-foreground'
                : 'sr-only',
            )}
          >
            {description ?? title}
          </SheetDescription>
        </header>

        {/* ---- Toolbar ---- */}
        {toolbar && (
          <div className="shrink-0 border-b px-6 py-3">{toolbar}</div>
        )}

        {/* ---- Body ---- */}
        {rawBody ? (
          <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="px-6 py-4">{children}</div>
          </ScrollArea>
        )}

        {/* ---- Footer ---- */}
        {footer && (
          <div className="shrink-0 border-t px-6 py-3">{footer}</div>
        )}
      </SheetContent>
    </Sheet>
  )
}
