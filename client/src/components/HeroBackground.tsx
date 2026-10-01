import { motion } from "framer-motion";

export function HeroBackground() {
    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            {/* Primary accent circles */}
            <motion.div
                className="absolute top-[10%] -right-[5%] w-[40vw] h-[40vw] rounded-full bg-blue-400/10 blur-[100px] animate-blob"
            />

            <motion.div
                className="absolute bottom-[20%] -left-[10%] w-[35vw] h-[35vw] rounded-full bg-indigo-400/10 blur-[100px] animate-blob-reverse"
            />

            {/* Floating crisp geometric shapes */}
            <motion.div
                animate={{
                    rotate: 360,
                    y: [0, -20, 0],
                }}
                transition={{
                    rotate: { duration: 60, repeat: Infinity, ease: "linear" },
                    y: { duration: 5, repeat: Infinity, ease: "easeInOut" }
                }}
                className="absolute top-[20%] left-[15%] w-12 h-12 border border-primary/10 rounded-xl"
            />

            <motion.div
                animate={{
                    rotate: -360,
                    x: [0, 30, 0],
                }}
                transition={{
                    rotate: { duration: 50, repeat: Infinity, ease: "linear" },
                    x: { duration: 7, repeat: Infinity, ease: "easeInOut" }
                }}
                className="absolute bottom-[30%] right-[20%] w-16 h-16 border border-blue-200/20 rounded-full"
            />

            {/* Modern grid overlay with a more sophisticated mask */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_0%,#000_10%,transparent_100%)]" />
        </div>
    );
}
