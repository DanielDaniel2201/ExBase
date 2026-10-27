import React from "react";

export function UpdateSettings({ updates, recordingActive }) {
  if (!updates?.info) return null;
  const { info, release, busy, message, error, check, install } = updates;
  return <section className="update-settings" aria-labelledby="updates-title">
    <h3 id="updates-title">Updates</h3>
    <div className="template-heading"><span>ExBase {info.version}{!info.installed && " · Development / portable"}</span>
      {info.installed && <button type="button" disabled={!!busy} onClick={check}>{busy === "check" ? "Checking…" : "Check for updates"}</button>}
    </div>
    {!info.installed && <p className="template-help">Updates are managed by the installed release. This copy stays on your local build.</p>}
    {info.installed && release?.available && <>
      <p>Version {release.version} is available.</p>
      <p className="template-help">Your current file will be saved before ExBase closes, updates and restarts.</p>
      <div className="template-actions"><button type="button" disabled={!!busy || recordingActive} onClick={install}>{busy === "install" ? "Downloading update…" : "Update and restart"}</button></div>
    </>}
    {info.installed && recordingActive && <p className="template-help">Stop recording before updating.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
