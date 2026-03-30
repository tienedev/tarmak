import { useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { FileBlock } from "./FileBlockNode";
import { MentionList } from "./MentionList";
import type { MentionListRef } from "./MentionList";
import { api } from "@/lib/api";
import { useBoardStore } from "@/stores/board";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  Code,
  Quote,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TiptapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  boardId?: string;
  taskId?: string;
}

/**
 * Strip HTML tags from a string, returning plain text.
 * Useful for generating previews of rich-text content.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent ?? "";
}

function createMentionSuggestion(members: { id: string; name: string }[]) {
  return {
    items: ({ query }: { query: string }) =>
      members
        .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 5),
    render: () => {
      let component: ReactRenderer<MentionListRef> | null = null;
      let popup: TippyInstance[] | null = null;
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onStart: (props: any) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          });
          popup = tippy("body", {
            getReferenceClientRect: props.clientRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onUpdate: (props: any) => {
          component?.updateProps(props);
          popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect });
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onKeyDown: (props: any) => component?.ref?.onKeyDown(props) ?? false,
        onExit: () => {
          popup?.[0]?.destroy();
          component?.destroy();
        },
      };
    },
  };
}

function createFileDropExtension(boardId: string, taskId: string) {
  return Extension.create({
    name: "fileDrop",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleDrop(view: EditorView, event: DragEvent) {
              const files = event.dataTransfer?.files;
              if (!files?.length) return false;

              event.preventDefault();
              const pos = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              })?.pos;

              Array.from(files).forEach(async (file) => {
                try {
                  const attachment = await api.uploadAttachment(boardId, taskId, file);
                  const downloadUrl = `/api/v1/boards/${boardId}/attachments/${attachment.id}/download`;

                  if (file.type.startsWith("image/")) {
                    view.dispatch(
                      view.state.tr.insert(
                        pos ?? view.state.doc.content.size,
                        view.state.schema.nodes.image.create({ src: downloadUrl }),
                      ),
                    );
                  } else {
                    view.dispatch(
                      view.state.tr.insert(
                        pos ?? view.state.doc.content.size,
                        view.state.schema.nodes.fileBlock.create({
                          src: downloadUrl,
                          filename: attachment.filename,
                          mime: attachment.mime_type,
                          size: attachment.size_bytes,
                        }),
                      ),
                    );
                  }
                } catch {
                  // upload failed — silently ignore
                }
              });
              return true;
            },
          },
        }),
      ];
    },
  });
}

interface BubbleButtonProps {
  onClick: () => void;
  isActive: boolean;
  children: React.ReactNode;
}

function BubbleButton({ onClick, isActive, children }: BubbleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "size-7 inline-flex items-center justify-center rounded-md hover:bg-accent",
        isActive && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function TiptapEditor({
  content,
  onChange,
  placeholder = "Start writing...",
  className,
  boardId,
  taskId,
}: TiptapEditorProps) {
  const members = useBoardStore((s) => s.members);

  // Use a ref for onChange so the editor instance doesn't get recreated
  // every time the parent re-renders with a new callback reference.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const handleUpdate = useCallback(
    ({ editor }: { editor: { getHTML: () => string } }) => {
      onChangeRef.current(editor.getHTML());
    },
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
      Image.configure({ inline: false, allowBase64: false }),
      FileBlock,
      ...(boardId
        ? [
            Mention.configure({
              HTMLAttributes: { class: "mention" },
              suggestion: createMentionSuggestion(
                members.map((m) => ({ id: m.id, name: m.name })),
              ),
            }),
          ]
        : []),
      ...(boardId && taskId
        ? [createFileDropExtension(boardId, taskId)]
        : []),
    ],
    content,
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class:
          "prose prose-base dark:prose-invert max-w-none focus:outline-none min-h-[12rem] leading-relaxed",
      },
    },
  });

  // Sync external content changes (e.g. when switching between tasks).
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.getHTML() !== content) {
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  if (!editor) return null;

  return (
    <div
      className={cn(
        "",
        className,
      )}
    >
      <BubbleMenu
        editor={editor}
        className="flex items-center gap-0.5 rounded-xl glass-heavy glass-border p-1"
      >
        <BubbleButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
        >
          <Bold className="size-4" />
        </BubbleButton>

        <BubbleButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
        >
          <Italic className="size-4" />
        </BubbleButton>

        <BubbleButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          isActive={editor.isActive("heading", { level: 2 })}
        >
          <Heading2 className="size-4" />
        </BubbleButton>

        <BubbleButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
        >
          <List className="size-4" />
        </BubbleButton>

        <BubbleButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
        >
          <ListOrdered className="size-4" />
        </BubbleButton>

        <BubbleButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editor.isActive("codeBlock")}
        >
          <Code className="size-4" />
        </BubbleButton>

        <BubbleButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
        >
          <Quote className="size-4" />
        </BubbleButton>
      </BubbleMenu>

      <EditorContent editor={editor} />
    </div>
  );
}
