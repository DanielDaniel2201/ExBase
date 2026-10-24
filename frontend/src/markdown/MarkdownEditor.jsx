import React, { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import DOMPurify from "dompurify";
import { BrowserOpenURL } from "../../wailsjs/runtime/runtime";
import "./markdown.css";

export function isMarkdown(path) {
  return /\.(md|markdown)$/i.test(path || "");
}

const extensions = [
  StarterKit.configure({ link: { openOnClick: false } }),
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true, HTMLAttributes: { class: "markdown-task-item" } }),
  Image,
  Markdown.configure({ markedOptions: { gfm: true } }),
];

export function MarkdownEditor({ content, onChange, onSave, error }) {
  const [headings, setHeadings] = useState([]);
  const [activeHeading, setActiveHeading] = useState(null);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const page = useRef(null);
  // The document path owns remounting; feeding each edit back in would reset the caret and undo history.
  const editor = useEditor({
    extensions,
    content,
    contentType: "markdown",
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
    editorProps: {
      decorations: (state) => {
        const anchors = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === "heading" && node.attrs.level <= 3) anchors.push(Decoration.node(pos, pos + node.nodeSize, { id: `markdown-heading-${pos}` }));
        });
        return DecorationSet.create(state.doc, anchors);
      },
      attributes: { class: "markdown-prose", role: "textbox", "aria-label": "Markdown document", "aria-multiline": "true", spellcheck: "false" },
      transformPastedHTML: (html) => DOMPurify.sanitize(html),
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text || event.clipboardData.getData("text/html") || view.state.selection.$from.parent.type.spec.code) return false;
        event.preventDefault();
        editor.commands.insertContent(text, { contentType: "markdown" });
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    function updateHeadings() {
      const items = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "heading" || node.attrs.level > 3) return;
        const id = `markdown-heading-${pos}`;
        items.push({ pos, id, level: node.attrs.level, text: node.textContent || "Untitled" });
      });
      setHeadings(items);
    }
    updateHeadings();
    editor.on("update", updateHeadings);
    return () => { editor.off("update", updateHeadings); };
  }, [editor]);

  useEffect(() => {
    const scroller = page.current;
    if (!editor || !scroller) return;
    function updateActive() {
      let current = headings[0]?.id ?? null;
      const top = scroller.getBoundingClientRect().top + 40;
      for (const heading of headings) {
        const element = editor.view.nodeDOM(heading.pos);
        if (!(element instanceof HTMLElement) || element.getBoundingClientRect().top > top) break;
        current = heading.id;
      }
      if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = headings.at(-1)?.id ?? null;
      setActiveHeading(current);
    }
    updateActive();
    scroller.addEventListener("scroll", updateActive, { passive: true });
    return () => scroller.removeEventListener("scroll", updateActive);
  }, [editor, headings, outlineOpen]);

  function jumpToHeading(event, heading) {
    event.preventDefault();
    const element = editor.view.nodeDOM(heading.pos);
    const scroller = page.current;
    if (!(element instanceof HTMLElement) || !scroller) return;
    scroller.scrollTo({ top: scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24, behavior: "smooth" });
  }

  function openLink(event) {
    const link = event.target.closest("a");
    if (!link) return;
    event.preventDefault();
    const url = link.getAttribute("href") || "";
    if ((event.ctrlKey || event.metaKey) && /^(https?:|mailto:)/i.test(url)) BrowserOpenURL(url);
  }

  return <div className="markdown-editor" onClick={openLink} onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); onSave(); }
  }}>
    {error && <div className="markdown-error" role="alert">Could not save: {error}. Press Ctrl+S to retry.</div>}
    <div className="markdown-body">
      {headings.length > 0 && <nav className={`markdown-outline ${outlineOpen ? "" : "collapsed"}`} aria-label="Markdown outline">
        <div className="markdown-outline-header">
          <button type="button" className="markdown-outline-toggle" title={outlineOpen ? "Collapse contents" : "Expand contents"} aria-expanded={outlineOpen} aria-controls="markdown-outline-links" onClick={() => setOutlineOpen((open) => !open)}>Contents</button>
        </div>
        <div id="markdown-outline-links" hidden={!outlineOpen}>
          {headings.map((heading) => <a key={heading.id} href={`#${heading.id}`} className={`markdown-outline-link level-${heading.level}`} aria-current={heading.id === activeHeading ? "location" : undefined} title={heading.text} onClick={(event) => jumpToHeading(event, heading)}>{heading.text}</a>)}
        </div>
      </nav>}
      <div className="markdown-page" ref={page}><EditorContent className="markdown-content" editor={editor} /></div>
    </div>
  </div>;
}
