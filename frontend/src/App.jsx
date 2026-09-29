import React, { useRef, useState } from "react";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import { Open, Save } from "../wailsjs/go/main/App";
import { parseScene } from "./scene";

export default function App() {
  const [doc, setDoc] = useState(null);
  const [api, setApi] = useState(null);
  const [status, setStatus] = useState("");
  const autosaveTimer = useRef();
  const lastSaved = useRef("");

  async function open() {
    try {
      if (doc && api) await save();
      const file = await Open();
      if (file.path) {
        const scene = parseScene(file.data);
        lastSaved.current = serializeAsJSON(scene.elements, scene.appState || {}, scene.files || {}, "local");
        setDoc({ path: file.path, scene });
      }
      setStatus("");
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function save() {
    try {
      clearTimeout(autosaveTimer.current);
      const data = serializeAsJSON(
        api.getSceneElements(), api.getAppState(), api.getFiles(), "local",
      );
      const path = await Save(doc.path, data);
      if (path) setDoc({ ...doc, path });
      if (path) lastSaved.current = data;
      setStatus(path ? "Saved" : "");
    } catch (error) {
      setStatus(String(error));
    }
  }

  function autosave(elements, appState, files) {
    const data = serializeAsJSON(elements, appState, files, "local");
    if (data === lastSaved.current) return;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try {
        setStatus("Saving…");
        await Save(doc.path, data);
        lastSaved.current = data;
        setStatus("Saved");
      } catch (error) {
        setStatus(String(error));
      }
    }, 600);
  }

  if (!doc) return <main className="empty"><button onClick={open}>Open</button>{status && <p>{status}</p>}</main>;

  return <main className="editor">
    <header>
      <span title={doc.path}>{doc.path.split(/[\\/]/).pop()}</span>
      <button onClick={open}>Open</button>
      <button onClick={save} disabled={!api}>Save</button>
      <small>{status}</small>
    </header>
    <section>
      <Excalidraw key={doc.path} initialData={doc.scene} excalidrawAPI={setApi} onChange={autosave} />
    </section>
  </main>;
}
