import { motion } from "framer-motion";
import { memo } from "react";

export const AdminBackground = memo(function AdminBackground() {
    return (
        <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-[#020617]">
            {/* Subtle Noise Overlay */}
            <div className="absolute inset-0 noise-overlay opacity-[0.03]" />

            {/* Premium Animated Aurora/Blobs - Simplified for performance */}
            <motion.div
                animate={{
                    scale: [1, 1.1, 1],
                    opacity: [0.2, 0.25, 0.2],
                    x: [0, 30, 0],
                    y: [0, -20, 0],
                }}
                transition={{
                    duration: 35, // Slower
                    repeat: Infinity,
                    ease: "linear",
                }}
                className="absolute top-[-5%] left-[-5%] w-[60vw] h-[60vw] rounded-full bg-blue-600/15 blur-[100px]" // Reduced blur and size
            />

            <motion.div
                animate={{
                    scale: [1, 1.05, 1],
                    opacity: [0.15, 0.2, 0.15],
                    x: [0, -20, 0],
                    y: [0, 20, 0],
                }}
                transition={{
                    duration: 45, // Much slower
                    repeat: Infinity,
                    ease: "linear",
                }}
                className="absolute bottom-[-5%] right-[-5%] w-[50vw] h-[50vw] rounded-full bg-indigo-600/15 blur-[100px]" // Reduced blur and size
            />

            {/* Refined Grid System - Static */}
            <div
                className="absolute inset-0 opacity-[0.05]"
                style={{
                    backgroundImage: `linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)`,
                    backgroundSize: '80px 80px', // Larger grid = fewer elements to draw
                    maskImage: 'radial-gradient(circle at 50% 50%, black, transparent 70%)'
                }}
            />

            {/* Subtle Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-tr from-[#020617] via-transparent to-blue-900/5" />
        </div>
    );
});
