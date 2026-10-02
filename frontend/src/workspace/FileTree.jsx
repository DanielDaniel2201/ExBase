import React, { useEffect, useRef, useState } from "react";
import { ReadDirectory } from "../../wailsjs/go/main/App";

function FolderIcon({ open }) {
  return <svg
    className="folder-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={open
      ? "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
      : "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"} />
  </svg>;
}

export function PencilRulerIcon() {
  return <svg
    className="file-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13" />
    <path d="m8 6 2-2" />
    <path d="m18 16 2-2" />
    <path d="m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17" />
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </svg>;
}

function RenameInput({ entry, onCommit, onCancel }) {
  const [value, setValue] = useState(entry.name);
  const input = useRef();
  const committing = useRef(false);

  useEffect(() => {
    input.current.focus();
    input.current.setSelectionRange(0, entry.isDir ? entry.name.length : Math.max(0, entry.name.lastIndexOf(".")));
  }, []);

  async function commit() {
    if (committing.current) return;
    committing.current = true;
    if (!await onCommit(entry, value)) {
      committing.current = false;
      input.current.focus();
    }
  }

  return <input
    ref={input}
    className="tree-name-input"
    value={value}
    onChange={(event) => setValue(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
      if (event.key === "Escape") {
        committing.current = true;
        onCancel();
      }
    }}
  />;
}

function TreeNode({ entry, activePath, selectedPath, editingPath, onOpen, onSelect, onError, onMenu, onRename, onCancelRename, refreshKey, revealPath }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState(null);

  useEffect(() => {
    if (!entry.isDir || !open) return;
    ReadDirectory(entry.path).then(setChildren).catch((error) => {
      setOpen(false);
      onError(String(error));
    });
  }, [entry.path, open, refreshKey]);

  useEffect(() => {
    if (entry.path === revealPath) setOpen(true);
  }, [entry.path, revealPath]);

  async function activate() {
    onSelect(entry);
    if (!entry.isDir) return onOpen(entry.path);
    setOpen(!open);
  }

  return <li>
    {entry.path === editingPath
      ? <div className="tree-row editing">
          {entry.isDir ? <FolderIcon open={open} /> : <PencilRulerIcon />}
          <RenameInput entry={entry} onCommit={onRename} onCancel={onCancelRename} />
        </div>
      : <button
          className={`tree-row ${entry.path === activePath ? "active" : ""} ${entry.path === selectedPath ? "selected" : ""}`}
          onClick={activate}
          onContextMenu={(event) => onMenu(event, entry)}
          title={entry.path}
        >
          {entry.isDir ? <FolderIcon open={open} /> : <PencilRulerIcon />}
          <span className="tree-name">{entry.name}</span>
        </button>}
    {entry.isDir && open && <FileTree
      entries={children || []}
      activePath={activePath}
      selectedPath={selectedPath}
      editingPath={editingPath}
      onOpen={onOpen}
      onSelect={onSelect}
      onError={onError}
      onMenu={onMenu}
      onRename={onRename}
      onCancelRename={onCancelRename}
      refreshKey={refreshKey}
      revealPath={revealPath}
    />}
  </li>;
}

export function FileTree(props) {
  if (!props.entries.length) return <ul className="tree empty-tree"><li>Empty</li></ul>;
  return <ul className="tree">{props.entries.map((entry) => <TreeNode key={entry.path} entry={entry} {...props} />)}</ul>;
}
