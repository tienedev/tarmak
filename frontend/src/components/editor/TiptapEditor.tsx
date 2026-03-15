import { useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
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
}

/**
 * Strip HTML tags from a string, returning plain text.
 * Useful for generating previews of rich-text content.
 */
export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent ?? "";
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
}: TiptapEditorProps) {
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
