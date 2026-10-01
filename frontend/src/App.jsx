import React, { useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import {
  ChooseFolder, CreateDocument, CreateFolder, DeleteEntry, OpenDocument, ReadDirectory, Rename, Save, SwitchFolder, Workspaces,
} from "../wailsjs/go/main/App";
import { Quit, WindowMinimise, WindowToggleMaximise } from "../wailsjs/runtime/runtime";
import { parseScene } from "./scene";
import { reconcileMermaid } from "./mermaid";
import { CanvasChat, SettingsIcon, SettingsModal } from "./AI";

function basename(path) {
  return path.split(/[\\/]/).pop();
}

function isSameOrChild(path, parent) {
  path = path?.toLowerCase();
  parent = parent.toLowerCase();
  return path === parent || path?.startsWith(parent + "\\") || path?.startsWith(parent + "/");
}

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

function PencilRulerIcon() {
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

function PanelLeftIcon({ open }) {
  return <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d={open ? "m14 9 3 3-3 3" : "m16 15-3-3 3-3"} />
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

function FileTree(props) {
  if (!props.entries.length) return <ul className="tree empty-tree"><li>Empty</li></ul>;
  return <ul className="tree">{props.entries.map((entry) => <TreeNode key={entry.path} entry={entry} {...props} />)}</ul>;
}

function Titlebar({ children }) {
  return <header className="titlebar" onDoubleClick={WindowToggleMaximise}>
    {children}
    <div className="window-controls" onDoubleClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={WindowMinimise} aria-label="Minimise"><span className="minimise-icon" /></button>
      <button type="button" onClick={WindowToggleMaximise} aria-label="Maximise"><span className="maximise-icon" /></button>
      <button type="button" className="close-button" onClick={Quit} aria-label="Close"><span className="close-icon" /></button>
    </div>
  </header>;
}

export default function App() {
  const [workspace, setWorkspace] = useState(null);
  const [folders, setFolders] = useState([]);
  const [entries, setEntries] = useState([]);
  const [doc, setDoc] = useState(null);
  const [api, setApi] = useState(null);
  const [status, setStatus] = useState("");
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [editingPath, setEditingPath] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [revealPath, setRevealPath] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const picker = useRef();
  const autosaveTimer = useRef();
  const lastSaved = useRef("");
  const aiPreview = useRef(null);

  useEffect(() => {
    Workspaces().then((state) => state.current && applyWorkspace(state)).catch((error) => setStatus(String(error)));
    function closePicker(event) {
      if (picker.current?.open && !picker.current.contains(event.target)) picker.current.open = false;
      if (event.button === 0 && !event.target.closest(".tree-row, .context-menu")) setSelectedEntry(null);
      setContextMenu(null);
    }
    document.addEventListener("pointerdown", closePicker);
    return () => {
      clearTimeout(autosaveTimer.current);
      document.removeEventListener("pointerdown", closePicker);
    };
  }, []);

  async function applyWorkspace(state) {
    setWorkspace(state.current);
    setFolders(state.folders);
    setEntries([]);
    setDoc(null);
    setApi(null);
    setSelectedEntry(null);
    setEditingPath(null);
    setContextMenu(null);
    setRevealPath(null);
    lastSaved.current = "";
    const items = await ReadDirectory(state.current);
    setEntries(items);
    setStatus("");
  }

  async function chooseFolder() {
    if (picker.current) picker.current.open = false;
    try {
      if (doc && api) await save();
      const state = await ChooseFolder();
      if (state.current) await applyWorkspace(state);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function switchFolder(path) {
    if (picker.current) picker.current.open = false;
    if (path === workspace) return;
    try {
      if (doc && api) await save();
      await applyWorkspace(await SwitchFolder(path));
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function openDocument(path) {
    try {
      if (doc && api) await save();
      const file = await OpenDocument(path);
      const scene = parseScene(file.data);
      lastSaved.current = serializeAsJSON(scene.elements, scene.appState || {}, scene.files || {}, "local");
      setApi(null);
      setDoc({ path: file.path, scene });
      setStatus("");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function refreshTree(dir) {
    setEntries(await ReadDirectory(workspace));
    setRefreshKey((value) => value + 1);
    setRevealPath(dir === workspace ? null : dir);
  }

  async function createDocument(dir = workspace) {
    setContextMenu(null);
    try {
      if (doc && api) await save();
      const file = await CreateDocument(dir);
      const scene = parseScene(file.data);
      lastSaved.current = file.data;
      await refreshTree(dir);
      setApi(null);
      setDoc({ path: file.path, scene });
      setSelectedEntry({ name: basename(file.path), path: file.path, isDir: false });
      setEditingPath(file.path);
      setStatus("");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function createFolder(dir = workspace) {
    setContextMenu(null);
    try {
      const entry = await CreateFolder(dir);
      await refreshTree(dir);
      setSelectedEntry(entry);
      setEditingPath(entry.path);
      setStatus("");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function renameEntry(entry, name) {
    try {
      const containsCurrent = isSameOrChild(doc?.path, entry.path);
      if (containsCurrent && api) await save();
      const renamed = await Rename(entry.path, name);
      if (containsCurrent) {
        const file = await OpenDocument(renamed.path + doc.path.slice(entry.path.length));
        const scene = parseScene(file.data);
        lastSaved.current = file.data;
        setApi(null);
        setDoc({ path: file.path, scene });
      }
      setSelectedEntry(renamed);
      setEditingPath(null);
      await refreshTree("");
      setStatus("");
      return true;
    } catch (error) {
      setStatus(String(error));
      return false;
    }
  }

  function showContextMenu(event, entry = null) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedEntry(entry);
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 140),
      entry,
    });
  }

  async function deleteEntry(entry) {
    setContextMenu(null);
    if (entry.isDir && !window.confirm(`Delete "${entry.name}" and everything inside it?`)) return;
    const deletesCurrent = isSameOrChild(doc?.path, entry.path);
    if (deletesCurrent) clearTimeout(autosaveTimer.current);
    try {
      await DeleteEntry(entry.path);
      if (deletesCurrent) {
        setDoc(null);
        setApi(null);
        lastSaved.current = "";
      }
      if (isSameOrChild(editingPath, entry.path)) setEditingPath(null);
      setSelectedEntry(null);
      await refreshTree("");
      setStatus("");
    } catch (error) {
      if (deletesCurrent && api) autosave(api.getSceneElements(), api.getAppState(), api.getFiles());
      setStatus(String(error));
    }
  }

  function handleTreeKeyDown(event) {
    if (event.key === "Delete" && !event.repeat && selectedEntry && event.target.tagName !== "INPUT") {
      event.preventDefault();
      deleteEntry(selectedEntry);
    }
  }

  async function save() {
    clearTimeout(autosaveTimer.current);
    const elements = aiPreview.current?.api === api ? aiPreview.current.original : api.getSceneElements();
    const data = serializeAsJSON(reconcileMermaid(elements), api.getAppState(), api.getFiles(), "local");
    await Save(doc.path, data);
    lastSaved.current = data;
    setStatus("Saved");
  }

  function autosave(elements, appState, files) {
    if (aiPreview.current?.api === api) { clearTimeout(autosaveTimer.current); return; }
    const reconciled = reconcileMermaid(elements);
    if (reconciled !== elements && api) {
      api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
      return;
    }
    elements = reconciled;
    const data = serializeAsJSON(elements, appState, files, "local");
    if (data === lastSaved.current) return;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try {
        setStatus("Saving...");
        await Save(doc.path, data);
        lastSaved.current = data;
        setStatus("Saved");
      } catch (error) {
        setStatus(String(error));
      }
    }, 600);
  }

  function renderWorkspacePicker() {
    return <details className="workspace-picker" ref={picker}>
      <summary title={workspace}>
        <strong>{basename(workspace)}</strong>
      </summary>
      <div className="workspace-menu">
        {folders.map((path) => <button
          className={path === workspace ? "current" : ""}
          key={path}
          onClick={() => switchFolder(path)}
          title={path}
        >
          <span>{basename(path)}</span>
        </button>)}
        <hr />
        <button onClick={chooseFolder}>Open Another Folder</button>
      </div>
    </details>;
  }

  function settingsButton() {
    return <button type="button" className="sidebar-toggle settings-button" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings"><SettingsIcon /></button>;
  }

  if (!workspace) return <main className="welcome-shell">
    <Titlebar>{settingsButton()}</Titlebar>
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    <div className="welcome">
      <h1>ExBase</h1>
      <p>Open a folder containing Excalidraw files.</p>
      <button onClick={chooseFolder}>Open Folder</button>
      {status && <p className="error">{status}</p>}
    </div>
  </main>;

  return <main className={`workspace ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
    {sidebarOpen && <aside>
      <div className="sidebar-header">
        {renderWorkspacePicker()}
        {settingsButton()}
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(false)} title="Collapse sidebar" aria-label="Collapse sidebar">
          <PanelLeftIcon />
        </button>
      </div>
      <nav aria-label="Excalidraw files" onContextMenu={(event) => showContextMenu(event)} onKeyDown={handleTreeKeyDown}>
        <FileTree
          entries={entries}
          activePath={doc?.path}
          selectedPath={selectedEntry?.path}
          editingPath={editingPath}
          onOpen={openDocument}
          onSelect={setSelectedEntry}
          onError={setStatus}
          onMenu={showContextMenu}
          onRename={renameEntry}
          onCancelRename={() => setEditingPath(null)}
          refreshKey={refreshKey}
          revealPath={revealPath}
        />
      </nav>
      {contextMenu && <div
        className="context-menu"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {contextMenu.entry
          ? <>
              <button onClick={() => {
                setEditingPath(contextMenu.entry.path);
                setContextMenu(null);
              }}>Rename</button>
              {contextMenu.entry.isDir && <button onClick={() => createDocument(contextMenu.entry.path)}>New Excalidraw File</button>}
              <button onClick={() => deleteEntry(contextMenu.entry)}>Delete</button>
            </>
          : <>
              <button onClick={() => createDocument()}>New Excalidraw File</button>
              <button onClick={() => createFolder()}>New Folder</button>
            </>}
      </div>}
      {status && <small className={status === "Saved" || status === "Saving..." ? "" : "error"}>{status}</small>}
    </aside>}
    <Titlebar>
      {!sidebarOpen && <div className="titlebar-workspace" onDoubleClick={(event) => event.stopPropagation()}>
        {renderWorkspacePicker()}
        {settingsButton()}
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(true)} title="Expand sidebar" aria-label="Expand sidebar">
          <PanelLeftIcon open />
        </button>
      </div>}
    </Titlebar>
    <section className="canvas">
      {doc
        ? <Excalidraw key={`canvas:${doc.path}`} initialData={doc.scene} excalidrawAPI={setApi} onChange={autosave} />
        : <div className="blank" onDoubleClick={() => createDocument()}><p>Select an <PencilRulerIcon /> Excalidraw file from the sidebar.<br />Or double-click to create a new one.</p></div>}
      {doc && <CanvasChat key={`chat:${doc.path}`} doc={doc} api={api} aiPreview={aiPreview} onSettings={() => setSettingsOpen(true)} />}
    </section>
    {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
  </main>;
}
