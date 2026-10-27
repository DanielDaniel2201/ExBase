import { useEffect, useState } from "react";
import { GetUpdateInfo, CheckForUpdates, InstallUpdate } from "../../wailsjs/go/main/App";

export function useUpdates() {
  const [info, setInfo] = useState(null);
  const [release, setRelease] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const info = await GetUpdateInfo();
        if (!active) return;
        setInfo(info);
        if (info.installed) {
          const latest = await CheckForUpdates();
          if (active) setRelease(latest);
        }
      } catch { /* Network failures must not interrupt startup. Manual checks show errors. */ }
    })();
    return () => { active = false; };
  }, []);

  async function check() {
    if (busy) return;
    setBusy("check"); setError(""); setMessage("");
    try {
      const latest = await CheckForUpdates();
      setRelease(latest);
      if (!latest.available) setMessage("You're up to date.");
    } catch (error) { setError(String(error)); }
    finally { setBusy(""); }
  }

  async function install() {
    if (busy) return;
    setBusy("install"); setError(""); setMessage("");
    try { await InstallUpdate(); }
    catch (error) { setError(String(error)); }
    finally { setBusy(""); }
  }

  return { info, release, busy, message, error, check, install };
}
