import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { FaWhatsapp } from "react-icons/fa";
import { useTranslation } from "react-i18next";

export function WhatsAppButton() {
  const { t } = useTranslation();
  const [location] = useLocation();
  if (location.startsWith("/admin")) return null;
  const url = "https://wa.me/21627903117?text=" + encodeURIComponent(t("whatsapp.default_message", "Bonjour B&B Market, j'aimerais avoir plus d'informations sur vos produits."));
  return (
    <motion.a href={url} target="_blank" rel="noreferrer" initial={{ scale: 0 }} animate={{ scale: 1 }} whileHover={{ scale: 1.08 }} className="fixed bottom-6 end-6 z-50 w-14 h-14 rounded-full bg-[#25D366] text-white shadow-xl flex items-center justify-center" title={t("whatsapp.button_title", "WhatsApp B&B Market")}>
      <FaWhatsapp className="w-8 h-8" />
    </motion.a>
  );
}
