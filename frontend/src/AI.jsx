import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CaptureUpdateAction, convertToExcalidrawElements, exportToBlob, hashString, restore, serializeAsJSON } from "@excalidraw/excalidraw";
import { AskAI, CancelAI, CreateAISession, LoadAISettings, SaveAISettings, ResolveAICanvas } from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import { materializeCanvas, reconcileMermaid, renderMermaid } from "./mermaid";
import { nextPreviewElements, rebasePreviewEdits, sceneSignature, splitMCPElements } from "./scene";

// Lucide Settings (ISC), kept inline like the existing sidebar icons.
export function SettingsIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831 2.34 2.34 0 0 1 2.33-4.033 2.34 2.34 0 0 0 3.32-1.915" />
    <circle cx="12" cy="12" r="3" />
  </svg>;
}

export function SettingsModal({ onClose }) {
  const dialog = useRef();
  const savedKey = useRef("");
  const savePromise = useRef(null);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current.showModal();
    LoadAISettings().then((settings) => {
      savedKey.current = settings.apiKey || "";
      setKey(savedKey.current);
    }).catch((error) => setError(String(error)));
  }, []);

  async function save() {
    const value = key.trim();
    if (value === savedKey.current) return true;
    if (!value) { setError("Enter your DeepSeek API key"); return false; }
    if (savePromise.current) return savePromise.current;
    setSaving(true); setError("");
    savePromise.current = SaveAISettings(value, "high")
      .then(() => { savedKey.current = value; setKey(value); return true; })
      .catch((error) => { setError(String(error)); return false; })
      .finally(() => { setSaving(false); savePromise.current = null; });
    return savePromise.current;
  }

  async function close() {
    if (await save()) onClose();
  }

  return <dialog ref={dialog} className="settings-modal" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialog.current) close(); }} aria-labelledby="settings-title">
    <header className="settings-heading">
      <h2 id="settings-title">Settings</h2>
      <button type="button" className="settings-close" onClick={close} aria-label="Close settings">×</button>
    </header>
    <div className="settings-content">
      <nav className="settings-nav" aria-label="Settings sections"><button type="button" className="active" aria-current="page">AI</button></nav>
      <div className="settings-panel">
        <h3>Model Provider</h3>
        <label htmlFor="deepseek-key">DeepSeek API Key</label>
        <div className="api-key-field">
          <input id="deepseek-key" type={showKey ? "text" : "password"} value={key} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setKey(event.target.value)} onBlur={save} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} placeholder="Enter your DeepSeek API key" autoComplete="off" spellCheck={false} disabled={saving} />
          <button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}>
            {showKey
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2 2 20 20" /><path d="M6.71 6.71C4.7 8.1 3.17 9.94 2.06 11.65a1 1 0 0 0 0 .7C4.01 15.36 7.57 19 12 19c1.44 0 2.77-.38 3.96-.99" /><path d="M10.73 5.08A7 7 0 0 1 12 5c4.43 0 7.99 3.64 9.94 6.65a1 1 0 0 1 0 .7 11.8 11.8 0 0 1-1.32 1.74" /><path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" /></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7C4.01 8.64 7.57 5 12 5s7.99 3.64 9.94 6.65a1 1 0 0 1 0 .7C19.99 15.36 16.43 19 12 19S4.01 15.36 2.06 12.35" /><circle cx="12" cy="12" r="3" /></svg>}
          </button>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </div>
  </dialog>;
}

function blobDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read canvas screenshot"));
    reader.readAsDataURL(blob);
  });
}

function restoreMCPElements(elements) {
  const { standard, shorthand } = splitMCPElements(elements);
  const converted = convertToExcalidrawElements(shorthand.map((element) => ({ ...element, seed: element.seed ?? hashString(element.id), ...(element.label && { label: { ...element.label, id: element.label.id ?? `ai-label-${element.id}` } }) })), { regenerateIds: false });
  return restore({ elements: [...standard, ...converted] }, null, null, { repairBindings: true }).elements;
}

export function CanvasChat({ doc, api, aiPreview, onSettings }) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState("fast");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const playback = useRef(null);
  const checkpoint = useRef("");
  const session = useRef("");
  const request = useRef(0);
  const running = useRef(false);
  const transcript = useRef();
  const historyButton = useRef();
  const currentAPI = useRef(api);
  const canvasJob = useRef(null);
  currentAPI.current = api;

  useEffect(() => () => { request.current++; if (running.current) CancelAI(); clearPreview(false); }, []);
  useEffect(() => EventsOn("ai:canvas", async (job) => {
    const turn = canvasJob.current;
    if (!turn) return;
    const unchanged = () => turn.id === request.current && currentAPI.current === turn.api && (playback.current
      ? sceneSignature(turn.api.getSceneElementsIncludingDeleted()) === sceneSignature(playback.current.shown)
      : sceneSignature(turn.api.getSceneElements()) === turn.signature);
    try {
      if (!unchanged()) throw new Error("The canvas changed while AI was working. Send your request again.");
      const elements = job.kind === "mermaid" ? await renderMermaid(job) : await materializeCanvas(job.elements, job.previous);
      if (!unchanged()) throw new Error("The canvas changed while AI was working. Send your request again.");
      await ResolveAICanvas(job.id, JSON.stringify(elements), "");
    } catch (error) { await ResolveAICanvas(job.id, "", String(error)); }
  }), []);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [messages, expanded, busy]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event) => {
      if (!transcript.current?.contains(event.target) && !historyButton.current?.contains(event.target)) setExpanded(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [expanded]);

  function clearPreview(rollback = true) {
    const state = playback.current;
    if (!state) return;
    clearTimeout(state.timer);
    state.unwatch();
    playback.current = null;
    if (aiPreview.current === state) aiPreview.current = null;
    if (rollback) {
      const elements = rebasePreviewEdits(state.original, state.shown, state.api.getSceneElementsIncludingDeleted());
      state.api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    }
    state.resolve?.();
    setPreviewing(false);
  }

  function cancel(message = "Request cancelled") { request.current++; CancelAI(); clearPreview(); running.current = false; setBusy(false); setError(message); }

  async function newChat() {
    if (!messages.length) return;
    const id = ++request.current;
    const wasRunning = running.current;
    clearPreview();
    running.current = true; setBusy(true);
    try {
      if (wasRunning) await CancelAI();
      const sessionID = await CreateAISession(doc.path);
      if (id !== request.current) return;
      session.current = sessionID;
      checkpoint.current = "";
      setMessages([]); setPrompt(""); setError(""); setExpanded(false);
    } catch (error) { if (id === request.current) setError(String(error)); }
    finally { if (id === request.current) { running.current = false; setBusy(false); } }
  }

  async function send(event) {
    event.preventDefault();
    if (!api || running.current || !prompt.trim()) return;
    const id = ++request.current;
    running.current = true; setBusy(true); setError("");
    const text = prompt.trim();
    let unsubscribe;
    try {
      const settings = await LoadAISettings();
      if (id !== request.current) return;
      if (!settings.hasAPIKey) { onSettings(); return; }
      const originalElements = api.getSceneElements();
      const elements = reconcileMermaid(originalElements);
      const signature = sceneSignature(originalElements);
      const files = api.getFiles();
      const appState = api.getAppState();
      const scene = serializeAsJSON(elements, appState, files, "local");
      let screenshot = "";
      if (elements.length) {
        const blob = await exportToBlob({ elements, files, appState: { ...appState, exportBackground: true, exportWithDarkMode: false }, maxWidthOrHeight: 1280, mimeType: "image/png" });
        screenshot = await blobDataURL(blob);
      }
      if (id !== request.current) return;
      if (!session.current) {
        const sessionID = await CreateAISession(doc.path);
        if (id !== request.current) return;
        session.current = sessionID;
      }
      setPrompt("");
      setMessages((previous) => [...previous, { role: "user", content: text }]);
      canvasJob.current = { id, api, signature };
      const requestID = `${session.current}-${id}`;
      function tick() {
        const state = playback.current;
        if (!state || id !== request.current) return;
        const next = nextPreviewElements(state.shown, state.target);
        if (!next) { state.timer = null; state.resolve?.(); state.resolve = null; return; }
        state.applying = true;
        api.updateScene({ elements: structuredClone(next), captureUpdate: CaptureUpdateAction.NEVER });
        state.shown = structuredClone(api.getSceneElementsIncludingDeleted());
        state.applying = false;
        state.timer = setTimeout(tick, 140);
      }
      function queuePreview(target) {
        if (id !== request.current || currentAPI.current !== api) return;
        if (!playback.current) {
          if (sceneSignature(api.getSceneElements()) !== signature) return;
          const original = structuredClone(api.getSceneElementsIncludingDeleted());
          const state = { api, original, shown: original, target, timer: null, applying: false, unwatch: () => {} };
          playback.current = state;
          aiPreview.current = state;
          state.unwatch = api.onChange(() => {
            if (!state.applying && playback.current === state && sceneSignature(api.getSceneElementsIncludingDeleted()) !== sceneSignature(state.shown)) cancel("The canvas changed while AI was working. Your edits were kept.");
          });
          setPreviewing(true);
        }
        playback.current.target = target;
        if (!playback.current.timer) tick();
      }
      unsubscribe = EventsOn("ai:preview", (update) => {
        if (update.requestId !== requestID || update.path !== doc.path || id !== request.current || !running.current || currentAPI.current !== api) return;
        try {
          queuePreview(restoreMCPElements(update.elements));
        } catch {
          // A partial preview may have unresolved bindings; the final result is validated below.
        }
      });
      const result = await AskAI(doc.path, scene, checkpoint.current, text, screenshot, messages.slice(-12), session.current, requestID, mode === "fast" ? "none" : "high");
      if (id !== request.current) return;
      if (currentAPI.current !== api) throw new Error("The document changed. Send your request again.");
      if (!playback.current && sceneSignature(api.getSceneElements()) !== signature) {
        checkpoint.current = "";
        throw new Error("The canvas changed while AI was working. Your edits were kept; send your request again.");
      }
      if (result.elements) {
        const updated = reconcileMermaid(restoreMCPElements(result.elements), elements);
        queuePreview(updated);
        if (playback.current?.timer) await new Promise((resolve) => { playback.current.resolve = resolve; });
        if (id !== request.current || currentAPI.current !== api) return;
        // Reset the history baseline synchronously, then commit the complete AI edit once.
        flushSync(() => clearPreview());
        api.updateScene({ elements: updated, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        const previousDiagrams = new Set(elements.map((element) => element.customData?.exbaseMermaid?.id).filter(Boolean));
        const created = updated.filter((element) => element.customData?.exbaseMermaid?.active && !previousDiagrams.has(element.customData.exbaseMermaid.id));
        if (created.length && !elements.length) api.scrollToContent(created, { fitToContent: true, animate: true });
      }
      checkpoint.current = result.checkpointId;
      setMessages((previous) => [...previous, { role: "assistant", content: result.reply || "Canvas updated.", reasoning_content: result.reasoningContent || "" }]);
    } catch (error) { if (id === request.current) { setError(String(error)); setPrompt(text); } }
    finally { unsubscribe?.(); if (canvasJob.current?.id === id) canvasJob.current = null; if (id === request.current) { clearPreview(); running.current = false; setBusy(false); } }
  }

  const lastReply = [...messages].reverse().find((message) => message.role === "assistant")?.content;
  return <div className="canvas-chat">
    {expanded && <div className="chat-transcript" ref={transcript} role="log" aria-label="AI conversation">
      {!messages.length && <p className="chat-empty">Ask about this canvas or describe an edit.</p>}
      {messages.map((message, index) => <div key={index} className={`chat-message ${message.role}`}><small>{message.role === "user" ? "You" : "AI"}</small><p>{message.content}</p></div>)}
      {busy && <p className="chat-empty" role="status">{previewing ? "Drawing…" : "Working…"}</p>}
    </div>}
    {error && <div className="chat-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    <div className="chat-composer">
      <button ref={historyButton} type="button" className="chat-side-button chat-history-button" onClick={() => setExpanded(!expanded)} aria-label="Toggle conversation" aria-expanded={expanded} title={lastReply || "Conversation"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        {lastReply && !expanded && <span className="chat-reply-dot" />}
      </button>
      <form className="chat-input-bar" onSubmit={send}>
      <input aria-label="Message DeepSeek" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={busy ? (previewing ? "Drawing on this canvas…" : "AI is working on this canvas…") : "Ask AI about this canvas…"} disabled={busy || !api} maxLength={16000} />
      <button type="button" className="chat-mode-button" onClick={() => setMode(mode === "fast" ? "stable" : "fast")} disabled={busy || !api} aria-label={`AI mode: ${mode}`} aria-pressed={mode === "stable"} title={mode === "fast" ? "Fast: no thinking" : "Stable: high thinking"}>{mode}</button>
      {busy ? <button type="button" onClick={() => cancel()} aria-label="Cancel AI request">Stop</button> : <button type="submit" disabled={!api || !prompt.trim()} aria-label="Send message" title="Send message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" /></svg>
      </button>}
      </form>
      <button type="button" className="chat-side-button" onClick={newChat} disabled={!api || !messages.length} aria-label="New chat" title="New chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
      </button>
    </div>
    <span className="sr-only" role="status">{busy ? "AI is working" : lastReply}</span>
  </div>;
}
