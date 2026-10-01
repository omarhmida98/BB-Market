import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, RotateCcw, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CameraCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export function CameraCapture({ isOpen, onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  const startCamera = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      // Stop any previous stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err: any) {
      console.error("[CameraCapture] Error accessing camera:", err);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setError("Accès à la caméra refusé. Veuillez autoriser l'accès à la caméra dans les paramètres de votre navigateur.");
      } else if (err.name === "NotFoundError") {
        setError("Aucune caméra trouvée sur cet appareil.");
      } else {
        setError("Impossible d'accéder à la caméra. Vérifiez que vous utilisez un appareil avec caméra.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [facingMode]);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen, startCamera]);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const width = video.videoWidth;
    const height = video.videoHeight;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Flip horizontally if using front camera (user facing)
    if (facingMode === "user") {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, width, height);

    // Reset transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Convert canvas to blob
    canvas.toBlob((blob) => {
      if (blob) {
        setCapturedBlob(blob);
        setCapturedImage(canvas.toDataURL("image/jpeg", 0.9));
      }
    }, "image/jpeg", 0.9);

    // Stop the stream while showing captured image
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, [facingMode]);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setCapturedBlob(null);
    startCamera();
  }, [startCamera]);

  const confirmCapture = useCallback(() => {
    if (capturedBlob) {
      // Create a File from the blob
      const file = new File([capturedBlob], `capture_${Date.now()}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
      onCapture(file);
      // Reset state
      setCapturedImage(null);
      setCapturedBlob(null);
      onClose();
    }
  }, [capturedBlob, onCapture, onClose]);

  const handleClose = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCapturedImage(null);
    setCapturedBlob(null);
    setError(null);
    onClose();
  }, [onClose]);

  const toggleCamera = useCallback(() => {
    setFacingMode(prev => prev === "environment" ? "user" : "environment");
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg bg-slate-900 border-white/10 text-white p-0 overflow-hidden rounded-3xl">
        <DialogHeader className="p-6 pb-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
              <Camera className="w-5 h-5 text-primary" />
              {capturedImage ? "Photo capturée" : "Prendre une photo"}
            </DialogTitle>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </DialogHeader>

        <div className="p-6">
          <div className="relative aspect-[4/3] bg-black rounded-2xl overflow-hidden mb-6">
            {/* Loading State */}
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-20">
                <div className="text-center">
                  <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-3" />
                  <p className="text-sm text-slate-400">Initialisation de la caméra...</p>
                </div>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900 z-20">
                <div className="text-center p-8">
                  <Camera className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <p className="text-red-400 text-sm mb-4">{error}</p>
                  <Button
                    onClick={startCamera}
                    variant="outline"
                    className="border-white/10 text-white hover:bg-white/10 rounded-xl"
                  >
                    Réessayer
                  </Button>
                </div>
              </div>
            )}

            {/* Video Viewfinder */}
            {!capturedImage && !isLoading && !error && (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${facingMode === "user" ? "scale-x-[-1]" : ""}`}
                />
                {/* Viewfinder overlay */}
                <div className="absolute inset-0 border-2 border-dashed border-white/20 m-8 rounded-2xl pointer-events-none" />
              </>
            )}

            {/* Captured Image Preview */}
            <AnimatePresence>
              {capturedImage && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0"
                >
                  <img
                    src={capturedImage}
                    alt="Capture"
                    className="w-full h-full object-contain bg-black"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Hidden canvas for capture */}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Button Controls */}
          <div className="flex items-center justify-center gap-4">
            {!capturedImage && !error && (
              <>
                {/* Capture Button */}
                <button
                  onClick={capturePhoto}
                  disabled={isLoading}
                  className="w-16 h-16 rounded-full bg-white hover:bg-slate-100 transition-all active:scale-90 flex items-center justify-center shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="w-12 h-12 rounded-full border-2 border-slate-900" />
                </button>

                {/* Flip Camera Button */}
                <button
                  onClick={toggleCamera}
                  disabled={isLoading}
                  className="absolute end-8 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-5 h-5 text-white" />
                </button>
              </>
            )}

            {capturedImage && (
              <div className="flex gap-3 w-full">
                <Button
                  onClick={retake}
                  variant="outline"
                  className="flex-1 h-12 rounded-xl border-white/10 text-white hover:bg-white/10 font-bold"
                >
                  <RotateCcw className="w-4 h-4 me-2" />
                  Reprendre
                </Button>
                <Button
                  onClick={confirmCapture}
                  className="flex-1 h-12 rounded-xl bg-primary hover:bg-primary/90 font-bold"
                >
                  <Check className="w-4 h-4 me-2" />
                  Utiliser cette photo
                </Button>
              </div>
            )}
          </div>

          {!capturedImage && !error && (
            <p className="text-center text-xs text-slate-500 mt-4">
              Appuyez sur le cercle pour capturer la photo
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

