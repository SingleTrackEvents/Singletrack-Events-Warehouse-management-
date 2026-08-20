import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

/**
 * Camera scanner for QR codes and item barcodes.
 *
 * Uses the native `BarcodeDetector` where the browser has it (Android Chrome,
 * Edge) because it is faster and handles 1D barcodes; everywhere else — notably
 * iOS Safari, which most of the crew will be on — it falls back to decoding
 * frames with jsQR. Either way there is a manual entry box underneath, because
 * cameras and wet lenses lose arguments with mud.
 */

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

type DetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/** Formats worth looking for: QR for crates, the rest for supplier barcodes. */
const FORMATS = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'];

function nativeDetector(): BarcodeDetectorLike | null {
  const ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!ctor) return null;
  try {
    return new ctor({ formats: FORMATS });
  } catch {
    return null;
  }
}

export function Scanner({
  onDetect,
  hint = 'Point at the QR code on the crate',
}: {
  onDetect: (value: string) => void;
  hint?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const streamRef = useRef<MediaStream>(null);
  // Guards against firing the same code repeatedly while it sits in frame.
  const lastRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    const detector = nativeDetector();

    const emit = (value: string) => {
      const now = Date.now();
      if (value === lastRef.current.value && now - lastRef.current.at < 2500) return;
      lastRef.current = { value, at: now };
      if (navigator.vibrate) navigator.vibrate(40);
      onDetect(value);
    };

    const tick = async () => {
      const video = videoRef.current;
      if (!cancelled && video && video.readyState >= 2) {
        try {
          if (detector) {
            const results = await detector.detect(video);
            if (results.length) emit(results[0].rawValue);
          } else {
            const canvas = canvasRef.current;
            const context = canvas?.getContext('2d', { willReadFrequently: true });
            if (canvas && context) {
              // Downscale before decoding — jsQR is pure JS and a full 1080p frame
              // every tick would drop the preview to a slideshow.
              const width = 480;
              const height = Math.round((video.videoHeight / video.videoWidth) * width) || 640;
              canvas.width = width;
              canvas.height = height;
              context.drawImage(video, 0, 0, width, height);
              const image = context.getImageData(0, 0, width, height);
              const found = jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' });
              if (found?.data) emit(found.data);
            }
          }
        } catch {
          // A dropped frame is not worth surfacing; the next tick retries.
        }
      }
      if (!cancelled) frame = requestAnimationFrame(() => void tick());
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play();
        }
        setReady(true);
        frame = requestAnimationFrame(() => void tick());
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow the camera, or type the code below.'
            : 'No camera available on this device. Type the code below instead.',
        );
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [onDetect]);

  /** Torch helps in a dark shipping container; not every device exposes it. */
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet],
      });
      setTorchOn(!torchOn);
    } catch {
      setError('This device does not let the app control the torch.');
    }
  };

  if (error) {
    return (
      <div className="card card-pad">
        <p className="small">{error}</p>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      <div className="scanner">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} className="sr-only" />
        <div className="scanner-frame" />
        <p className="scanner-hint">{ready ? hint : 'Starting camera…'}</p>
      </div>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => void toggleTorch()}>
        {torchOn ? '🔦 Torch off' : '🔦 Torch on'}
      </button>
    </div>
  );
}
