import { useSelection } from "@/hooks/use-selection";
import { ShoppingBag, ArrowRight, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { CartSheet } from "./CartSheet";
import { useAuth } from "@/hooks/use-auth";

export function SelectionFloat() {
    const { t } = useTranslation();
    const [location] = useLocation();
    const { totalItems, clearSelection } = useSelection();
    const [isCartOpen, setIsCartOpen] = useState(false);
    const { user } = useAuth();

    if (totalItems === 0 || location.startsWith("/admin")) return null;

    return (
        <>
            <AnimatePresence>
                <motion.div
                    initial={{ opacity: 0, y: 100 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 100 }}
                    className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 w-full max-w-lg px-4"
                >
                    <div className="bg-slate-900 text-white rounded-2xl shadow-2xl p-4 flex items-center justify-between border border-slate-800 backdrop-blur-md bg-opacity-95">
                        <div
                            className="flex items-center gap-4 cursor-pointer group"
                            onClick={() => setIsCartOpen(true)}
                        >
                            <div className="relative">
                                <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                                    <ShoppingBag className="w-6 h-6" />
                                </div>
                                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold w-6 h-6 flex items-center justify-center rounded-full border-2 border-slate-900">
                                    {totalItems}
                                </span>
                            </div>
                            <div>
                                <p className="font-bold text-sm group-hover:text-primary transition-colors">{t("selection_float.title")}</p>
                                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                                    {totalItems} {totalItems > 1 ? t("selection_float.item_count_plural") : t("selection_float.item_count_singular")}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={clearSelection}
                                className="p-2 text-slate-400 hover:text-white transition-colors"
                                title={t("selection_float.clear")}
                            >
                                <X className="w-5 h-5" />
                            </button>
                            {user ? (
                                <Link
                                    href="/checkout"
                                    className="px-6 py-3 bg-white text-slate-900 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-100 transition-all hover:scale-105"
                                >
                                    {t("selection_float.order")} <ArrowRight className="w-4 h-4" />
                                </Link>
                            ) : (
                                <Link
                                    href="/login?redirect=/checkout"
                                    className="px-6 py-3 bg-white text-slate-900 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-100 transition-all hover:scale-105"
                                >
                                    {t("selection_float.order")} <ArrowRight className="w-4 h-4" />
                                </Link>
                            )}
                        </div>
                    </div>
                </motion.div>
            </AnimatePresence>
            <CartSheet open={isCartOpen} onOpenChange={setIsCartOpen} />
        </>
    );
}

