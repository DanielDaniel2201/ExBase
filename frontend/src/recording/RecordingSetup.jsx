import React, { useRef, useEffect, useState } from "react";
import { Camera, Circle, Square } from "lucide-react";

/**
 * Recording setup dialog shown before starting a recording.
 * Allows user to configure webcam visibility, bubble shape, and position.
 * Note: Webcam preview is managed by parent component to avoid layout issues.
 */
export function RecordingSetup({ mode, onStart, onCancel, onWebcamChange }) {
  const dialog = useRef();
  const [webcamEnabled, setWebcamEnabled] = useState(false);
  const [bubbleShape, setBubbleShape] = useState("circle"); // "circle" or "rounded"
  const [bubblePosition, setBubblePosition] = useState(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    // Notify parent about webcam state changes for preview
    onWebcamChange?.({
      enabled: webcamEnabled,
      shape: bubbleShape,
      onPositionChange: (pos) => setBubblePosition(pos)
    });
  }, [webcamEnabled, bubbleShape, onWebcamChange]);

  const handleStart = () => {
    onStart({
      webcamEnabled,
      bubbleShape,
      bubblePosition
    });
  };

  const handleWebcamToggle = (checked) => {
    setWebcamEnabled(checked);
  };

  return (
    <dialog
      ref={dialog}
      className="recording-setup-modal"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) {
          onCancel();
        }
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
                onChange={(e) => handleWebcamToggle(e.target.checked)}
              />
              <span>
                <Camera size={16} aria-hidden="true" />
                <strong>Show webcam bubble</strong>
              </span>
            </label>
            <p className="recording-setup-description">
              {webcamEnabled
                ? "Drag the bubble on screen to position it before recording"
                : "Display your camera feed in a draggable bubble overlay"}
            </p>
          </div>

          {webcamEnabled && (
            <div className="recording-setup-section">
              <label className="recording-setup-label">Bubble shape</label>
              <div className="bubble-shape-options">
                <label className="bubble-shape-option">
                  <input
                    type="radio"
                    name="bubble-shape"
                    value="circle"
                    checked={bubbleShape === "circle"}
                    onChange={() => setBubbleShape("circle")}
                  />
                  <span className="bubble-shape-preview">
                    <Circle size={32} strokeWidth={2} />
                  </span>
                  <span className="bubble-shape-name">Circle</span>
                </label>
                <label className="bubble-shape-option">
                  <input
                    type="radio"
                    name="bubble-shape"
                    value="rounded"
                    checked={bubbleShape === "rounded"}
                    onChange={() => setBubbleShape("rounded")}
                  />
                  <span className="bubble-shape-preview">
                    <Square size={32} strokeWidth={2} />
                  </span>
                  <span className="bubble-shape-name">Rounded</span>
                </label>
              </div>
            </div>
          )}
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
    </dialog>
  );
}
