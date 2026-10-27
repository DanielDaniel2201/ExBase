import React, { useEffect, useRef, useState } from "react";
import { ChevronRight, Lock } from "lucide-react";
import { LoadPromptTemplates, SavePromptTemplates, SaveGeneralSettings } from "../../wailsjs/go/main/App";
import { AIProviders } from "./AIProviders";
import { UpdateSettings } from "./UpdateSettings";

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
    {locked && <Lock x="123" y="58" width="16" height="16" color="#666" fill="#f7f7f8" aria-hidden="true" />}
  </svg>;
}

function TemplateEditor({ template, isNew, saving, error, onSave, onDelete, onClose }) {
  const dialog = useRef();
  const [draft, setDraft] = useState(template);
  useEffect(() => { dialog.current.showModal(); }, []);
  const save = () => onSave({ ...draft, name: draft.name.trim() });
  return <dialog ref={dialog} className="settings-modal template-edit-modal" aria-labelledby="template-edit-title" onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!saving) onClose(); }} onClick={(event) => { if (event.target === dialog.current && !saving) onClose(); }}>
    <header className="settings-heading"><h2 id="template-edit-title">{isNew ? "New Template" : "Edit Template"}</h2><button type="button" className="settings-close" disabled={saving} onClick={onClose} aria-label="Close template editor">×</button></header>
    <fieldset disabled={saving} className="template-editor">
      <label htmlFor="prompt-template-name">Name</label>
      <input id="prompt-template-name" value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      <label htmlFor="prompt-template-body">Content</label>
      <textarea id="prompt-template-body" value={draft.body} maxLength={16000} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
      <p className="template-help">Use {"{{topic}}"} for blanks, then edit the inserted text in chat.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="template-actions">{!isNew && <button type="button" onClick={onDelete}>Delete template</button>}<span className="template-save-actions"><button type="button" onClick={onClose}>Cancel</button><button type="button" onClick={save}>{saving ? "Saving…" : isNew ? "Create template" : "Save changes"}</button></span></div>
    </fieldset>
  </dialog>;
}

export function SettingsModal({ onClose, generalSettings, onGeneralSettings, recordingActive = false, updates }) {
  const dialog = useRef();
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
    LoadPromptTemplates().then((templates) => {
      setTemplates(templates);
      savedTemplates.current = JSON.stringify(templates);
      setLoaded(true);
    }).catch((error) => setError(String(error)));
  }, []);

  async function saveTemplates(nextTemplates) {
    if (!loaded || saving) return false;
    const templatesJSON = JSON.stringify(nextTemplates);
    if (templatesJSON === savedTemplates.current) return true;
    setSaving(true); setError("");
    try {
      await SavePromptTemplates(nextTemplates);
      setTemplates(nextTemplates);
      savedTemplates.current = templatesJSON;
      window.dispatchEvent(new Event("prompt-templates-changed"));
      return true;
    } catch (error) { setError(String(error)); return false; }
    finally { setSaving(false); }
  }

  function close() {
    if (!generalSaving && !saving) onClose();
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
      <button type="button" className="settings-close" disabled={saving || generalSaving} onClick={close} aria-label="Close settings">×</button>
    </header>
    <div className="settings-content">
      <nav className="settings-nav" aria-label="Settings sections">{["General", "AI"].map((name) => <button type="button" key={name} disabled={saving} className={section === name ? "active" : ""} aria-current={section === name ? "page" : undefined} onClick={() => setSection(name)}>{name}</button>)}</nav>
      <div className="settings-panel" inert={generalSaving ? "" : undefined} aria-busy={generalSaving}>
        {section === "General" ? <>
          <h3 className="general-settings-heading">Slides</h3>
          <label className="general-toggle"><span><strong>Frame slide preview</strong><small>Show Preview slides in the add-ons menu when every element belongs to a Frame.</small></span><input type="checkbox" role="switch" aria-label="Frame slide preview" checked={!!generalSettings?.slidesEnabled} disabled={!generalSettings} onChange={(event) => saveGeneral({ slidesEnabled: event.target.checked })} /></label>
          <h3 className="general-settings-heading recording-settings-heading">Screen recording</h3>
          <label className="general-toggle"><span><strong>Enable screen recording</strong><small>Show recording in the add-ons menu beside New chat.</small></span><input type="checkbox" role="switch" aria-label="Enable screen recording" checked={!!generalSettings?.recordingEnabled} disabled={!generalSettings || recordingActive} onChange={(event) => saveGeneral({ recordingEnabled: event.target.checked })} /></label>
          <fieldset className="recording-modes" disabled={!generalSettings?.recordingEnabled || recordingActive}>
            <legend>Recording area</legend>
            <div className="recording-mode-options">{[
              ["app", "Entire application", "Record this ExBase window, including Settings, the sidebar and file switches."],
              ["canvas", "Canvas only", "Record the current canvas. You can switch files and open Settings without showing those controls."],
              ["canvas-locked", "Canvas only lock navigation", "Record this canvas and disable workspace, file, Settings and sidebar controls until recording stops."],
            ].map(([value, title, help]) => <label key={value} className="recording-mode-option" title={help}><input className="sr-only" type="radio" name="recording-mode" value={value} aria-label={title} checked={(generalSettings?.recordingMode || "canvas") === value} onChange={() => saveGeneral({ recordingMode: value })} /><span className="recording-mode-preview"><RecordingAreaPreview mode={value} /></span><span className="recording-mode-name">{title}</span></label>)}</div>
          </fieldset>
          <label className="general-toggle"><span><strong>Keep recording on cancel</strong><small>When enabled, canceling Save keeps the video in ~/.exbase/recordings. When disabled, it discards the video.</small></span><input type="checkbox" role="switch" aria-label="Keep recording on cancel" checked={!!generalSettings?.keepRecordingOnCancel} disabled={!generalSettings?.recordingEnabled || recordingActive} onChange={(event) => saveGeneral({ keepRecordingOnCancel: event.target.checked })} /></label>
          {recordingActive && <p className="template-help">Stop recording to change recording settings.</p>}
          <UpdateSettings updates={updates} recordingActive={recordingActive} />
        </> : <>
        <label className="general-toggle"><span><strong>Enable AI features</strong><small>Show AI chat and narrated replay. Turning this off stops active AI requests and keeps your configuration.</small></span><input type="checkbox" role="switch" aria-label="Enable AI features" checked={!!generalSettings && generalSettings.aiEnabled !== false} disabled={!generalSettings || saving} onChange={(event) => saveGeneral({ aiEnabled: event.target.checked })} /></label>
        {generalSettings?.aiEnabled !== false && <div className="ai-feature-settings">
        <AIProviders saving={saving} onSaving={setSaving} />
        <section className="prompt-template-settings" aria-labelledby="prompt-template-title">
          <div className="template-heading"><h3 id="prompt-template-title">Prompt Templates</h3><button type="button" disabled={!loaded || saving} onClick={() => {
            let name = "New template", number = 2;
            while (templates.some((template) => template.name.toLowerCase() === name.toLowerCase())) name = `New template ${number++}`;
            setError(""); setSelected({ index: templates.length, template: { name, body: "Describe {{topic}}" } });
          }}>+ Add</button></div>
          <p className="template-help">Type / in chat to insert a template. Click to edit or delete; Save changes to keep edits.</p>
          <div className="template-list" aria-label="Prompt templates">
            {!templates.length && <p className="template-help">{loaded ? "No templates yet." : "Loading…"}</p>}
            {templates.map((template, index) => <button type="button" className="template-row" key={index} disabled={saving} onClick={() => { setError(""); setSelected({ index, template }); }}><span>{template.name}</span><ChevronRight aria-hidden="true" /></button>)}
          </div>
        </section>
        </div>}
        </>}
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </div>
    {selected && <TemplateEditor key={selected.index} template={selected.template} isNew={selected.index === templates.length} saving={saving} error={error} onClose={() => { setError(""); setSelected(null); }} onSave={async (template) => {
      const next = [...templates]; next[selected.index] = template;
      if (await saveTemplates(next)) setSelected(null);
    }} onDelete={async () => { if (await saveTemplates(templates.filter((_, index) => index !== selected.index))) setSelected(null); }} />}
  </dialog>;
}
