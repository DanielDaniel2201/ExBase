import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Eye, EyeOff, Pencil, Plus } from "lucide-react";
import { LoadAISettings, SaveAIProviders } from "../../wailsjs/go/main/App";

function ProviderEditor({ provider, isNew, saving, error, onSave, onDelete, onClose }) {
  const dialog = useRef();
  const [draft, setDraft] = useState(provider);
  const [showKey, setShowKey] = useState(false);
  const official = draft.id === "deepseek";
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="settings-modal provider-edit-modal" aria-labelledby="provider-edit-title" onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!saving) onClose(); }} onClick={(event) => { if (event.target === dialog.current && !saving) onClose(); }}>
    <header className="settings-heading"><h2 id="provider-edit-title">{isNew ? "New Provider" : "Edit Provider"}</h2><button type="button" className="settings-close" disabled={saving} onClick={onClose} aria-label="Close provider editor">×</button></header>
    <form className="template-editor provider-editor" onSubmit={(event) => { event.preventDefault(); if (!saving) onSave(draft); }}>
      <fieldset disabled={saving}>
        <label htmlFor="provider-name">Provider name</label>
        <input id="provider-name" value={draft.name} readOnly={official} maxLength={80} required onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <label htmlFor="provider-url">Base URL</label>
        <input id="provider-url" value={draft.baseURL} readOnly={official} maxLength={2048} required placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false} onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })} />
        <label htmlFor="provider-model">Model ID</label>
        <input id="provider-model" value={draft.model} readOnly={official} maxLength={256} required placeholder="Provider's DeepSeek V4.1 Flash model ID" autoComplete="off" spellCheck={false} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
        {isNew && <p className="template-help">Only DeepSeek V4.1 Flash is supported.</p>}
        <label htmlFor="provider-key">API Key</label>
        <div className="api-key-field">
          <input id="provider-key" type={showKey ? "text" : "password"} value={draft.apiKey} maxLength={1024} autoComplete="off" spellCheck={false} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} />
          <button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "Hide API Key" : "Show API Key"}>{showKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="template-actions">{!isNew && !official && <button type="button" onClick={onDelete}>Delete provider</button>}<span className="template-save-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit">{saving ? "Saving…" : isNew ? "Create provider" : "Save changes"}</button></span></div>
      </fieldset>
    </form>
  </dialog>;
}

export function AIProviders({ saving, onSaving }) {
  const [settings, setSettings] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const picker = useRef();
  const trigger = useRef();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  useEffect(() => { LoadAISettings().then(setSettings).catch((error) => setError(String(error))); }, []);
  const active = settings?.providers.find((provider) => provider.id === settings.activeProviderID);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event) => { if (!picker.current.contains(event.target)) setMenuOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);
  useEffect(() => { if (menuOpen) picker.current.querySelector(".active")?.scrollIntoView({ block: "nearest" }); }, [menuOpen, menuIndex]);

  function openMenu() {
    setMenuIndex(settings.providers.findIndex((provider) => provider.id === settings.activeProviderID));
    setMenuOpen(true);
  }

  function chooseProvider(provider) {
    setMenuOpen(false);
    trigger.current.focus();
    if (provider.id !== settings.activeProviderID) save(settings.providers, provider.id);
  }

  function pickerKeyDown(event) {
    if (event.key === "Escape" && menuOpen) { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); }
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!menuOpen) openMenu();
      if (event.key === "Home") setMenuIndex(0);
      else if (event.key === "End") setMenuIndex(settings.providers.length - 1);
      else if (menuOpen) setMenuIndex(Math.max(0, Math.min(settings.providers.length - 1, menuIndex + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (menuOpen) chooseProvider(settings.providers[menuIndex]);
      else openMenu();
    } else if (event.key === "Tab") setMenuOpen(false);
  }

  async function save(providers, activeProviderID) {
    if (saving) return false;
    onSaving(true); setError("");
    try { setSettings(await SaveAIProviders(providers, activeProviderID)); return true; }
    catch (error) { setError(String(error)); return false; }
    finally { onSaving(false); }
  }

  const closeEditor = () => { setSelected(null); setError(""); };
  return <section aria-labelledby="ai-providers-title">
    <h3 id="ai-providers-title">Model Provider</h3>
    <div className="provider-selection">
      <div className="provider-picker" ref={picker} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false); }}>
        <button ref={trigger} type="button" role="combobox" className="provider-trigger" aria-label="Active provider" aria-haspopup="listbox" aria-expanded={menuOpen} aria-controls={menuOpen ? "provider-options" : undefined} aria-activedescendant={menuOpen ? `provider-option-${menuIndex}` : undefined} disabled={!settings || saving} onKeyDown={pickerKeyDown} onClick={() => menuOpen ? setMenuOpen(false) : openMenu()}>
          <span>{active?.name || "Loading…"}</span>{active?.id === "deepseek" && <small>Official</small>}<ChevronDown aria-hidden="true" />
        </button>
        {menuOpen && <div id="provider-options" className="provider-menu" role="listbox" aria-label="Providers">
          {settings.providers.map((provider, index) => <button id={`provider-option-${index}`} key={provider.id} type="button" role="option" tabIndex={-1} aria-selected={provider.id === settings.activeProviderID} className={index === menuIndex ? "active" : ""} onMouseEnter={() => setMenuIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseProvider(provider)}>
            <span>{provider.name}</span>{provider.id === "deepseek" && <small>Official</small>}{provider.id === settings.activeProviderID && <Check aria-hidden="true" />}
          </button>)}
        </div>}
      </div>
      <button type="button" disabled={!active || saving} aria-label="Edit provider" title="Edit provider" onClick={() => { setError(""); setSelected({ provider: active, isNew: false }); }}><Pencil aria-hidden="true" /></button>
      <button type="button" disabled={!settings || saving} aria-label="Add provider" title="Add provider" onClick={() => { setError(""); setSelected({ provider: { id: crypto.randomUUID(), name: "", baseURL: "", model: "", apiKey: "" }, isNew: true }); }}><Plus aria-hidden="true" /></button>
    </div>
    {error && !selected && <p role="alert" className="error">{error}</p>}
    {selected && <ProviderEditor provider={selected.provider} isNew={selected.isNew} saving={saving} error={error} onClose={closeEditor} onSave={async (provider) => {
      const providers = selected.isNew ? [...settings.providers, provider] : settings.providers.map((item) => item.id === provider.id ? provider : item);
      if (await save(providers, selected.isNew ? provider.id : settings.activeProviderID)) closeEditor();
    }} onDelete={async () => {
      const id = selected.provider.id;
      if (await save(settings.providers.filter((provider) => provider.id !== id), settings.activeProviderID === id ? "deepseek" : settings.activeProviderID)) closeEditor();
    }} />}
  </section>;
}
