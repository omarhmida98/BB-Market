import { FaWhatsapp } from "react-icons/fa";
import { useTranslation } from "react-i18next";
import type { CustomerOrder } from "@shared/orders";

/** Same shop number as the global floating WhatsApp button. */
const WHATSAPP_NUMBER = "21627903117";

/**
 * WhatsApp link that pre-fills the order number.
 *
 * The order number is interpolated into the message the customer sends, not into
 * the URL, so nothing about the order leaks through the link target itself. The
 * id is formatted by `formatOrderNumber` and the message is `encodeURIComponent`-ed,
 * which keeps an unexpected value from breaking out of the query string.
 */
export function OrderWhatsAppButton({ order }: { order: CustomerOrder }) {
  const { t } = useTranslation();

  const message = t("account.whatsapp_message", {
    orderNumber: order.orderNumber,
    defaultValue: "Bonjour B&B Market, j'ai une question concernant ma commande {{orderNumber}}.",
  });

  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2 font-bold text-white shadow-sm hover:opacity-90 transition-opacity"
      data-testid="order-whatsapp"
    >
      <FaWhatsapp className="h-5 w-5" />
      {t("account.whatsapp", "Contacter sur WhatsApp")}
    </a>
  );
}