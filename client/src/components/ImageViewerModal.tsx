import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { motion } from "framer-motion";

interface ImageViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  title: string;
  description?: string;
}

export function ImageViewerModal({
  isOpen,
  onClose,
  imageUrl,
  title,
  description
}: ImageViewerModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full max-h-[90vh] overflow-y-auto p-0 border-0 bg-transparent shadow-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="relative bg-white rounded-3xl overflow-hidden shadow-2xl"
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 end-4 z-50 p-2 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-colors shadow-lg"
          >
            <X className="w-6 h-6 text-slate-900" />
          </button>

          {/* Image */}
          <div className="relative bg-slate-100">
            <img
              src={imageUrl}
              alt={title}
              className="w-full h-auto max-h-[60vh] object-contain"
            />
          </div>

          {/* Content */}
          <div className="p-8">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">
              {title}
            </h2>
            {description && (
              <p className="text-slate-600 text-lg leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
