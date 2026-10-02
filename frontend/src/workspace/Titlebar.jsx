import React from "react";
import { Quit, WindowMinimise, WindowToggleMaximise } from "../../wailsjs/runtime/runtime";

export function PanelLeftIcon({ open }) {
  return <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d={open ? "m14 9 3 3-3 3" : "m16 15-3-3 3-3"} />
  </svg>;
}

export function Titlebar({ children }) {
  return <header className="titlebar" onDoubleClick={WindowToggleMaximise}>
    {children}
    <div className="window-controls" onDoubleClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={WindowMinimise} aria-label="Minimise"><span className="minimise-icon" /></button>
      <button type="button" onClick={WindowToggleMaximise} aria-label="Maximise"><span className="maximise-icon" /></button>
      <button type="button" className="close-button" onClick={Quit} aria-label="Close"><span className="close-icon" /></button>
    </div>
  </header>;
}
