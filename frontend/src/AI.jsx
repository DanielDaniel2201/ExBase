import React, { useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, convertToExcalidrawElements, exportToBlob, restore, serializeAsJSON } from "@excalidraw/excalidraw";
import { AskAI, CancelAI, CreateAISession, LoadAISettings, SaveAISettings, ResolveAICanvas } from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import { materializeCanvas, reconcileMermaid, renderMermaid } from "./mermaid";
import { sceneSignature, splitMCPElements } from "./scene";

// Lucide Settings (ISC), kept inline like the existing sidebar icons.
export function SettingsIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831 2.34 2.34 0 0 1 2.33-4.033 2.34 2.34 0 0 0 3.32-1.915" />
    <circle cx="12" cy="12" r="3" />
  </svg>;
}

export function SettingsModal({ onClose }) {
  const dialog = useRef();
  const [page, setPage] = useState("home");
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current.showModal();
    LoadAISettings().then((settings) => setConfigured(settings.hasAPIKey)).catch((error) => setError(String(error)));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError("");
    try { await SaveAISettings(key); setKey(""); onClose(); }
    catch (error) { setError(String(error)); }
    finally { setSaving(false); }
  }

  return <dialog ref={dialog} className="settings-modal" onCancel={onClose} onClick={(event) => { if (event.target === dialog.current) onClose(); }} aria-labelledby="settings-title">
    <header className="settings-heading">
      {page !== "home" && <button type="button" className="settings-back" onClick={() => { setPage("home"); setKey(""); }} aria-label="Back to settings">←</button>}
      <h2 id="settings-title">{page === "home" ? "Settings" : "Model Provider"}</h2>
      <button type="button" className="settings-close" onClick={onClose} aria-label="Close settings">×</button>
    </header>
    {page === "home" ? <div className="settings-body">
      <small className="settings-section-label">AI</small>
      <button type="button" className="settings-entry" onClick={() => setPage("provider")}><span>Model Provider</span><span aria-hidden="true">›</span></button>
      {error && <p role="alert" className="error">{error}</p>}
    </div> : <form className="settings-body" onSubmit={submit}>
      <label htmlFor="deepseek-key">DeepSeek API Key</label>
      <div className="api-key-field">
        <input id="deepseek-key" autoFocus type={showKey ? "text" : "password"} value={key} onChange={(event) => setKey(event.target.value)} placeholder={configured ? "Configured · enter a new key to replace" : "Enter your DeepSeek API key"} autoComplete="off" spellCheck={false} required={!configured} disabled={saving} aria-describedby="provider-note" />
        <button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "Hide API key" : "Show API key"}>{showKey ? "Hide" : "Show"}</button>
      </div>
      <p id="provider-note" className="settings-note">Uses DeepSeek Flash through the official DeepSeek API. Your key is saved locally in ~/.exbase/auth.json.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <footer className="settings-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button></footer>
    </form>}
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

export function CanvasChat({ doc, api, onSettings }) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checkpoint = useRef("");
  const session = useRef("");
  const request = useRef(0);
  const running = useRef(false);
  const transcript = useRef();
  const currentAPI = useRef(api);
  const canvasJob = useRef(null);
  currentAPI.current = api;

  useEffect(() => () => { request.current++; if (running.current) CancelAI(); }, []);
  useEffect(() => EventsOn("ai:canvas", async (job) => {
    const turn = canvasJob.current;
    if (!turn) return;
    try {
      if (turn.id !== request.current || currentAPI.current !== turn.api || sceneSignature(turn.api.getSceneElements()) !== turn.signature) throw new Error("The canvas changed while AI was working. Send your request again.");
      const elements = job.kind === "mermaid" ? await renderMermaid(job) : await materializeCanvas(job.elements, job.previous);
      if (turn.id !== request.current || currentAPI.current !== turn.api || sceneSignature(turn.api.getSceneElements()) !== turn.signature) throw new Error("The canvas changed while AI was working. Send your request again.");
      await ResolveAICanvas(job.id, JSON.stringify(elements), "");
    } catch (error) { await ResolveAICanvas(job.id, "", String(error)); }
  }), []);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [messages, expanded, busy]);

  function cancel() { request.current++; CancelAI(); running.current = false; setBusy(false); setError("Request cancelled"); }

  async function newChat() {
    const id = ++request.current;
    const wasRunning = running.current;
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
      const result = await AskAI(doc.path, scene, checkpoint.current, text, screenshot, messages.slice(-12), session.current);
      if (id !== request.current) return;
      if (currentAPI.current !== api) throw new Error("The document changed. Send your request again.");
      if (sceneSignature(api.getSceneElements()) !== signature) {
        checkpoint.current = "";
        throw new Error("The canvas changed while AI was working. Your edits were kept; send your request again.");
      }
      if (result.elements) {
        const { standard, shorthand } = splitMCPElements(result.elements);
        const converted = convertToExcalidrawElements(shorthand, { regenerateIds: false });
        const updated = reconcileMermaid(restore({ elements: [...standard, ...converted] }, null, null, { repairBindings: true }).elements, elements);
        api.updateScene({ elements: updated, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        const previousDiagrams = new Set(elements.map((element) => element.customData?.exbaseMermaid?.id).filter(Boolean));
        const created = updated.filter((element) => element.customData?.exbaseMermaid?.active && !previousDiagrams.has(element.customData.exbaseMermaid.id));
        if (created.length) api.scrollToContent(created, { fitToContent: true, animate: true });
      }
      checkpoint.current = result.checkpointId;
      setMessages((previous) => [...previous, { role: "assistant", content: result.reply || "Canvas updated.", reasoning_content: result.reasoningContent || "" }]);
    } catch (error) { if (id === request.current) { setError(String(error)); setPrompt(text); } }
    finally { if (canvasJob.current?.id === id) canvasJob.current = null; if (id === request.current) { running.current = false; setBusy(false); } }
  }

  const lastReply = [...messages].reverse().find((message) => message.role === "assistant")?.content;
  return <div className="canvas-chat">
    {expanded && <div className="chat-transcript" ref={transcript} role="log" aria-label="AI conversation">
      <div className="chat-transcript-heading"><span>DeepSeek Flash</span><button type="button" onClick={() => setExpanded(false)} aria-label="Close conversation">×</button></div>
      {!messages.length && <p className="chat-empty">Ask about this canvas or describe an edit.</p>}
      {messages.map((message, index) => <div key={index} className={`chat-message ${message.role}`}><small>{message.role === "user" ? "You" : "AI"}</small><p>{message.content}</p></div>)}
      {busy && <p className="chat-empty" role="status">Working…</p>}
    </div>}
    {error && <div className="chat-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    <div className="chat-composer">
      <form className="chat-input-bar" onSubmit={send}>
      <button type="button" className="chat-history-button" onClick={() => setExpanded(!expanded)} aria-label="Toggle conversation" aria-expanded={expanded} title={lastReply || "Conversation"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        {lastReply && !expanded && <span className="chat-reply-dot" />}
      </button>
      <input aria-label="Message DeepSeek" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={busy ? "AI is working on this canvas…" : "Ask AI about this canvas…"} disabled={busy || !api} maxLength={16000} />
      {busy ? <button type="button" onClick={cancel} aria-label="Cancel AI request">Stop</button> : <button type="submit" disabled={!api || !prompt.trim()} aria-label="Send message" title="Send message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" /></svg>
      </button>}
      </form>
      <button type="button" className="chat-new-button" onClick={newChat} disabled={!api} aria-label="New chat" title="New chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
      </button>
    </div>
    <span className="sr-only" role="status">{busy ? "AI is working" : lastReply}</span>
  </div>;
}
