import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { FileText, FileArchive, FileImage, File } from 'lucide-react'

function getFileIcon(mime: string) {
  if (mime.startsWith('image/')) return FileImage
  if (mime.includes('zip') || mime.includes('archive')) return FileArchive
  if (mime.includes('pdf') || mime.includes('document')) return FileText
  return File
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileBlockComponent({ node }: NodeViewProps) {
  const attrs = node.attrs as { src: string; filename: string; mime: string; size: number }
  const Icon = getFileIcon(attrs.mime)
  return (
    <NodeViewWrapper className="my-2">
      <a
        href={attrs.src}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5 no-underline transition hover:bg-muted/50"
      >
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{attrs.filename}</p>
          <p className="text-xs text-muted-foreground">{formatSize(attrs.size)}</p>
        </div>
      </a>
    </NodeViewWrapper>
  )
}

export const FileBlock = Node.create({
  name: 'fileBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      filename: { default: 'file' },
      mime: { default: 'application/octet-stream' },
      size: { default: 0 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-file-block]' }]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-file-block': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileBlockComponent)
  },
})
