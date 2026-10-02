import React, { useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import {
  ChooseFolder, CreateDocument, CreateFolder, DeleteEntry, OpenDocument, ReadDirectory, Rename, Save, SwitchFolder, Workspaces, LoadGeneralSettings,
} from "../wailsjs/go/main/App";
import { FileTree, PencilRulerIcon } from "./workspace/FileTree";
import { Titlebar, PanelLeftIcon } from "./workspace/Titlebar";
import { parseScene } from "./canvas/scene";
import { reconcileMermaid } from "./canvas/mermaid";
import { CanvasChat } from "./canvas/CanvasChat";
import { SettingsIcon, SettingsModal } from "./settings/SettingsModal";
import { SlidePreview } from "./slides/SlidePreview";

function basename(path) {
  return path.split(/[\\/]/).pop();
}

function isSameOrChild(path, parent) {
  path = path?.toLowerCase();
  parent = parent.toLowerCase();
  return path === parent || path?.startsWith(parent + "\\") || path?.startsWith(parent + "/");
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
  const [generalSettings, setGeneralSettings] = useState(null);
  const [slidesOpen, setSlidesOpen] = useState(false);
  const picker = useRef();
  const autosaveTimer = useRef();
  const lastSaved = useRef("");
  const aiPreview = useRef(null);

  useEffect(() => {
    LoadGeneralSettings().then(setGeneralSettings).catch((error) => setStatus(String(error)));
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
    {settingsOpen && <SettingsModal generalSettings={generalSettings} onGeneralSettings={setGeneralSettings} onClose={() => setSettingsOpen(false)} />}
    <div className="welcome">
      <h1>ExBase</h1>
      <p>Open a folder containing Excalidraw files.</p>
      <button onClick={chooseFolder}>Open Folder</button>
      {status && <p className="error">{status}</p>}
    </div>
  </main>;

  return <main className={`workspace ${sidebarOpen ? "" : "sidebar-collapsed"} ${slidesOpen ? "slides-open" : ""}`}>
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
      {slidesOpen ? <span className="slides-document-name">{basename(doc.path)}</span> : !sidebarOpen && <div className="titlebar-workspace" onDoubleClick={(event) => event.stopPropagation()}>
        {renderWorkspacePicker()}
        {settingsButton()}
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(true)} title="Expand sidebar" aria-label="Expand sidebar">
          <PanelLeftIcon open />
        </button>
      </div>}
    </Titlebar>
    <section className="canvas" inert={slidesOpen ? "" : undefined}>
      {doc
        ? <Excalidraw key={`canvas:${doc.path}`} initialData={{ ...doc.scene, scrollToContent: true }} viewModeEnabled={slidesOpen} excalidrawAPI={setApi} onChange={autosave} />
        : <div className="blank" onDoubleClick={() => createDocument()}><p>Select an <PencilRulerIcon /> Excalidraw file from the sidebar.<br />Or double-click to create a new one.</p></div>}
      {doc && <CanvasChat key={`chat:${doc.path}`} doc={doc} api={api} aiPreview={aiPreview} slidesEnabled={generalSettings?.slidesEnabled} onSlides={() => setSlidesOpen(true)} onSettings={() => setSettingsOpen(true)} />}
    </section>
    {slidesOpen && <SlidePreview api={api} doc={doc} onClose={() => setSlidesOpen(false)} />}
    {settingsOpen && <SettingsModal generalSettings={generalSettings} onGeneralSettings={setGeneralSettings} onClose={() => setSettingsOpen(false)} />}
  </main>;
}
