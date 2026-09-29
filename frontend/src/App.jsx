import React, { useEffect, useRef, useState } from "react";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import {
  ChooseFolder, OpenDocument, ReadDirectory, Save, SwitchFolder, Workspaces,
} from "../wailsjs/go/main/App";
import { Quit, WindowMinimise, WindowToggleMaximise } from "../wailsjs/runtime/runtime";
import { parseScene } from "./scene";

function basename(path) {
  return path.split(/[\\/]/).pop();
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

function TreeNode({ entry, activePath, onOpen, onError }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState(null);

  async function activate() {
    if (!entry.isDir) return onOpen(entry.path);
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      try {
        setChildren(await ReadDirectory(entry.path));
      } catch (error) {
        setOpen(false);
        onError(String(error));
      }
    }
  }

  return <li>
    <button
      className={`tree-row ${entry.path === activePath ? "active" : ""}`}
      onClick={activate}
      title={entry.path}
    >
      {entry.isDir
        ? <FolderIcon open={open} />
        : <PencilRulerIcon />}
      <span className="tree-name">{entry.name}</span>
    </button>
    {entry.isDir && open && <FileTree entries={children || []} activePath={activePath} onOpen={onOpen} onError={onError} />}
  </li>;
}

function FileTree(props) {
  if (!props.entries.length) return <ul className="tree empty-tree"><li>Empty</li></ul>;
  return <ul className="tree">{props.entries.map((entry) => <TreeNode key={entry.path} entry={entry} {...props} />)}</ul>;
}

function Titlebar() {
  return <header className="titlebar" onDoubleClick={WindowToggleMaximise}>
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
  const picker = useRef();
  const autosaveTimer = useRef();
  const lastSaved = useRef("");

  useEffect(() => {
    Workspaces().then((state) => state.current && applyWorkspace(state)).catch((error) => setStatus(String(error)));
    function closePicker(event) {
      if (picker.current?.open && !picker.current.contains(event.target)) picker.current.open = false;
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

  async function save() {
    clearTimeout(autosaveTimer.current);
    const data = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
    await Save(doc.path, data);
    lastSaved.current = data;
    setStatus("Saved");
  }

  function autosave(elements, appState, files) {
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

  if (!workspace) return <main className="welcome-shell">
    <Titlebar />
    <div className="welcome">
      <h1>ExBase</h1>
      <p>Open a folder containing Excalidraw files.</p>
      <button onClick={chooseFolder}>Open Folder</button>
      {status && <p className="error">{status}</p>}
    </div>
  </main>;

  return <main className="workspace">
    <aside>
      <details className="workspace-picker" ref={picker}>
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
      </details>
      <nav aria-label="Excalidraw files">
        <FileTree entries={entries} activePath={doc?.path} onOpen={openDocument} onError={setStatus} />
      </nav>
      {status && <small className={status === "Saved" || status === "Saving..." ? "" : "error"}>{status}</small>}
    </aside>
    <Titlebar />
    <section className="canvas">
      {doc
        ? <Excalidraw key={doc.path} initialData={doc.scene} excalidrawAPI={setApi} onChange={autosave} />
        : <div className="blank"><p>Select an Excalidraw file from the sidebar.</p></div>}
    </section>
  </main>;
}
