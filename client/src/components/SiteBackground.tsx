import { motion, useMotionValue, useSpring, useMotionTemplate } from "framer-motion";
import { useMemo, useEffect } from "react";

export function SiteBackground() {
    // Highly performant mouse tracking
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    // Smooth physics for the spotlight
    const smoothX = useSpring(mouseX, { damping: 50, stiffness: 400 });
    const smoothY = useSpring(mouseY, { damping: 50, stiffness: 400 });
    
    // Create a dynamic radial gradient using the motion values
    const spotlightBg = useMotionTemplate`radial-gradient(600px circle at ${smoothX}px ${smoothY}px, rgba(59, 130, 246, 0.12), transparent 40%)`;

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            mouseX.set(e.clientX);
            mouseY.set(e.clientY);
        };
        window.addEventListener("mousemove", handleMouseMove);
        return () => window.removeEventListener("mousemove", handleMouseMove);
    }, [mouseX, mouseY]);

    // Generate static random values for floating particles so they don't jump on re-renders
    const particles = useMemo(() => Array.from({ length: 30 }).map((_, i) => ({
        id: i,
        size: Math.random() * 4 + 2,
        initialX: Math.random() * 100,
        initialY: Math.random() * 120, // Start slightly lower sometimes
        xOffset: (Math.random() - 0.5) * 60, // Sway left/right randomly
        yOffset: -100 - Math.random() * 150, // Float UP significantly
        duration: Math.random() * 25 + 20, // Slow movement
        delay: Math.random() * -30, // Negative delay so they are already moving when the page loads
        opacity: Math.random() * 0.4 + 0.1 // Max opacity peak
    })), []);

    return (
        <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none mesh-gradient">
            {/* Subtle Noise Overlay */}
            <div className="absolute inset-0 noise-overlay" />

            {/* Animated Blobs for Dynamic Feel */}
            <motion.div
                className="absolute -top-[10%] -left-[10%] w-[50vw] h-[50vw] rounded-full bg-blue-400/10 blur-[120px] animate-blob"
            />
            <motion.div
                className="absolute top-[20%] -right-[10%] w-[40vw] h-[40vw] rounded-full bg-indigo-400/10 blur-[120px] animate-blob-reverse"
            />
            <motion.div
                className="absolute -bottom-[10%] left-[20%] w-[45vw] h-[45vw] rounded-full bg-blue-300/10 blur-[120px] animate-blob"
            />

            {/* Glowing Floating Particles */}
            {particles.map((p) => (
                <motion.div
                    key={p.id}
                    className="absolute rounded-full bg-primary/60 text-primary shadow-[0_0_12px_currentColor]"
                    style={{
                        width: p.size,
                        height: p.size,
                        left: `${p.initialX}%`,
                        top: `${p.initialY}%`,
                    }}
                    animate={{
                        y: [0, p.yOffset],
                        x: [0, p.xOffset, 0],
                        opacity: [0, p.opacity, 0],
                    }}
                    transition={{
                        duration: p.duration,
                        repeat: Infinity,
                        ease: "linear",
                        delay: p.delay,
                    }}
                />
            ))}

            {/* Very faint refined grid for structure - only shows on larger screens */}
            <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_20%,transparent_100%)]" />
            
            {/* Mouse-following spotlight */}
            <motion.div
                className="pointer-events-none absolute inset-0 z-30 transition-opacity duration-300 hidden md:block"
                style={{ background: spotlightBg }}
            />
        </div>
    );
}
