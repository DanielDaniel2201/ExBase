import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CaptureUpdateAction, convertToExcalidrawElements, exportToBlob, hashString, restore, serializeAsJSON } from "@excalidraw/excalidraw";
import { AskAI, CancelAI, CreateAISession, LoadAISettings, ResolveAICanvas, LoadPromptTemplates } from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { materializeCanvas, reconcileMermaid, renderMermaid } from "./mermaid";
import { nextPreviewElements, rebasePreviewEdits, sceneSignature, splitMCPElements } from "./scene";
import { matchingTemplates, firstBlank } from "../settings/templates";
import { slideFrames } from "../slides/slides";

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

export const CanvasChat = forwardRef(function CanvasChat({ doc, api, aiPreview, onSettings, slidesEnabled, onSlides, onReplay, recordingEnabled, recording, onRecord, onStopRecording }, ref) {
  const [prompt, setPrompt] = useState("");
  const [templates, setTemplates] = useState([]);
  const [templateIndex, setTemplateIndex] = useState(0);
  const [templateMenu, setTemplateMenu] = useState(false);
  const composerInput = useRef();
  const [slidesReady, setSlidesReady] = useState(false);
  const [addonsOpen, setAddonsOpen] = useState(false);
  const addons = useRef();
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

  const recordingActive = recording.phase !== "idle";
  const addonsAvailable = !!api;
  useImperativeHandle(ref, () => ({ generate: (text) => send(null, text), cancel: () => cancel() }));
  useEffect(() => {
    if (!addonsOpen) return;
    if (!addonsAvailable) { setAddonsOpen(false); return; }
    const close = (event) => { if (!addons.current?.contains(event.target)) setAddonsOpen(false); };
    const escape = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAddonsOpen(false); addons.current?.querySelector("button")?.focus(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && addons.current?.contains(event.target)) {
        event.preventDefault(); event.stopPropagation();
        const items = [...addons.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
        if (!items.length) return;
        const index = items.indexOf(document.activeElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : index < 0 ? (event.key === "ArrowUp" ? items.length - 1 : 0) : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length].focus();
      }
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", escape, true); };
  }, [addonsOpen, addonsAvailable]);

  useEffect(() => {
    if (!api || !slidesEnabled) { setSlidesReady(false); return; }
    const update = (elements) => setSlidesReady(slideFrames(elements).length > 0);
    update(api.getSceneElements());
    return api.onChange(update);
  }, [api, slidesEnabled]);

  useEffect(() => {
    let active = true;
    const load = () => LoadPromptTemplates().then((value) => { if (active) setTemplates(value); }).catch((error) => { if (active) setError(String(error)); });
    load();
    window.addEventListener("prompt-templates-changed", load);
    return () => { active = false; window.removeEventListener("prompt-templates-changed", load); };
  }, []);

  useEffect(() => {
    const input = composerInput.current;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
  }, [prompt]);

  const suggestions = matchingTemplates(templates, prompt);
  const showTemplates = templateMenu && prompt.startsWith("/") && !prompt.includes("\n") && !busy;
  const activeTemplate = Math.min(templateIndex, Math.max(0, suggestions.length - 1));

  function insertTemplate(template) {
    setPrompt(template.body); setTemplateMenu(false);
    requestAnimationFrame(() => {
      composerInput.current.focus();
      composerInput.current.setSelectionRange(...firstBlank(template.body));
    });
  }

  function composerKeyDown(event) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (showTemplates && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setTemplateMenu(false); return; }
      if (suggestions.length) {
        event.preventDefault();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") setTemplateIndex((activeTemplate + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
        else insertTemplate(suggestions[activeTemplate]);
        return;
      }
      if (event.key === "Enter") { event.preventDefault(); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) send(event);
  }

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

  async function send(event, narrationPrompt) {
    event?.preventDefault();
    const text = (narrationPrompt ?? prompt).trim();
    if (!api || running.current || !text) return false;
    const id = ++request.current;
    running.current = true; setBusy(true); setError("");
    let unsubscribe;
    try {
      const settings = await LoadAISettings();
      if (id !== request.current) return;
      if (!settings.hasAPIKey) {
        if (narrationPrompt !== undefined) throw Error("Add your API key in Settings → AI before generating a narrated replay.");
        onSettings(); return false;
      }
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
      if (narrationPrompt === undefined) setPrompt("");
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
      const result = await AskAI(doc.path, scene, checkpoint.current, text, screenshot, narrationPrompt === undefined ? messages.slice(-12) : [], session.current, requestID, mode === "fast" ? "none" : "high");
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
      return true;
    } catch (error) {
      if (narrationPrompt !== undefined) throw error;
      if (id === request.current) { setError(String(error)); setPrompt(text); }
      return false;
    }
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
      {showTemplates && <div id="prompt-template-suggestions" className="template-suggestions" role="listbox" aria-label="Prompt templates">
        {suggestions.length ? suggestions.map((template, index) => <button id={`prompt-template-option-${index}`} key={template.name} type="button" role="option" aria-selected={index === activeTemplate} className={index === activeTemplate ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => insertTemplate(template)}>{template.name}</button>) : <p>No matching templates. Manage them in Settings → AI.</p>}
      </div>}
      <textarea ref={composerInput} rows={1} aria-label="Message DeepSeek" aria-controls={showTemplates ? "prompt-template-suggestions" : undefined} aria-expanded={showTemplates} aria-activedescendant={showTemplates && suggestions.length ? `prompt-template-option-${activeTemplate}` : undefined} value={prompt} onChange={(event) => { setPrompt(event.target.value); setTemplateIndex(0); setTemplateMenu(true); }} onFocus={() => setTemplateMenu(true)} onBlur={() => setTemplateMenu(false)} onKeyDown={composerKeyDown} placeholder={busy ? (previewing ? "Drawing on this canvas…" : "AI is working on this canvas…") : "Ask AI, or / for templates…"} disabled={busy || !api} maxLength={16000} />
      <button type="button" className="chat-mode-button" onClick={() => setMode(mode === "fast" ? "stable" : "fast")} disabled={busy || !api} aria-label={`AI mode: ${mode}`} aria-pressed={mode === "stable"} title={mode === "fast" ? "Fast: no thinking" : "Stable: high thinking"}>{mode}</button>
      {busy ? <button type="button" onClick={() => cancel()} aria-label="Cancel AI request">Stop</button> : <button type="submit" disabled={!api || !prompt.trim()} aria-label="Send message" title="Send message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /><path d="m21.854 2.147-10.94 10.939" /></svg>
      </button>}
      </form>
      <button type="button" className="chat-side-button" onClick={newChat} disabled={!api || !messages.length} aria-label="New chat" title="New chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
      </button>
      {addonsAvailable && <div className="chat-addons" ref={addons}>
        <button type="button" className="chat-side-button" onClick={() => setAddonsOpen(!addonsOpen)} aria-label="Add-ons" aria-haspopup="menu" aria-expanded={addonsOpen} title="Add-ons">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          {recording.phase === "recording" && <span className="recording-dot addons-recording-dot" />}
        </button>
        {addonsOpen && <div className="addons-menu" role="menu" aria-label="Add-ons">
          <button type="button" role="menuitem" disabled={busy || !api || recordingActive} onClick={() => { setAddonsOpen(false); onReplay(); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m8 8 6 4-6 4z" /><circle cx="18" cy="6" r="2" /></svg>Narrated replay</button>
          {slidesReady && <button type="button" role="menuitem" disabled={busy || !api || recording.mode === "canvas-locked" && recordingActive} onClick={() => { setAddonsOpen(false); onSlides(); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M12 17v4m-4 0h8M10 7l6 3-6 3z" /></svg>Preview slides</button>}
          {(recordingEnabled || recordingActive) && <button type="button" role="menuitem" disabled={recording.phase === "starting" || recording.phase === "stopping" || !api} onClick={() => { setAddonsOpen(false); recordingActive ? onStopRecording() : onRecord(); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{recordingActive ? <rect x="6" y="6" width="12" height="12" rx="2" /> : <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /><circle cx="12" cy="10.5" r="3" /></>}</svg>{recording.phase === "starting" ? "Starting recording…" : recording.phase === "stopping" ? "Saving recording…" : recordingActive ? "Stop recording" : "Screen recording"}</button>}
        </div>}
      </div>}
    </div>
    <span className="sr-only" role="status">{busy ? "AI is working" : lastReply}</span>
  </div>;
});
