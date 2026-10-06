import React, { useEffect, useRef, useState } from "react";
import { LoadAISettings, SaveAISettings, LoadPromptTemplates, SavePromptTemplates, SaveGeneralSettings } from "../../wailsjs/go/main/App";
import { srtTemplate } from "./templates";

// Lucide Settings (ISC), kept inline like the existing sidebar icons.
export function SettingsIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831 2.34 2.34 0 0 1 2.33-4.033 2.34 2.34 0 0 0 3.32-1.915" />
    <circle cx="12" cy="12" r="3" />
  </svg>;
}

function RecordingAreaPreview({ mode }) {
  const entire = mode === "app";
  const locked = mode === "canvas-locked";
  return <svg viewBox="0 0 160 104" fill="none" aria-hidden="true">
    <rect x="12" y="10" width="136" height="84" rx="5" fill={entire ? "#d9d9dd" : "#f0f0f2"} stroke="#aaa" />
    <g opacity={locked ? ".35" : "1"}>
      <circle cx="21" cy="18" r="1.5" fill="#999" /><circle cx="27" cy="18" r="1.5" fill="#999" /><circle cx="33" cy="18" r="1.5" fill="#999" />
      <rect x="19" y="32" width="17" height="3" rx="1.5" fill="#b5b5bb" />
      <rect x="19" y="41" width="21" height="3" rx="1.5" fill="#b5b5bb" />
      <rect x="19" y="50" width="15" height="3" rx="1.5" fill="#b5b5bb" />
      <rect x="20" y="85" width="20" height="2" rx="1" fill="#b5b5bb" />
    </g>
    <rect x="47" y="27" width="95" height="52" rx="2" fill={entire ? "#ececef" : "#d9d9dd"} />
    <path d="M66 59h15V42h20v17h18" stroke="#909098" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x={entire ? 12 : 47} y={entire ? 10 : 27} width={entire ? 136 : 95} height={entire ? 84 : 52} rx={entire ? 5 : 2} stroke="#72727b" strokeWidth="1.5" strokeDasharray="4 3" />
    {locked && <g stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="126" y="64" width="10" height="9" rx="2" fill="#f7f7f8" /><path d="M128 64v-2a3 3 0 0 1 6 0v2" /></g>}
  </svg>;
}

function TemplateEditor({ template, isNew, saving, error, onSave, onDelete, onClose }) {
  const dialog = useRef();
  const [draft, setDraft] = useState(template);
  useEffect(() => { dialog.current.showModal(); }, []);
  const save = () => onSave({ ...draft, name: draft.name.trim() });
  return <dialog ref={dialog} className="settings-modal template-edit-modal" aria-labelledby="template-edit-title" onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!saving) save(); }} onClick={(event) => { if (event.target === dialog.current && !saving) save(); }}>
    <header className="settings-heading"><h2 id="template-edit-title">{isNew ? "New Template" : "Edit Template"}</h2><button type="button" className="settings-close" disabled={saving} onClick={save} aria-label="Close template editor">×</button></header>
    <fieldset disabled={saving} className="template-editor">
      <label htmlFor="prompt-template-name">Name</label>
      <input id="prompt-template-name" value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      <label htmlFor="prompt-template-body">Content</label>
      <textarea id="prompt-template-body" value={draft.body} maxLength={16000} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
      <p className="template-help">Use {"{{topic}}"} for blanks, then edit the inserted text in chat.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="template-actions"><button type="button" onClick={isNew ? onClose : onDelete}>{isNew ? "Cancel" : "Delete"}</button><button type="button" onClick={save}>Save</button></div>
    </fieldset>
  </dialog>;
}

export function SettingsModal({ onClose, generalSettings, onGeneralSettings, recordingActive = false }) {
  const dialog = useRef();
  const savedKey = useRef("");
  const savePromise = useRef(null);
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const savedTemplates = useRef("");
  const [section, setSection] = useState("General");
  const [generalSaving, setGeneralSaving] = useState(false);

  useEffect(() => {
    dialog.current.showModal();
    Promise.all([LoadAISettings(), LoadPromptTemplates()]).then(([settings, templates]) => {
      savedKey.current = settings.apiKey || "";
      setKey(savedKey.current);
      setTemplates(templates);
      savedTemplates.current = JSON.stringify(templates);
      setLoaded(true);
    }).catch((error) => setError(String(error)));
  }, []);

  async function save(nextTemplates = templates) {
    if (!loaded) return false;
    const value = key.trim();
    const templatesJSON = JSON.stringify(nextTemplates);
    if (value === savedKey.current && templatesJSON === savedTemplates.current) return true;
    if (!value && savedKey.current) { setError("Enter your DeepSeek API key"); return false; }
    if (savePromise.current) return savePromise.current;
    setSaving(true); setError("");
    savePromise.current = (async () => {
      if (templatesJSON !== savedTemplates.current) {
        await SavePromptTemplates(nextTemplates);
        setTemplates(nextTemplates);
        savedTemplates.current = templatesJSON;
        window.dispatchEvent(new Event("prompt-templates-changed"));
      }
      if (value !== savedKey.current) {
        await SaveAISettings(value, "high");
        savedKey.current = value; setKey(value);
      }
      return true;
    })()
      .catch((error) => { setError(String(error)); return false; })
      .finally(() => { setSaving(false); savePromise.current = null; });
    return savePromise.current;
  }

  async function close() {
    if (generalSaving) return;
    if (!loaded) { onClose(); return; }
    if (await save()) onClose();
  }

  async function saveGeneral(patch) {
    const next = { ...generalSettings, ...patch };
    setGeneralSaving(true); setError("");
    try { await SaveGeneralSettings(next); onGeneralSettings(next); }
    catch (error) { setError(String(error)); }
    finally { setGeneralSaving(false); }
  }

  return <dialog ref={dialog} className="settings-modal" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialog.current) close(); }} aria-labelledby="settings-title">
    <header className="settings-heading">
      <h2 id="settings-title">Settings</h2>
      <button type="button" className="settings-close" onClick={close} aria-label="Close settings">×</button>
    </header>
    <div className="settings-content">
      <nav className="settings-nav" aria-label="Settings sections">{["General", "AI"].map((name) => <button type="button" key={name} className={section === name ? "active" : ""} aria-current={section === name ? "page" : undefined} onClick={() => setSection(name)}>{name}</button>)}</nav>
      <div className="settings-panel">
        {section === "General" ? <>
          <h3 className="general-settings-heading">Slides</h3>
          <label className="general-toggle"><span><strong>Frame slide preview</strong><small>Show Preview slides in the add-ons menu when every element belongs to a Frame.</small></span><input type="checkbox" role="switch" aria-label="Frame slide preview" checked={!!generalSettings?.slidesEnabled} disabled={!generalSettings || generalSaving} onChange={(event) => saveGeneral({ slidesEnabled: event.target.checked })} /></label>
          <h3 className="general-settings-heading recording-settings-heading">Screen recording</h3>
          <label className="general-toggle"><span><strong>Enable screen recording</strong><small>Show recording in the add-ons menu beside New chat.</small></span><input type="checkbox" role="switch" aria-label="Enable screen recording" checked={!!generalSettings?.recordingEnabled} disabled={!generalSettings || generalSaving || recordingActive} onChange={(event) => saveGeneral({ recordingEnabled: event.target.checked })} /></label>
          <fieldset className="recording-modes" disabled={!generalSettings?.recordingEnabled || generalSaving || recordingActive}>
            <legend>Recording area</legend>
            <div className="recording-mode-options">{[
              ["app", "Entire application", "Record this ExBase window, including Settings, the sidebar and file switches."],
              ["canvas", "Canvas only", "Record the current canvas. You can switch files and open Settings without showing those controls."],
              ["canvas-locked", "Canvas only lock navigation", "Record this canvas and disable workspace, file, Settings and sidebar controls until recording stops."],
            ].map(([value, title, help]) => <label key={value} className="recording-mode-option" title={help}><input className="sr-only" type="radio" name="recording-mode" value={value} aria-label={title} checked={(generalSettings?.recordingMode || "canvas") === value} onChange={() => saveGeneral({ recordingMode: value })} /><span className="recording-mode-preview"><RecordingAreaPreview mode={value} /></span><span className="recording-mode-name">{title}</span></label>)}</div>
          </fieldset>
          <label className="general-toggle"><span><strong>Keep recording on cancel</strong><small>When enabled, canceling Save keeps the video in ~/.exbase/recordings. When disabled, it discards the video.</small></span><input type="checkbox" role="switch" aria-label="Keep recording on cancel" checked={!!generalSettings?.keepRecordingOnCancel} disabled={!generalSettings?.recordingEnabled || generalSaving || recordingActive} onChange={(event) => saveGeneral({ keepRecordingOnCancel: event.target.checked })} /></label>
          {recordingActive && <p className="template-help">Stop recording to change recording settings.</p>}
        </> : <>
        <h3>Model Provider</h3>
        <label htmlFor="deepseek-key">DeepSeek API Key</label>
        <div className="api-key-field">
          <input id="deepseek-key" type={showKey ? "text" : "password"} value={key} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setKey(event.target.value)} onBlur={() => save()} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} placeholder="Enter your DeepSeek API key" autoComplete="off" spellCheck={false} disabled={!loaded || saving} />
          <button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}>
            {showKey
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2 2 20 20" /><path d="M6.71 6.71C4.7 8.1 3.17 9.94 2.06 11.65a1 1 0 0 0 0 .7C4.01 15.36 7.57 19 12 19c1.44 0 2.77-.38 3.96-.99" /><path d="M10.73 5.08A7 7 0 0 1 12 5c4.43 0 7.99 3.64 9.94 6.65a1 1 0 0 1 0 .7 11.8 11.8 0 0 1-1.32 1.74" /><path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" /></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7C4.01 8.64 7.57 5 12 5s7.99 3.64 9.94 6.65a1 1 0 0 1 0 .7C19.99 15.36 16.43 19 12 19S4.01 15.36 2.06 12.35" /><circle cx="12" cy="12" r="3" /></svg>}
          </button>
        </div>
        <section className="prompt-template-settings" aria-labelledby="prompt-template-title">
          <div className="template-heading"><h3 id="prompt-template-title">Prompt Templates</h3><button type="button" disabled={!loaded || saving} onClick={() => {
            let name = "New template", number = 2;
            while (templates.some((template) => template.name.toLowerCase() === name.toLowerCase())) name = `New template ${number++}`;
            setError(""); setSelected({ index: templates.length, template: { name, body: "Describe {{topic}}" } });
          }}>+ Add</button></div>
          <p className="template-help">Type / in chat to insert a template. Click a template to edit.</p>
          <div className="template-list" aria-label="Prompt templates">
            {loaded && !templates.some((template) => template.name === srtTemplate.name) && <button type="button" className="template-row" disabled={saving} onClick={() => { setError(""); setSelected({ index: templates.length, template: { ...srtTemplate } }); }}><span>{srtTemplate.name}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>}
            {!templates.length && <p className="template-help">{loaded ? "No custom templates yet." : "Loading…"}</p>}
            {templates.map((template, index) => <button type="button" className="template-row" key={index} disabled={saving} onClick={() => { setError(""); setSelected({ index, template }); }}><span>{template.name}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>)}
          </div>
        </section>
        </>}
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </div>
    {selected && <TemplateEditor key={selected.index} template={selected.template} isNew={selected.index === templates.length} saving={saving} error={error} onClose={() => setSelected(null)} onSave={async (template) => {
      const next = [...templates]; next[selected.index] = template;
      if (await save(next)) setSelected(null);
    }} onDelete={async () => { if (await save(templates.filter((_, index) => index !== selected.index))) setSelected(null); }} />}
  </dialog>;
}
