import React from "react";
import { Quit, WindowMinimise, WindowToggleMaximise } from "../../wailsjs/runtime/runtime";

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
