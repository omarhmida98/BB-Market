import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useQuery } from "@tanstack/react-query";
import type { Promo } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Sparkles, Gift, Check, Plus, ShoppingBag, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSelection } from "@/hooks/use-selection";
import { useAuth } from "@/hooks/use-auth";
import { SiteBackground } from "@/components/SiteBackground";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue, 
} from "@/components/ui/select";
import { PRODUCT_CATEGORIES } from "@shared/schema";
import { useState, useMemo } from "react";

export default function Promos() {
    const { t } = useTranslation();
    const { isSelected, addToSelection, removeFromSelection, totalItems } = useSelection();
    const { user } = useAuth();
    const [, setLocation] = useLocation();
    const [search, setSearch] = useState("");
    const [category, setCategory] = useState<string>("all");
    const [selectedPromoImage, setSelectedPromoImage] = useState<Promo | null>(null);

    const { data: promos, isLoading, isError } = useQuery<Promo[]>({
        queryKey: ["/api/promos"],
    });

    const filteredPromos = useMemo(() => {
        if (!promos) return [];
        return promos.filter(promo => {
            const matchesSearch = !search ||
                promo.productName?.toLowerCase().includes(search.toLowerCase()) ||
                promo.description?.toLowerCase().includes(search.toLowerCase());
            const matchesCategory = category === "all" || promo.category === category;
            return matchesSearch && matchesCategory;
        });
    }, [promos, search, category]);

    const activeFiltersCount = (category !== "all" ? 1 : 0) + (search ? 1 : 0);

    return (
        <div className="min-h-screen font-sans relative">
            <SiteBackground />
            <Navbar />

            <div className="pt-32 pb-12 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-primary/10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center max-w-3xl mx-auto"
                    >
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/50 backdrop-blur-sm border border-primary/20 text-primary text-sm font-bold mb-6 shadow-sm">
                            <Sparkles className="w-4 h-4 animate-pulse" />
                            {t("promos.flash")}
                        </div>
                        <h1 className="text-4xl md:text-5xl font-display font-bold text-slate-900 mb-4">
                            {t("promos.title")}
                        </h1>
                        <p className="text-slate-600 text-lg">
                            {t("promos.subtitle")}
                        </p>
                    </motion.div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                {/* Filters Section */}
                <div className="bg-white/60 backdrop-blur-md p-6 rounded-3xl border border-slate-200/50 shadow-sm mb-12">
                    <div className="flex flex-col md:flex-row gap-6 items-end">
                        <div className="flex-1 space-y-2 w-full">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ms-1">
                                {t("products.search")}
                            </label>
                            <div className="relative">
                                <Search className="absolute start-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder={t("products.search_placeholder")}
                                    className="ps-12 h-14 bg-white border-slate-200 rounded-2xl focus:ring-primary/20 transition-all font-medium"
                                />
                                {search && (
                                    <button
                                        onClick={() => setSearch("")}
                                        className="absolute end-4 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-100 rounded-full transition-colors"
                                    >
                                        <X className="w-4 h-4 text-slate-400" />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="w-full md:w-64 space-y-2">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ms-1">
                                {t("products.category")}
                            </label>
                            <Select value={category} onValueChange={setCategory}>
                                <SelectTrigger className="h-14 bg-white border-slate-200 rounded-2xl font-medium focus:ring-primary/20">
                                    <SelectValue placeholder={t("products.all_categories")} />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl">
                                    <SelectItem value="all" className="font-medium">{t("products.all_categories")}</SelectItem>
                                    {PRODUCT_CATEGORIES.map((cat) => (
                                        <SelectItem key={cat} value={cat} className="font-medium">{cat}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {activeFiltersCount > 0 && (
                            <button
                                onClick={() => { setSearch(""); setCategory("all"); }}
                                className="h-14 px-6 text-sm font-bold text-primary hover:bg-primary/5 rounded-2xl transition-all flex items-center gap-2 whitespace-nowrap"
                            >
                                <X className="w-4 h-4" />
                                {t("products.clear_all")}
                            </button>
                        )}
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex justify-center items-center py-32">
                        <Loader2 className="w-10 h-10 text-primary animate-spin" />
                    </div>
                ) : isError ? (
                    <div className="text-center py-20 bg-red-50 rounded-2xl border border-red-100 italic text-red-600">
                        {t("products.error")}
                    </div>
                ) : filteredPromos.length === 0 ? (
                    <div className="text-center py-20 bg-slate-50 rounded-3xl border border-slate-100">
                        <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                            <Gift className="w-10 h-10 text-slate-200" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900 mb-2">
                            {search || category !== 'all' ? t("products.no_products") : t("stickers.coming_soon")}
                        </h3>
                        <p className="text-slate-500">
                            {t("products.clear_filters")}
                        </p>
                    </div>
                ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {filteredPromos.map((promo, idx) => {
                            const selected = isSelected(promo.id, 'promo');
                            const toggleSelection = () => {
                                if (!user) {
                                    // Save selection first, then redirect
                                    addToSelection({
                                        id: promo.id,
                                        name: promo.productName || "Promotion",
                                        description: promo.description ?? undefined,
                                        imageUrl: promo.imageUrl,
                                        type: 'promo'
                                    });
                                    setLocation("/login?redirect=/contact");
                                    return;
                                }
                                if (selected) {
                                    removeFromSelection(promo.id, 'promo');
                                } else {
                                    addToSelection({
                                        id: promo.id,
                                        name: promo.productName || "Promotion",
                                        description: promo.description ?? undefined,
                                        imageUrl: promo.imageUrl,
                                        type: 'promo'
                                    });
                                }
                            };

                            return (
                                <motion.div
                                    key={promo.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.1 }}
                                    whileHover={{ y: -8 }}
                                    className={`group relative bg-white rounded-[2rem] overflow-hidden border-2 transition-all duration-300 shadow-lg hover:shadow-2xl ${selected ? 'border-primary ring-4 ring-primary/10' : 'border-slate-100'
                                        }`}
                                >
                                    <div className="aspect-[16/10] overflow-hidden bg-slate-100 relative cursor-pointer" onClick={() => setSelectedPromoImage(promo)}>
                                        <img
                                            src={promo.imageUrl}
                                            alt={promo.productName || "Promotion"}
                                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                                        <div className="absolute top-4 end-4 z-10">
                                            {selected && (
                                                <div className="px-3 py-1 bg-primary text-white rounded-full text-[10px] font-bold shadow-lg flex items-center gap-1 animate-in zoom-in-50">
                                                    <Check className="w-3 h-3" /> {t("product_card.selected")}
                                                </div>
                                            )}
                                        </div>

                                        {promo.category && (
                                            <div className="absolute top-4 start-4 z-10">
                                                <div className="px-3 py-1 bg-white/90 backdrop-blur-sm text-slate-900 rounded-full text-[10px] font-bold shadow-sm border border-slate-100">
                                                    {promo.category}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="p-8">
                                        <h3 className="text-xl font-bold text-slate-900 mb-3 group-hover:text-primary transition-colors line-clamp-1">
                                            {promo.productName || "Promotion Flash"}
                                        </h3>
                                        <p className="text-slate-500 text-sm mb-8 line-clamp-2 leading-relaxed h-10">
                                            {promo.description || t("promos.subtitle")}
                                        </p>

                                        <button
                                            onClick={toggleSelection}
                                            className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 ${selected
                                                ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                                : "bg-primary text-white shadow-xl shadow-primary/20 hover:bg-primary/90"
                                                }`}
                                        >
                                            {selected ? (
                                                <>{t("product_card.remove")}</>
                                            ) : (
                                                <>
                                                    <Plus className="w-4 h-4" /> {t("product_card.select")}
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Float selection status for Promos page */}
            <AnimatePresence>
                {totalItems > 0 && (
                    <motion.div
                        initial={{ y: 100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 100, opacity: 0 }}
                        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4"
                    >
                        <div className="bg-slate-900 text-white p-4 rounded-3xl shadow-2xl flex items-center justify-between border border-white/10 backdrop-blur-xl">
                            <div className="flex items-center gap-4 ps-2">
                                <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
                                    <ShoppingBag className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">{t("contact.selection_title")}</p>
                                    <p className="font-bold">{totalItems} {totalItems > 1 ? t("selection_float.item_count_plural") : t("selection_float.item_count_singular")}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => window.location.href = '/contact'}
                                className="px-6 py-3 bg-white text-slate-900 rounded-2xl font-black text-sm hover:bg-primary hover:text-white transition-all active:scale-95"
                            >
                                {t("selection_float.order")}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {selectedPromoImage && (
                <ImageViewerModal
                    isOpen={!!selectedPromoImage}
                    onClose={() => setSelectedPromoImage(null)}
                    imageUrl={selectedPromoImage.imageUrl}
                    title={selectedPromoImage.productName || "Promotion"}
                    description={selectedPromoImage.description ?? undefined}
                />
            )}

            <Footer />
        </div>
    );
}
