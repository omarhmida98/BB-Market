import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useQuery } from "@tanstack/react-query";
import type { Settings } from "@shared/schema";
import { motion } from "framer-motion";
import { Loader2, Sparkles, Image as ImageIcon, Check, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SiteBackground } from "@/components/SiteBackground";
import { FaWhatsapp } from "react-icons/fa";

export default function Stickers() {
    const { t } = useTranslation();

    const { data: stickerCatalogs, isLoading: loadingStickerCatalogs } = useQuery<any[]>({
        queryKey: ["/api/stickers"],
    });

    const { data: settings } = useQuery<Settings>({
        queryKey: ["/api/settings"],
    });

    return (
        <div className="min-h-screen font-sans relative">
            <SiteBackground />
            <Navbar />

            <div className="pt-32 pb-12 bg-gradient-to-r from-orange-500/10 via-orange-100/5 to-transparent border-b border-orange-200/20">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center max-w-3xl mx-auto"
                    >
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/50 backdrop-blur-sm border border-orange-200 text-orange-600 text-sm font-bold mb-6 shadow-sm">
                            <Sparkles className="w-4 h-4" />
                            {t('stickers.new_service')}
                        </div>
                        <h1 className="text-4xl md:text-5xl font-display font-bold text-slate-900 mb-4">
                            {t("stickers.title")}
                        </h1>
                        <p className="text-slate-600 text-lg">
                            {t("stickers.description")}
                        </p>
                    </motion.div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                <div className="grid lg:grid-cols-2 gap-16 items-start">
                    {/* Left Side: Services & Contact */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="space-y-8"
                    >
                        <div className="grid sm:grid-cols-2 gap-4">
                            {[
                                { key: 'anniversaries', label: t('stickers.categories.anniversaries') },
                                { key: 'weddings', label: t('stickers.categories.weddings') },
                                { key: 'births', label: t('stickers.categories.births') },
                                { key: 'events', label: t('stickers.categories.events') },
                                { key: 'tshirts', label: t('stickers.categories.tshirts') }
                            ].map((item) => (
                                <div key={item.key} className="flex items-center gap-3 p-5 bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                                    <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600">
                                        <Check className="w-6 h-6" />
                                    </div>
                                    <span className="font-bold text-slate-800">{item.label}</span>
                                </div>
                            ))}
                        </div>

                        <div className="bg-slate-900 text-white rounded-[2.5rem] relative overflow-hidden shadow-2xl flex flex-col">
                            {/* T-shirt Photo at top of sidebar */}
                            <div className="w-full h-48 sm:h-64 overflow-hidden relative">
                                <img 
                                    src="/attached_assets/clothing_print_demo_1774045917596.jpg" 
                                    alt="Print on Clothes" 
                                    className="w-full h-full object-cover opacity-80 group-hover:scale-110 transition-transform duration-500"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 to-transparent" />
                            </div>
                            
                            <div className="p-8 pt-4">
                                <h3 className="text-xl font-bold mb-4 relative z-10">{t('stickers.contact_whatsapp')}</h3>
                                <p className="text-slate-400 mb-8 relative z-10">{t('stickers.description')}</p>

                            <a
                                href="https://wa.me/21628858245"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-6 p-4 bg-white/5 border border-white/10 rounded-3xl hover:bg-white/10 transition-all group"
                            >
                                <div className="w-14 h-14 rounded-2xl bg-[#25D366] flex items-center justify-center text-white shadow-xl shadow-[#25D366]/20 group-hover:scale-110 transition-transform">
                                    <FaWhatsapp className="w-8 h-8" />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{t('nav.contact')}</p>
                                    <p className="text-xl font-display font-black text-white group-hover:text-[#25D366] transition-colors">{t('stickers.contact_phone')}</p>
                                </div>
                            </a>
                            <p className="mt-6 text-sm text-slate-400 font-medium leading-relaxed italic border-t border-white/5 pt-6">
                                {t('stickers.clothes_print_info')}
                            </p>
                        </div>
                    </div>
                </motion.div>

                    {/* Right Side: Catalogs */}
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="space-y-6"
                    >
                        <h3 className="text-2xl font-bold text-slate-900 mb-8 flex items-center gap-3">
                            <ImageIcon className="w-6 h-6 text-orange-500" />
                            {t('stickers.available_catalogs')}
                        </h3>

                        {loadingStickerCatalogs ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="w-10 h-10 text-orange-500 animate-spin" />
                            </div>
                        ) : (
                            <div className="flex flex-col gap-5">
                                {stickerCatalogs?.map((catalog) => (
                                    <a
                                        key={catalog.id}
                                        href={catalog.imageUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group p-6 bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-2xl hover:border-orange-300 transition-all duration-300 flex items-center justify-between"
                                    >
                                        <div className="flex items-center gap-6">
                                            <div className="w-20 h-20 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500 group-hover:bg-orange-500 group-hover:text-white transition-all duration-500 shadow-inner overflow-hidden">
                                                {catalog.imageUrl ? (
                                                    <img src={catalog.imageUrl} alt={catalog.title} className="w-full h-full object-cover" />
                                                ) : (
                                                    <ImageIcon className="w-8 h-8" />
                                                )}
                                            </div>
                                            <div className="text-start">
                                                <h4 className="font-bold text-slate-900 text-lg group-hover:text-orange-600 transition-colors uppercase tracking-tight">{t(catalog.title)}</h4>
                                                <p className="text-slate-500 text-sm line-clamp-1">{t(catalog.description)}</p>
                                            </div>
                                        </div>
                                        <div className="w-12 h-12 rounded-full border border-slate-100 flex items-center justify-center text-slate-300 group-hover:bg-orange-50 group-hover:text-orange-500 group-hover:border-orange-100 transition-all">
                                            <ArrowRight className="w-5 h-5" />
                                        </div>
                                    </a>
                                ))}

                                {(!stickerCatalogs || stickerCatalogs.length === 0) && settings?.stickersImageUrl && (
                                    <a
                                        href={settings.stickersImageUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group p-6 bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-2xl hover:border-orange-300 transition-all duration-300 flex items-center justify-between"
                                    >
                                        <div className="flex items-center gap-6">
                                            <div className="w-20 h-20 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-500 group-hover:bg-orange-500 group-hover:text-white transition-all duration-500 shadow-inner overflow-hidden">
                                                <img src={settings.stickersImageUrl} alt="Stickers Catalog" className="w-full h-full object-cover" />
                                            </div>
                                            <div className="text-start">
                                                <h4 className="font-bold text-slate-900 text-lg group-hover:text-orange-600 transition-colors uppercase tracking-tight">{t('stickers.general_catalog_title')}</h4>
                                                <p className="text-slate-500 text-sm">{t('stickers.general_catalog_desc')}</p>
                                            </div>
                                        </div>
                                        <div className="w-12 h-12 rounded-full border border-slate-100 flex items-center justify-center text-slate-300 group-hover:bg-orange-50 group-hover:text-orange-500 group-hover:border-orange-100 transition-all">
                                            <ArrowRight className="w-5 h-5" />
                                        </div>
                                    </a>
                                )}

                                {(!stickerCatalogs || stickerCatalogs.length === 0) && !settings?.stickersImageUrl && (
                                    <div className="p-12 text-center bg-slate-50/50 rounded-3xl border border-dashed border-slate-200 text-slate-400">
                                        <Sparkles className="w-10 h-10 mx-auto mb-4 opacity-20" />
                                        {t('stickers.coming_soon')}
                                    </div>
                                )}
                            </div>
                        )}
                    </motion.div>
                </div>
            </div>

            <Footer />
        </div>
    );
}
