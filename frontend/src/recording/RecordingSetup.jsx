import React, { useRef, useEffect, useState } from "react";
import { Camera } from "lucide-react";

/**
 * Recording setup dialog shown before starting a recording.
 * Webcam is recorded separately; its bubble is configured in the editor.
 */
export function RecordingSetup({ onStart, onCancel }) {
  const dialog = useRef();
  const [webcamEnabled, setWebcamEnabled] = useState(false);

  useEffect(() => {
    dialog.current?.show();
    const escape = (event) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onCancel]);

  const handleStart = () => {
    onStart({ webcamEnabled });
  };

  return (
    <div className="recording-setup-overlay"><dialog
      ref={dialog}
      className="recording-setup-modal"
      aria-label="Screen Recording Setup"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className="recording-setup-content">
        <header className="recording-setup-header">
          <h2>Screen Recording Setup</h2>
          <button
            type="button"
            className="recording-setup-close"
            onClick={onCancel}
            aria-label="Cancel recording"
          >
            ×
          </button>
        </header>

        <div className="recording-setup-body">
          <div className="recording-setup-section">
            <label className="recording-setup-toggle">
              <input
                type="checkbox"
                checked={webcamEnabled}
                onChange={(e) => setWebcamEnabled(e.target.checked)}
              />
              <span>
                <Camera size={16} aria-hidden="true" />
                <strong>Enable Webcam</strong>
              </span>
            </label>
            <p className="recording-setup-description">
              The webcam bubble appears in the editor after recording, where you can move and resize it.
            </p>
          </div>
        </div>

        <footer className="recording-setup-footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="recording-setup-start" onClick={handleStart}>
            Start Recording
          </button>
        </footer>
      </div>
    </dialog></div>
  );
}
