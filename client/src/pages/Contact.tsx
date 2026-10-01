import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertMessageSchema, type InsertMessage, SOCIAL_PLATFORMS } from "@shared/schema";
import { useSendMessage } from "@/hooks/use-messages";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { Loader2, Mail, MapPin, Phone, Send, ShoppingBag, Trash2, Minus, Plus } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { useSelection } from "@/hooks/use-selection";
import { useTranslation } from "react-i18next";
import { SiteBackground } from "@/components/SiteBackground";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useSocialMedia } from "@/hooks/use-social-media";
import { platformIcon } from "@/components/SocialEmbed";

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };
const CONTACT_ACCENT: Record<string, string> = {
  instagram: "text-pink-500",
  facebook: "text-blue-600 dark:text-blue-400",
  tiktok: "text-slate-900 dark:text-white",
};

export default function Contact() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const sendMessageMutation = useSendMessage();
  const { selection, clearSelection, updateQuantity } = useSelection();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: socialData } = useSocialMedia();
  const socialUrlFor = (platform: string) => {
    const row = (socialData || []).find((item) => item.platform === platform);
    const url = row?.url?.trim();
    return url ? url : null;
  };

  const form = useForm<InsertMessage>({
    resolver: zodResolver(insertMessageSchema),
    defaultValues: {
      name: "",
      phone: "",
      message: ""
    }
  });

  const { addToSelection } = useSelection();

  useEffect(() => {
    if (user) {
      form.setValue("name", user.fullName?.trim() || user.username || "");
      form.setValue("phone", user.phone?.trim() || "");
    }
  }, [form, user]);

  useEffect(() => {
    // This runs when the component mounts or URL search changes
    const params = new URLSearchParams(window.location.search);
    const productParam = params.get("product");

    // Add product from URL if not already in selection
    if (productParam && !selection.find(i => i.name === productParam)) {
      addToSelection({ id: `param-${Date.now()}`, name: productParam, type: 'product', quantity: 1 });
    }

    if (selection.length > 0) {
      const itemsList = selection
        .map(i => `\n • ${i.quantity || 1} x ${i.name}${i.description ? ` - ${i.description}` : ""}`)
        .join("");

      const intro = selection.length === 1
        ? t("contact.order_item_prefix")
        : t("contact.order_items_prefix");

      form.setValue("message", `${intro}${itemsList}\n\n`);
    }
  }, [form, selection, typeof window !== 'undefined' ? window.location.search : '', t, addToSelection]);
  const onSubmit = (data: InsertMessage) => {
    if (!user) {
      toast({
        variant: "destructive",
        title: t("auth.login_required_title"),
        description: t("auth.login_required_desc"),
      });
      setLocation("/login?redirect=/contact");
      return;
    }

    // Include the stringified selection in the message data
    const messageData = {
      ...data,
      selectedItems: selection.length > 0 ? JSON.stringify(selection) : undefined
    };

    sendMessageMutation.mutate(messageData, {
      onSuccess: () => {
        toast({
          title: t("contact.success_title"),
          description: t("contact.success_desc"),
        });
        form.reset();
        clearSelection();
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: t("contact.error_title"),
          description: error.message,
        });
      }
    });
  };

  return (
    <div className="min-h-screen font-sans relative">
      <SiteBackground />
      <Navbar />

      <div className="pt-32 pb-12 bg-primary text-white">
        <div className="max-w-7xl auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-3xl mx-auto"
          >
            <h1 className="text-4xl font-display font-bold mb-4">{t("contact.title")}</h1>
            <p className="text-blue-100 text-lg">
              {t("contact.subtitle")}
            </p>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-24">

          {/* Contact Info Side */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="mb-12">
              <h2 className="text-3xl font-display font-bold text-slate-900 mb-4">{t("contact.info_title")}</h2>
              <p className="text-slate-600">
                {t("contact.info_subtitle")}
              </p>
            </div>

            <div className="grid gap-8">
              {[
                {
                  icon: <MapPin />,
                  label: t("contact.address_label"),
                  value: t("contact.address_value"),
                  link: t("contact.maps_link")
                },
                { icon: <Phone />, label: t("contact.phone_label"), value: "+216 27 903 117" },
                { icon: <Mail />, label: t("contact.email_label"), value: "bbmarket26@gmail.com" },
              ].map((item, idx) => (
                <div key={idx} className="flex gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white shadow-sm border border-slate-100 flex items-center justify-center text-primary shrink-0">
                    {item.icon}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{item.label}</h4>
                    {item.link ? (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-900 font-medium whitespace-pre-line hover:text-primary transition-colors transition-all duration-300"
                      >
                        {item.value}
                      </a>
                    ) : (
                      <p className="text-slate-900 font-medium whitespace-pre-line">{item.value}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-12 pt-12 border-t border-slate-200 dark:border-slate-800">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-6">{t("contact.social_label")}</h4>
              <div className="flex gap-4">
                {SOCIAL_PLATFORMS.map((platform) => {
                  const url = socialUrlFor(platform);
                  if (!url) return null;
                  return (
                    <a
                      key={platform}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={PLATFORM_LABEL[platform]}
                      className={`w-12 h-12 rounded-full bg-white dark:bg-slate-900 shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-center hover:bg-primary hover:text-white hover:-translate-y-1 transition-all duration-300 ${CONTACT_ACCENT[platform]}`}
                    >
                      {platformIcon(platform, "w-5 h-5")}
                    </a>
                  );
                })}
              </div>
            </div>
          </motion.div>

          {/* Form Side */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white/80 backdrop-blur-md p-8 md:p-10 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/50"
          >
            <h2 className="text-2xl font-display font-bold text-slate-900 mb-8">{t("contact.form_title")}</h2>

            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 ms-1">
                  {t("contact.name_label")} <span className="text-red-500 ms-1">*</span>
                </label>
                <input
                  {...form.register("name")}
                  required
                  className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:outline-none focus:ring-4 focus:ring-primary/5 focus:bg-white focus:border-primary transition-all text-slate-900"
                  placeholder={t("contact.name_placeholder")}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 ms-1">
                  Email <span className="text-slate-400 text-xs font-normal">(pour recevoir le suivi de votre demande)</span>
                </label>
                <input
                  {...form.register("email")}
                  type="email"
                  className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:outline-none focus:ring-4 focus:ring-primary/5 focus:bg-white focus:border-primary transition-all text-slate-900"
                  placeholder="votre@email.com"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 ms-1">
                  {t("contact.phone_form_label")} <span className="text-red-500 ms-1">*</span>
                </label>
                <input
                  {...form.register("phone")}
                  required
                  className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:outline-none focus:ring-4 focus:ring-primary/5 focus:bg-white focus:border-primary transition-all text-slate-900"
                  placeholder={t("contact.phone_form_placeholder")}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700 ms-1">{t("contact.message_label")}</label>
                <textarea
                  {...form.register("message")}
                  rows={5}
                  className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:outline-none focus:ring-4 focus:ring-primary/5 focus:bg-white focus:border-primary transition-all text-slate-900 resize-none"
                  placeholder={t("contact.message_placeholder")}
                />
              </div>

<div className="bg-blue-50/50 border border-blue-100/50 p-6 rounded-[1.5rem] mb-6 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-primary">
                    <ShoppingBag className="w-5 h-5 font-bold" />
                    <span className="font-bold text-sm uppercase tracking-wider">{t("contact.selection_title")}</span>
                    {selection.length > 0 && (
                      <span className="bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {selection.length}
                      </span>
                    )}
                  </div>
                  {selection.length > 0 && (
                    <button
                      type="button"
                      onClick={() => clearSelection()}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                      title={t("contact.selection_clear")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {selection.length > 0 ? (
                  <>
                    <div className="space-y-2 max-h-48 overflow-y-auto pe-2 custom-scrollbar">
                      {selection.map(item => (
                        <div key={item.id} className="text-sm font-medium text-slate-600 bg-white/60 p-2 rounded-lg flex items-center justify-between group">
                          <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
                            {item.imageUrl && (
                              <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex-shrink-0">
                                <img
                                  src={item.imageUrl}
                                  alt={item.name}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1">
                                <span className="font-bold text-primary text-xs">{item.quantity}x</span>
                                <span className="truncate text-xs font-semibold">{item.name}</span>
                              </div>
                              {item.description && (
                                <p className="text-[10px] text-slate-400 truncate mt-0.5">{item.description}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 transition-opacity shrink-0 ms-2">
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, item.type, item.quantity - 1)}
                              className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-primary transition-all active:scale-90 disabled:opacity-40 shadow-sm"
                              disabled={item.quantity <= 1}
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="text-[10px] font-bold min-w-[1rem] text-center">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => updateQuantity(item.id, item.type, item.quantity + 1)}
                              className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded-md hover:bg-slate-50 hover:text-primary transition-all active:scale-90 shadow-sm"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-4 border-t border-blue-100/50">
                      <button
                        type="button"
                        onClick={() => {
                            if (!user) {
                              toast({
                                variant: "destructive",
                                title: t("auth.login_required_title"),
                                description: t("auth.login_required_desc"),
                              });
                              setLocation("/login?redirect=/contact");
                              return;
                            }

                          const items = selection.map(i => `${i.quantity} x ${i.name}`).join(", ");
                          const text = `Bonjour, je souhaite demander un devis pour : ${items}`;
                          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                          const url = isMobile
                            ? `https://wa.me/21627903117?text=${encodeURIComponent(text)}`
                            : `https://web.whatsapp.com/send?phone=21627903117&text=${encodeURIComponent(text)}`;
                          window.open(url, '_blank');
                        }}
                        className="w-full py-2.5 bg-[#25D366] hover:bg-[#128C7E] text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors shadow-sm"
                      >
                        <FaWhatsapp className="w-4 h-4" />
                        {t("contact.order_now")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-6">
                    <p className="text-sm text-slate-500 mb-4">
                      Votre sélection est vide.
                    </p>
                    <p className="text-xs text-slate-400 mb-4">
                      Explorez notre gamme complète de solutions d'emballage et de décoration.
                    </p>
                    <button
                      type="button"
                      onClick={() => setLocation("/products")}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors shadow-sm"
                    >
                      <ShoppingBag className="w-4 h-4" />
                      Parcourir les produits
                    </button>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={sendMessageMutation.isPending}
                className="w-full py-4 bg-primary text-white rounded-2xl font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 hover:bg-primary/90 active:translate-y-0 transition-all disabled:opacity-50 disabled:translate-y-0 flex items-center justify-center gap-2"
              >
                {sendMessageMutation.isPending ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> {t("contact.sending")}</>
                ) : (
                  <><Send className="w-5 h-5" /> {t("contact.send_btn")}</>
                )}
              </button>
            </form>
          </motion.div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
