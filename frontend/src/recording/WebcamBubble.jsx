import React, { useEffect, useRef, useState } from "react";
import { CameraOff } from "lucide-react";

/**
 * Draggable webcam bubble overlay for screen recordings.
 * Shows webcam feed in a circular or rounded bubble that can be positioned by the user.
 */
export function WebcamBubble({ enabled, shape = "circle", preview = false, initialPosition = null, onPositionChange, mediaStream }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [position, setPosition] = useState(initialPosition || { x: window.innerWidth - 240, y: window.innerHeight - 240 }); // Default bottom-right
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const isCircle = shape === "circle";

  // Start/stop webcam stream based on enabled prop
  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    let ownedStream;
    (mediaStream ? Promise.resolve(mediaStream) : navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user"
      },
      audio: false
    }))
      .then(resolvedStream => {
        if (!mounted) {
          if (!mediaStream) resolvedStream.getTracks().forEach(track => track.stop());
          return;
        }
        ownedStream = resolvedStream;
        setStream(resolvedStream);
        setError(null);
        if (videoRef.current) {
          videoRef.current.srcObject = resolvedStream;
        }
      })
      .catch(err => {
        if (!mounted) return;
        console.error("Webcam access error:", err);
        setError(err.name === "NotAllowedError"
          ? "Camera permission denied"
          : "Could not access camera");
      });

    return () => {
      mounted = false;
      if (!mediaStream) ownedStream?.getTracks().forEach(track => track.stop());
    };
  }, [enabled, mediaStream]);

  // Update video element when stream changes
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Drag handlers
  const handlePointerDown = (e) => {
    if (!enabled || !stream) return;
    setIsDragging(true);
    const rect = containerRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
    containerRef.current.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;

    const bubble = containerRef.current;
    if (!bubble) return;

    const bubbleRect = bubble.getBoundingClientRect();

    let newX = e.clientX - dragOffset.x;
    let newY = e.clientY - dragOffset.y;

    // Constrain to viewport bounds
    newX = Math.max(0, Math.min(newX, window.innerWidth - bubbleRect.width));
    newY = Math.max(0, Math.min(newY, window.innerHeight - bubbleRect.height));

    const newPosition = { x: newX, y: newY };
    setPosition(newPosition);
    onPositionChange?.(newPosition);
  };

  const handlePointerUp = (e) => {
    if (isDragging) {
      setIsDragging(false);
      if (containerRef.current?.hasPointerCapture(e.pointerId)) containerRef.current.releasePointerCapture(e.pointerId);
    }
  };

  if (!enabled) return null;
  if (error) {
    return (
      <div className={`webcam-bubble webcam-error ${isCircle ? '' : 'rounded'}`} style={{ right: '40px', bottom: '40px' }}>
        <CameraOff size={24} />
        <span className="webcam-error-text">{error}</span>
      </div>
    );
  }
  if (!stream) return null;

  return (
    <div
      ref={containerRef}
      className={`webcam-bubble ${isDragging ? 'dragging' : ''} ${isCircle ? '' : 'rounded'} ${preview ? 'preview' : ''}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="webcam-video"
      />
      {preview && <div className="webcam-preview-hint">Drag to position</div>}
    </div>
  );
}
