import React, { useRef, useState, useEffect } from "react";
import { Camera, Circle, Square, Play, Pause, RotateCcw, Download, X } from "lucide-react";

/**
 * Simple video editor for compositing webcam bubble onto screen recording.
 * Allows user to position, resize and customize the webcam overlay after recording.
 */
export function VideoEditor({ screenRecording, webcamRecording, onClose, onExport }) {
  const canvasRef = useRef(null);
  const screenVideoRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const animationRef = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Bubble configuration
  const [bubbleConfig, setBubbleConfig] = useState({
    x: 50,
    y: 50,
    size: 180,
    shape: "circle", // "circle" or "rounded"
    enabled: true
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [exporting, setExporting] = useState(false);

  // Load videos
  useEffect(() => {
    if (screenVideoRef.current && screenRecording) {
      screenVideoRef.current.src = screenRecording;
      screenVideoRef.current.onloadedmetadata = () => {
        setDuration(screenVideoRef.current.duration);
      };
    }
    if (webcamVideoRef.current && webcamRecording) {
      webcamVideoRef.current.src = webcamRecording;
    }
  }, [screenRecording, webcamRecording]);

  // Render composite frame
  const renderFrame = () => {
    const canvas = canvasRef.current;
    const screenVideo = screenVideoRef.current;
    const webcamVideo = webcamVideoRef.current;

    if (!canvas || !screenVideo || !webcamVideo) return;

    const ctx = canvas.getContext("2d");
    canvas.width = screenVideo.videoWidth || 1920;
    canvas.height = screenVideo.videoHeight || 1080;

    // Draw screen recording
    ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);

    // Draw webcam bubble if enabled
    if (bubbleConfig.enabled && webcamVideo.readyState >= 2) {
      ctx.save();

      // Create clipping path for bubble shape
      ctx.beginPath();
      if (bubbleConfig.shape === "circle") {
        const radius = bubbleConfig.size / 2;
        ctx.arc(
          bubbleConfig.x + radius,
          bubbleConfig.y + radius,
          radius,
          0,
          Math.PI * 2
        );
      } else {
        // Rounded rectangle
        const radius = 16;
        ctx.roundRect(
          bubbleConfig.x,
          bubbleConfig.y,
          bubbleConfig.size,
          bubbleConfig.size,
          radius
        );
      }
      ctx.clip();

      // Draw webcam (mirrored)
      ctx.translate(bubbleConfig.x + bubbleConfig.size, bubbleConfig.y);
      ctx.scale(-1, 1);
      ctx.drawImage(webcamVideo, 0, 0, bubbleConfig.size, bubbleConfig.size);

      ctx.restore();

      // Draw border
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (bubbleConfig.shape === "circle") {
        const radius = bubbleConfig.size / 2;
        ctx.arc(
          bubbleConfig.x + radius,
          bubbleConfig.y + radius,
          radius,
          0,
          Math.PI * 2
        );
      } else {
        const radius = 16;
        ctx.roundRect(
          bubbleConfig.x,
          bubbleConfig.y,
          bubbleConfig.size,
          bubbleConfig.size,
          radius
        );
      }
      ctx.stroke();
    }

    if (playing) {
      animationRef.current = requestAnimationFrame(renderFrame);
    }
  };

  // Play/pause control
  useEffect(() => {
    if (playing) {
      screenVideoRef.current?.play();
      webcamVideoRef.current?.play();
      renderFrame();
    } else {
      screenVideoRef.current?.pause();
      webcamVideoRef.current?.pause();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [playing, bubbleConfig]);

  // Update current time
  useEffect(() => {
    const updateTime = () => {
      if (screenVideoRef.current) {
        setCurrentTime(screenVideoRef.current.currentTime);
      }
    };

    const interval = setInterval(updateTime, 100);
    return () => clearInterval(interval);
  }, []);

  // Handle drag
  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Check if clicking on bubble
    if (
      x >= bubbleConfig.x &&
      x <= bubbleConfig.x + bubbleConfig.size &&
      y >= bubbleConfig.y &&
      y <= bubbleConfig.y + bubbleConfig.size
    ) {
      setIsDragging(true);
      setDragOffset({
        x: x - bubbleConfig.x,
        y: y - bubbleConfig.y
      });
    }
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const newX = Math.max(0, Math.min(x - dragOffset.x, canvas.width - bubbleConfig.size));
    const newY = Math.max(0, Math.min(y - dragOffset.y, canvas.height - bubbleConfig.size));

    setBubbleConfig(prev => ({ ...prev, x: newX, y: newY }));
    renderFrame();
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Format time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Reset to beginning
  const handleReset = () => {
    if (screenVideoRef.current) {
      screenVideoRef.current.currentTime = 0;
    }
    if (webcamVideoRef.current) {
      webcamVideoRef.current.currentTime = 0;
    }
    setCurrentTime(0);
    setPlaying(false);
  };

  // Export composed video
  const handleExport = async () => {
    setExporting(true);
    try {
      // TODO: Implement actual video export using MediaRecorder
      await onExport(bubbleConfig);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="video-editor-overlay">
      <div className="video-editor">
        <header className="video-editor-header">
          <h2>Edit Recording</h2>
          <button
            type="button"
            className="video-editor-close"
            onClick={onClose}
            aria-label="Close editor"
          >
            <X size={20} />
          </button>
        </header>

        <div className="video-editor-content">
          <div className="video-editor-preview">
            <canvas
              ref={canvasRef}
              className="video-editor-canvas"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
            <video ref={screenVideoRef} style={{ display: "none" }} />
            <video ref={webcamVideoRef} style={{ display: "none" }} />
          </div>

          <div className="video-editor-sidebar">
            <div className="video-editor-section">
              <h3>Webcam Bubble</h3>
              <label className="video-editor-toggle">
                <input
                  type="checkbox"
                  checked={bubbleConfig.enabled}
                  onChange={(e) => {
                    setBubbleConfig(prev => ({ ...prev, enabled: e.target.checked }));
                    renderFrame();
                  }}
                />
                <span>Show webcam</span>
              </label>

              {bubbleConfig.enabled && (
                <>
                  <label className="video-editor-label">Shape</label>
                  <div className="video-editor-shape-options">
                    <button
                      className={bubbleConfig.shape === "circle" ? "active" : ""}
                      onClick={() => {
                        setBubbleConfig(prev => ({ ...prev, shape: "circle" }));
                        renderFrame();
                      }}
                    >
                      <Circle size={20} />
                      Circle
                    </button>
                    <button
                      className={bubbleConfig.shape === "rounded" ? "active" : ""}
                      onClick={() => {
                        setBubbleConfig(prev => ({ ...prev, shape: "rounded" }));
                        renderFrame();
                      }}
                    >
                      <Square size={20} />
                      Rounded
                    </button>
                  </div>

                  <label className="video-editor-label">
                    Size: {bubbleConfig.size}px
                  </label>
                  <input
                    type="range"
                    min="100"
                    max="400"
                    value={bubbleConfig.size}
                    onChange={(e) => {
                      setBubbleConfig(prev => ({ ...prev, size: parseInt(e.target.value) }));
                      renderFrame();
                    }}
                  />
                </>
              )}
            </div>

            <div className="video-editor-controls">
              <button
                onClick={() => setPlaying(!playing)}
                className="video-editor-play"
              >
                {playing ? <Pause size={20} /> : <Play size={20} />}
                {playing ? "Pause" : "Play"}
              </button>
              <button onClick={handleReset}>
                <RotateCcw size={16} />
                Reset
              </button>
            </div>

            <div className="video-editor-timeline">
              <span>{formatTime(currentTime)}</span>
              <input
                type="range"
                min="0"
                max={duration}
                step="0.1"
                value={currentTime}
                onChange={(e) => {
                  const time = parseFloat(e.target.value);
                  if (screenVideoRef.current) screenVideoRef.current.currentTime = time;
                  if (webcamVideoRef.current) webcamVideoRef.current.currentTime = time;
                  setCurrentTime(time);
                  renderFrame();
                }}
              />
              <span>{formatTime(duration)}</span>
            </div>

            <button
              className="video-editor-export"
              onClick={handleExport}
              disabled={exporting}
            >
              <Download size={16} />
              {exporting ? "Exporting..." : "Export Video"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
