import React, { useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, PencilRuler, Settings, X } from "lucide-react";
import { CaptureUpdateAction, Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import {
  ChooseFolder, ConfirmClose, CreateDocument, CreateMarkdown, CreateFolder, DeleteEntry, OpenDocument, ReadDirectory, Rename, Save, SetCloseGuard, SwitchFolder, Workspaces, LoadGeneralSettings,
} from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import { FileTree } from "./workspace/FileTree";
import { Titlebar } from "./workspace/Titlebar";
import { parseScene } from "./canvas/scene";
import { reconcileMermaid } from "./canvas/mermaid";
import { CanvasChat } from "./canvas/CanvasChat";
import { SettingsModal } from "./settings/SettingsModal";
import { SlidePreview } from "./slides/SlidePreview";
import { useRecording } from "./recording/useRecording";
import { NarratedReplay } from "./presentation/NarratedReplay";
import { RecordingSetup } from "./recording/RecordingSetup";
import { VideoEditor } from "./recording/VideoEditor";
import { isMarkdown, MarkdownEditor } from "./markdown/MarkdownEditor";

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
  const [fileBusy, setFileBusy] = useState(false);
  const [markdownError, setMarkdownError] = useState("");
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
  const picker = useRef();
  const autosaveTimer = useRef();
  const lastSaved = useRef("");
  const markdownText = useRef("");
  const saveQueue = useRef(Promise.resolve());
  const saveRevision = useRef(0);
  const saveRef = useRef();
  saveRef.current = save;
  const documentRef = useRef(doc); documentRef.current = doc;
  const canvasRef = useRef(api); canvasRef.current = api;
  const fileOperation = useRef(null);
  const aiPreview = useRef(null);
  const chat = useRef(null);
  const { recording, start: startRecording, stop: stopRecording, locked, notice, dismissNotice, recordedVideos, clearRecordedVideos, saveRecording } = useRecording(api, doc, setStatus);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    let closing = false;
    const unsubscribe = EventsOn("workspace:close-requested", async () => {
      if (closing) return;
      closing = true;
      let started = false;
      try {
        await fileOperation.current?.done;
        started = beginFileOperation();
        if (!started) return;
        await saveRef.current();
        await ConfirmClose();
      } catch (error) {
        setStatus(String(error));
        window.alert(`Could not save the current file. The window will stay open.\n${error}`);
      } finally {
        if (started) endFileOperation();
        closing = false;
      }
    });
    SetCloseGuard(true).catch((error) => setStatus(String(error)));
    return () => { unsubscribe?.(); SetCloseGuard(false).catch(() => {}); };
  }, []);

  function beginFileOperation() {
    if (lockedRef.current || fileOperation.current) return false;
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    fileOperation.current = { done, finish };
    setFileBusy(true);
    return true;
  }

  function endFileOperation() {
    fileOperation.current?.finish();
    fileOperation.current = null;
    setFileBusy(false);
  }

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

  useEffect(() => {
    if (generalSettings?.aiEnabled === false) setReplayOpen(false);
  }, [generalSettings?.aiEnabled]);

  async function applyWorkspace(state) {
    if (lockedRef.current) return;
    clearTimeout(autosaveTimer.current);
    setWorkspace(state.current);
    setFolders(state.folders);
    setEntries([]);
    setDoc(null);
    setApi(null);
    documentRef.current = null;
    canvasRef.current = null;
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
    if (!beginFileOperation()) return;
    if (picker.current) picker.current.open = false;
    try {
      await save();
      const state = await ChooseFolder();
      if (state.current) await applyWorkspace(state);
    } catch (error) {
      setStatus(String(error));
    } finally {
      endFileOperation();
    }
  }

  async function switchFolder(path) {
    if (path === workspace) return;
    if (!beginFileOperation()) return;
    if (picker.current) picker.current.open = false;
    try {
      await save();
      await applyWorkspace(await SwitchFolder(path));
    } catch (error) {
      setStatus(String(error));
    } finally {
      endFileOperation();
    }
  }

  async function openDocument(path) {
    if (!beginFileOperation()) return;
    try {
      await save();
      const file = await OpenDocument(path);
      if (lockedRef.current) return;
      activateDocument(file);
      setStatus("");
    } catch (error) {
      setStatus(String(error));
    } finally {
      endFileOperation();
    }
  }

  function activateDocument(file) {
    clearTimeout(autosaveTimer.current);
    const markdown = isMarkdown(file.path);
    const scene = markdown ? null : parseScene(file.data);
    lastSaved.current = markdown ? file.data : serializeAsJSON(scene.elements, scene.appState || {}, scene.files || {}, "local");
    markdownText.current = markdown ? file.data : "";
    setMarkdownError("");
    setApi(null);
    canvasRef.current = null;
    setSlidesOpen(false);
    setReplayOpen(false);
    const next = markdown ? { path: file.path, content: file.data } : { path: file.path, scene };
    documentRef.current = next;
    setDoc(next);
  }

  async function refreshTree(dir) {
    setEntries(await ReadDirectory(workspace));
    setRefreshKey((value) => value + 1);
    setRevealPath(dir === workspace ? null : dir);
  }

  async function createDocument(dir = workspace, markdown = false) {
    if (!beginFileOperation()) return;
    setContextMenu(null);
    try {
      await save();
      const file = await (markdown ? CreateMarkdown(dir) : CreateDocument(dir));
      await refreshTree(dir);
      activateDocument(file);
      setSelectedEntry({ name: basename(file.path), path: file.path, isDir: false });
      setEditingPath(file.path);
      setStatus("");
    } catch (error) {
      setStatus(String(error));
    } finally {
      endFileOperation();
    }
  }

  async function createFolder(dir = workspace) {
    if (!beginFileOperation()) return;
    setContextMenu(null);
    try {
      const entry = await CreateFolder(dir);
      await refreshTree(dir);
      setSelectedEntry(entry);
      setEditingPath(entry.path);
      setStatus("");
    } catch (error) {
      setStatus(String(error));
    } finally {
      endFileOperation();
    }
  }

  async function renameEntry(entry, name) {
    if (!beginFileOperation()) return false;
    try {
      const containsCurrent = isSameOrChild(doc?.path, entry.path);
      if (containsCurrent) await save();
      const renamed = await Rename(entry.path, name);
      if (containsCurrent) {
        const file = await OpenDocument(renamed.path + doc.path.slice(entry.path.length));
        activateDocument(file);
      }
      setSelectedEntry(renamed);
      setEditingPath(null);
      await refreshTree("");
      setStatus("");
      return true;
    } catch (error) {
      setStatus(String(error));
      return false;
    } finally {
      endFileOperation();
    }
  }

  function showContextMenu(event, entry = null) {
    if (lockedRef.current) { event.preventDefault(); return; }
    event.preventDefault();
    event.stopPropagation();
    setSelectedEntry(entry);
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 170)),
      entry,
    });
  }

  async function deleteEntry(entry) {
    if (lockedRef.current) return;
    setContextMenu(null);
    if (entry.isDir && !window.confirm(`Delete "${entry.name}" and everything inside it?`)) return;
    if (!beginFileOperation()) return;
    const deletesCurrent = isSameOrChild(doc?.path, entry.path);
    if (deletesCurrent) clearTimeout(autosaveTimer.current);
    try {
      await saveQueue.current.catch(() => {});
      await DeleteEntry(entry.path);
      if (deletesCurrent) {
        setDoc(null);
        setApi(null);
        documentRef.current = null;
        canvasRef.current = null;
        lastSaved.current = "";
      }
      if (isSameOrChild(editingPath, entry.path)) setEditingPath(null);
      setSelectedEntry(null);
      await refreshTree("");
      setStatus("");
    } catch (error) {
      if (deletesCurrent && isMarkdown(doc.path)) scheduleSave(doc.path, markdownText.current);
      else if (deletesCurrent && api) autosave(api.getSceneElements(), api.getAppState(), api.getFiles());
      setStatus(String(error));
    } finally {
      endFileOperation();
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
    const revision = ++saveRevision.current;
    const doc = documentRef.current;
    const api = canvasRef.current;
    if (!doc || (!isMarkdown(doc.path) && !api)) return;
    let data = markdownText.current;
    if (!isMarkdown(doc.path)) {
      const elements = aiPreview.current?.api === api ? aiPreview.current.original : api.getSceneElements();
      data = serializeAsJSON(reconcileMermaid(elements), api.getAppState(), api.getFiles(), "local");
    }
    await persist(doc.path, data);
    if (saveRevision.current === revision) {
      lastSaved.current = data;
      setStatus("Saved");
    }
  }

  function persist(path, data) {
    const pending = saveQueue.current.catch(() => {}).then(() => Save(path, data));
    saveQueue.current = pending;
    return pending.then(() => {
      if (documentRef.current?.path === path) setMarkdownError("");
    }, (error) => {
      if (isMarkdown(path) && documentRef.current?.path === path) setMarkdownError(String(error));
      throw error;
    });
  }

  function saveNow() {
    save().catch((error) => setStatus(String(error)));
  }

  function changeMarkdown(content) {
    markdownText.current = content;
    setDoc((current) => ({ ...current, content }));
    setStatus("Unsaved");
    scheduleSave(doc.path, content);
  }

  function scheduleSave(path, data) {
    clearTimeout(autosaveTimer.current);
    const revision = ++saveRevision.current;
    autosaveTimer.current = setTimeout(async () => {
      try {
        setStatus("Saving...");
        await persist(path, data);
        if (saveRevision.current === revision) {
          lastSaved.current = data;
          setStatus("Saved");
        }
      } catch (error) {
        setStatus(String(error));
      }
    }, 600);
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
    scheduleSave(doc.path, data);
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
    setRecordingSetupOpen(false);
    startRecording(recordingMode, true, config.webcamEnabled);
  }

  function handleRecordingCancel() {
    setRecordingSetupOpen(false);
    setRecordingMode(null);
  }

  if (!workspace) return <main className="welcome-shell">
    <Titlebar>{settingsButton()}{recordingStatus()}</Titlebar>
    {settingsOpen && <SettingsModal generalSettings={generalSettings} onGeneralSettings={setGeneralSettings} recordingActive={recording.phase !== "idle"} onClose={() => setSettingsOpen(false)} />}
    <div className="welcome">
      <h1>ExBase</h1>
      <p>Open a folder containing Excalidraw or Markdown files.</p>
      <button onClick={chooseFolder}>Open Folder</button>
      {status && <p className="error">{status}</p>}
    </div>
  </main>;

  return <main className={`workspace ${sidebarOpen ? "" : "sidebar-collapsed"} ${slidesOpen ? "slides-open" : ""} ${locked ? "recording-locked" : ""}`}>
    {sidebarOpen && <aside inert={locked || fileBusy ? "" : undefined}>
      <div className="sidebar-header">
        {renderWorkspacePicker()}
        {settingsButton()}
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(false)} title="Collapse sidebar" aria-label="Collapse sidebar">
          <PanelLeftClose aria-hidden="true" />
        </button>
      </div>
      <nav aria-label="Workspace files" onContextMenu={(event) => showContextMenu(event)} onKeyDown={handleTreeKeyDown}>
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
              {contextMenu.entry.isDir && <button onClick={() => createDocument(contextMenu.entry.path, true)}>New Markdown File</button>}
              {contextMenu.entry.isDir && <button onClick={() => createFolder(contextMenu.entry.path)}>New Folder</button>}
              <button onClick={() => deleteEntry(contextMenu.entry)}>Delete</button>
            </>
          : <>
              <button onClick={() => createDocument()}>New Excalidraw File</button>
              <button onClick={() => createDocument(workspace, true)}>New Markdown File</button>
              <button onClick={() => createFolder()}>New Folder</button>
            </>}
      </div>}
    </aside>}
    <Titlebar>
      {slidesOpen ? <span className="slides-document-name">{basename(doc.path)}</span> : !sidebarOpen && <div className="titlebar-workspace" inert={locked || fileBusy ? "" : undefined} onDoubleClick={(event) => event.stopPropagation()}>
        {renderWorkspacePicker()}
        {settingsButton()}
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(true)} title="Expand sidebar" aria-label="Expand sidebar">
          <PanelLeftOpen aria-hidden="true" />
        </button>
      </div>}
      {isMarkdown(doc?.path) && <span className="markdown-document-name">{basename(doc.path)}</span>}
      {recordingStatus()}
    </Titlebar>
    <section className="canvas" aria-busy={fileBusy} inert={slidesOpen || fileBusy ? "" : undefined}>
      {doc
        ? isMarkdown(doc.path)
          ? <MarkdownEditor key={`markdown:${doc.path}`} content={doc.content} onChange={changeMarkdown} onSave={saveNow} error={markdownError} />
          : <Excalidraw key={`canvas:${doc.path}`} initialData={{ ...doc.scene, scrollToContent: true }} viewModeEnabled={slidesOpen} excalidrawAPI={setApi} onChange={autosave} />
        : <div className="blank" onDoubleClick={() => createDocument()}><p>Select an <PencilRuler className="file-icon" aria-hidden="true" /> Excalidraw or Markdown file from the sidebar.<br />Right-click the sidebar to create a file.</p></div>}
      {doc && !isMarkdown(doc.path) && <CanvasChat ref={chat} key={`chat:${doc.path}`} doc={doc} api={api} aiEnabled={!!generalSettings && generalSettings.aiEnabled !== false} aiPreview={aiPreview} slidesEnabled={generalSettings?.slidesEnabled} onSlides={() => setSlidesOpen(true)} onReplay={() => setReplayOpen(true)} onSettings={() => { if (!lockedRef.current) setSettingsOpen(true); }} recordingEnabled={generalSettings?.recordingEnabled} recording={recording} onRecord={handleRecordClick} onStopRecording={stopRecording} />}
    </section>
    {slidesOpen && <SlidePreview api={api} doc={doc} onClose={() => setSlidesOpen(false)} />}
    {replayOpen && generalSettings?.aiEnabled !== false && api && doc && <NarratedReplay key={doc.path} api={api} doc={doc} onGenerate={(text) => chat.current.generate(text)} onCancel={() => chat.current?.cancel()} onClose={() => setReplayOpen(false)} />}
    {notice && <div className={`recording-notice ${notice.error ? "error" : ""}`} role={notice.error ? "alert" : "status"}><span>{notice.text}</span><button type="button" aria-label="Dismiss recording message" onClick={dismissNotice}><X aria-hidden="true" /></button></div>}
    {recordingSetupOpen && <RecordingSetup onStart={handleRecordingStart} onCancel={handleRecordingCancel} />}
    {recordedVideos.screen && (
      <VideoEditor
        screenRecording={recordedVideos.screen}
        webcamRecording={recordedVideos.webcam}
        document={recordedVideos.document}
        onClose={clearRecordedVideos}
        onExport={saveRecording}
      />
    )}
    {settingsOpen && <SettingsModal generalSettings={generalSettings} onGeneralSettings={setGeneralSettings} recordingActive={recording.phase !== "idle"} onClose={() => setSettingsOpen(false)} />}
  </main>;
}
