import React, { useEffect, useRef, useState } from "react";
import { Folder, FolderOpen, PencilRuler } from "lucide-react";
import { ReadDirectory } from "../../wailsjs/go/main/App";

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
  const FolderIcon = open ? FolderOpen : Folder;

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
          {entry.isDir ? <FolderIcon className="folder-icon" aria-hidden="true" /> : <PencilRuler className="file-icon" aria-hidden="true" />}
          <RenameInput entry={entry} onCommit={onRename} onCancel={onCancelRename} />
        </div>
      : <button
          className={`tree-row ${entry.path === activePath ? "active" : ""} ${entry.path === selectedPath ? "selected" : ""}`}
          onClick={activate}
          onContextMenu={(event) => onMenu(event, entry)}
          title={entry.path}
        >
          {entry.isDir ? <FolderIcon className="folder-icon" aria-hidden="true" /> : <PencilRuler className="file-icon" aria-hidden="true" />}
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
