import React, { useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, PencilRuler, Settings } from "lucide-react";
import { CaptureUpdateAction, Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import {
  ChooseFolder, CreateDocument, CreateFolder, DeleteEntry, OpenDocument, ReadDirectory, Rename, Save, SwitchFolder, Workspaces, LoadGeneralSettings,
} from "../wailsjs/go/main/App";
import { FileTree } from "./workspace/FileTree";
import { Titlebar } from "./workspace/Titlebar";
import { parseScene } from "./canvas/scene";
import { reconcileMermaid } from "./canvas/mermaid";
import { CanvasChat } from "./canvas/CanvasChat";
import { SettingsModal } from "./settings/SettingsModal";
import { SlidePreview } from "./slides/SlidePreview";
import { useRecording } from "./recording/useRecording";
import { NarratedReplay } from "./presentation/NarratedReplay";
import { WebcamBubble } from "./recording/WebcamBubble";
import { RecordingSetup } from "./recording/RecordingSetup";
import { VideoEditor } from "./recording/VideoEditor";

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
  const [replayOpen, setReplayOpen] = useState(false);
  const [recordingSetupOpen, setRecordingSetupOpen] = useState(false);
  const [recordingMode, setRecordingMode] = useState(null);
  const [webcamConfig, setWebcamConfig] = useState({ enabled: false, shape: "circle", position: null });
  const [webcamPreview, setWebcamPreview] = useState(null);
  const picker = useRef();
  const autosaveTimer = useRef();
  const lastSaved = useRef("");
  const aiPreview = useRef(null);
  const chat = useRef(null);
  const { recording, start: startRecording, stop: stopRecording, locked, notice, dismissNotice, recordedVideos, clearRecordedVideos } = useRecording(api, doc, setStatus);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    if (!locked) return;
    setSettingsOpen(false); setContextMenu(null); setEditingPath(null); setSelectedEntry(null); setRecordingSetupOpen(false);
    if (picker.current) picker.current.open = false;
    document.activeElement?.blur();
    const guard = (event) => {
      if (!event.target.closest?.(".canvas, .window-controls, .recording-status")) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    document.addEventListener("keydown", guard, true);
    return () => document.removeEventListener("keydown", guard, true);
  }, [locked]);

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
    if (lockedRef.current) return;
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
    if (lockedRef.current) return;
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
    if (lockedRef.current) return;
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
    if (lockedRef.current) return;
    try {
      if (doc && api) await save();
      const file = await OpenDocument(path);
      if (lockedRef.current) return;
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
    if (lockedRef.current) return;
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
    if (lockedRef.current) return;
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
    if (lockedRef.current) return false;
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
    if (lockedRef.current) { event.preventDefault(); return; }
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
    if (lockedRef.current) return;
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
    return <button type="button" className="sidebar-toggle settings-button" disabled={locked} onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings"><Settings aria-hidden="true" /></button>;
  }

  function recordingStatus() {
    if (recording.phase === "idle") return null;
    const time = `${Math.floor(recording.seconds / 60).toString().padStart(2, "0")}:${(recording.seconds % 60).toString().padStart(2, "0")}`;
    return <button type="button" className="recording-status" disabled={recording.phase !== "recording"} onClick={stopRecording} title="Stop recording" aria-label="Stop recording"><span className="recording-dot" /><span>{recording.phase === "starting" ? "Starting…" : recording.phase === "stopping" ? "Saving…" : time}</span>{recording.phase === "recording" && <span className="recording-stop" aria-hidden="true" />}</button>;
  }

  function handleRecordClick() {
    const mode = generalSettings.recordingMode || "canvas";
    setRecordingMode(mode);
    setRecordingSetupOpen(true);
  }

  function handleRecordingStart(config) {
    setWebcamConfig({
      enabled: config.webcamEnabled,
      shape: config.bubbleShape,
      position: config.bubblePosition
    });
    setRecordingSetupOpen(false);
    startRecording(recordingMode, true, config.webcamEnabled, config);
  }

  function handleRecordingCancel() {
    setRecordingSetupOpen(false);
    setRecordingMode(null);
    setWebcamPreview(null);
  }

  function handleWebcamPreviewChange(config) {
    setWebcamPreview(config);
  }

  if (!workspace) return <main className="welcome-shell">
    <Titlebar>{settingsButton()}{recordingStatus()}</Titlebar>
    {settingsOpen && <SettingsModal generalSettings={generalSettings} onGeneralSettings={setGeneralSettings} recordingActive={recording.phase !== "idle"} onClose={() => setSettingsOpen(false)} />}
    <div className="welcome">
      <h1>ExBase</h1>
      <p>Open a folder containing Excalidraw files.</p>
      <button onClick={chooseFolder}>Open Folder</button>
      {status && <p className="error">{status}</p>}
    </div>
  </main>;

  return <main className={`workspace ${sidebarOpen ? "" : "sidebar-collapsed"} ${slidesOpen ? "slides-open" : ""} ${locked ? "recording-locked" : ""}`}>
    {sidebarOpen && <aside inert={locked ? "" : undefined}>
      <div className="sidebar-header">
        {renderWorkspacePicker()}
        {settingsButton()}
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(false)} title="Collapse sidebar" aria-label="Collapse sidebar">
          <PanelLeftClose aria-hidden="true" />
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
      {slidesOpen ? <span className="slides-document-name">{basename(doc.path)}</span> : !sidebarOpen && <div className="titlebar-workspace" inert={locked ? "" : undefined} onDoubleClick={(event) => event.stopPropagation()}>
        {renderWorkspacePicker()}
        {settingsButton()}
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(true)} title="Expand sidebar" aria-label="Expand sidebar">
          <PanelLeftOpen aria-hidden="true" />
        </button>
      </div>}
      {recordingStatus()}
    </Titlebar>
    <section className="canvas" inert={slidesOpen ? "" : undefined}>
      {doc
        ? <Excalidraw key={`canvas:${doc.path}`} initialData={{ ...doc.scene, scrollToContent: true }} viewModeEnabled={slidesOpen} excalidrawAPI={setApi} onChange={autosave} />
        : <div className="blank" onDoubleClick={() => createDocument()}><p>Select an <PencilRuler className="file-icon" aria-hidden="true" /> Excalidraw file from the sidebar.<br />Or double-click to create a new one.</p></div>}
      {doc && <CanvasChat ref={chat} key={`chat:${doc.path}`} doc={doc} api={api} aiPreview={aiPreview} slidesEnabled={generalSettings?.slidesEnabled} onSlides={() => setSlidesOpen(true)} onReplay={() => setReplayOpen(true)} onSettings={() => { if (!lockedRef.current) setSettingsOpen(true); }} recordingEnabled={generalSettings?.recordingEnabled} recording={recording} onRecord={handleRecordClick} onStopRecording={stopRecording} />}
      {recording.webcamEnabled && <WebcamBubble enabled={recording.webcamEnabled} shape={webcamConfig.shape} initialPosition={webcamConfig.position} />}
    </section>
    {slidesOpen && <SlidePreview api={api} doc={doc} onClose={() => setSlidesOpen(false)} />}
    {replayOpen && api && doc && <NarratedReplay key={doc.path} api={api} doc={doc} onGenerate={(text) => chat.current.generate(text)} onCancel={() => chat.current?.cancel()} onClose={() => setReplayOpen(false)} />}
    {notice && <div className={`recording-notice ${notice.error ? "error" : ""}`} role={notice.error ? "alert" : "status"}><span>{notice.text}</span><button type="button" aria-label="Dismiss recording message" onClick={dismissNotice}>×</button></div>}
    {webcamPreview?.enabled && <WebcamBubble enabled={true} shape={webcamPreview.shape} preview={true} onPositionChange={webcamPreview.onPositionChange} />}
    {recordingSetupOpen && <RecordingSetup mode={recordingMode} onStart={handleRecordingStart} onCancel={handleRecordingCancel} onWebcamChange={handleWebcamPreviewChange} />}
    {recordedVideos.screen && recordedVideos.webcam && (
      <VideoEditor
        screenRecording={recordedVideos.screen}
        webcamRecording={recordedVideos.webcam}
        onClose={clearRecordedVideos}
        onExport={async (config) => {
          console.log("Export with config:", config);
          // TODO: Implement actual video export
          clearRecordedVideos();
        }}
      />
    )}
    {settingsOpen && <SettingsModal generalSettings={generalSettings} onGeneralSettings={setGeneralSettings} recordingActive={recording.phase !== "idle"} onClose={() => setSettingsOpen(false)} />}
  </main>;
}
