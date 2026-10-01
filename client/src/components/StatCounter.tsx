import { useEffect, useRef } from "react";
import { motion, useInView, useSpring, useTransform } from "framer-motion";

interface StatCounterProps {
    value: number;
    label: string;
    suffix?: string;
}

export function StatCounter({ value, label, suffix = "" }: StatCounterProps) {
    const ref = useRef(null);
    const isInView = useInView(ref, { once: true, margin: "-100px" });

    const spring = useSpring(0, {
        mass: 1,
        stiffness: 100,
        damping: 30,
    });

    const displayValue = useTransform(spring, (current) =>
        Math.round(current).toLocaleString()
    );

    useEffect(() => {
        if (isInView) {
            spring.set(value);
        }
    }, [isInView, spring, value]);

    return (
        <div ref={ref} className="text-center group p-6 rounded-2xl transition-all duration-300">
            <div className="text-4xl lg:text-5xl font-display font-extrabold text-slate-900 mb-2 flex justify-center items-center gap-1">
                <motion.span>{displayValue}</motion.span>
                {suffix && <span className="text-primary">{suffix}</span>}
            </div>
            <div className="text-sm font-semibold text-slate-500 uppercase tracking-widest group-hover:text-primary transition-colors">
                {label}
            </div>
        </div>
    );
}
