import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { motion } from "framer-motion";
import { Printer, Users, Zap, ShoppingBag, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { FaWhatsapp } from "react-icons/fa";
import printImg1 from "@assets/sred_print_1.jpg";
import printImg2 from "@assets/sred_print_2.jpg";
import printImg3 from "@assets/sred_print_3_boxes.jpg";
import { useState } from "react";

export default function Print() {
    const { t } = useTranslation();
    const [selectedImage, setSelectedImage] = useState<{src: string, title: string, desc: string} | null>(null);

    const features = [
        {
            icon: <Users className="w-6 h-6" />,
            title: t('print.team'),
            desc: t('print.description')
        },
        {
            icon: <Printer className="w-6 h-6" />,
            title: t('print.kraft_bags'),
            desc: t('print.subtitle')
        },
        {
            icon: <ShoppingBag className="w-6 h-6" />,
            title: t('print.boxes'),
            desc: t('print.subtitle')
        },
        {
            icon: <Zap className="w-6 h-6" />,
            title: t('print.technology'),
            desc: t('print.subtitle')
        }
    ];

    return (
        <div className="min-h-screen font-sans relative">
            {/* Fullscreen Video Background */}
            <div className="fixed inset-0 -z-10 bg-slate-900">
                <video
                    src="/sred_print_video.mp4"
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover opacity-60"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-slate-900/40 via-slate-900/70 to-slate-900/90" />
            </div>

            <Navbar />

            {/* Hero Section */}
            <div className="pt-32 pb-12 border-b border-white/10 relative z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center max-w-3xl mx-auto"
                    >
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white text-sm font-bold mb-6 shadow-xl">
                            <Sparkles className="w-4 h-4 text-blue-300" />
                            {t('print.new_quality')}
                        </div>
                        <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-4 drop-shadow-lg">
                            {t("print.title")}
                        </h1>
                        <p className="text-slate-200 text-lg drop-shadow-md">
                            {t("print.subtitle")}
                        </p>
                    </motion.div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 relative z-10">
                <div className="grid lg:grid-cols-2 gap-16 items-center">
                    {/* Media Column */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="space-y-6"
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="relative group overflow-hidden rounded-[2.5rem] shadow-xl border-4 border-white/20 cursor-pointer" onClick={() => setSelectedImage({src: printImg1, title: t('print.kraft_bags'), desc: t('print.description')})}>
                                <img
                                    src={printImg1}
                                    alt="SRED PRINT Kraft Bag Printing"
                                    className="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-700"
                                />
                            </div>
                            <div className="relative group overflow-hidden rounded-[2.5rem] shadow-xl border-4 border-white/20 cursor-pointer" onClick={() => setSelectedImage({src: printImg2, title: t('print.title'), desc: t('print.subtitle')})}>
                                <img
                                    src={printImg2}
                                    alt="SRED PRINT Professional Results"
                                    className="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-700"
                                />
                            </div>
                        </div>
                        <div className="relative group overflow-hidden rounded-[2.5rem] shadow-2xl border-4 border-white/20 cursor-pointer" onClick={() => setSelectedImage({src: printImg3, title: t('print.boxes'), desc: t('print.description')})}>
                            <img
                                src={printImg3}
                                alt="SRED PRINT Cake Box Printing"
                                className="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-700"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
                        </div>
                    </motion.div>

                    {/* Content Column */}
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 }}
                        className="space-y-10"
                    >
                        <div>
                            <h2 className="text-3xl font-display font-bold text-white mb-6 drop-shadow-md">{t('print.title')}</h2>
                            <p className="text-slate-300 text-lg leading-relaxed drop-shadow-md">{t('print.description')}</p>
                        </div>

                        <div className="grid gap-6">
                            {features.map((feature, idx) => (
                                <div key={idx} className="flex gap-4 p-4 rounded-2xl bg-white/10 backdrop-blur-md border border-white/10 hover:border-white/30 transition-all shadow-xl">
                                    <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-white shrink-0 shadow-inner">
                                        {feature.icon}
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-white mb-1">{feature.title}</h4>
                                        <p className="text-slate-300 text-sm">{feature.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="pt-6">
                            <div className="bg-white/10 backdrop-blur-xl text-white p-8 rounded-[2.5rem] border border-white/20 relative overflow-hidden shadow-2xl">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/20 blur-3xl rounded-full -mr-16 -mt-16" />
                                <h3 className="text-xl font-bold mb-4 relative z-10">{t('print.contact_whatsapp')}</h3>

                                <a
                                    href="https://wa.me/21629595150"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-6 p-4 bg-white/5 border border-white/10 rounded-3xl hover:bg-white/15 transition-all group"
                                >
                                    <div className="w-14 h-14 rounded-2xl bg-[#25D366] flex items-center justify-center text-white shadow-xl shadow-[#25D366]/30 group-hover:scale-110 transition-transform">
                                        <FaWhatsapp className="w-8 h-8" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-1">WhatsApp</p>
                                        <p className="text-xl font-display font-black text-white group-hover:text-[#25D366] transition-colors">+216 29 595 150</p>
                                    </div>
                                </a>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>

            {selectedImage && (
                <ImageViewerModal
                    isOpen={!!selectedImage}
                    onClose={() => setSelectedImage(null)}
                    imageUrl={selectedImage.src}
                    title={selectedImage.title}
                    description={selectedImage.desc}
                />
            )}

            <Footer />
        </div>
    );
}
