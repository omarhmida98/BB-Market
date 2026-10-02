import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag, Clock, CheckCircle2, XCircle } from "lucide-react";
import { resolvePromotion, type PromotionCandidate, type PromotionStatus } from "@shared/promotions";
import { formatDate, formatMoney } from "@/lib/format";

/**
 * Renders a product price, honouring whatever promotion is live right now.
 *
 * There is one component for this because the pricing rule must be identical on
 * the card, the detail page and the admin preview. Each of those call sites
 * previously formatted `product.price` inline, which is exactly how a card ends
 * up showing a discounted price while the detail page shows the old one.
 *
 * Time is kept in React state and refreshed on an interval rather than read once
 * during render. A promotion that lapses at a fixed instant then disappears on
 * its own, even if the tab stays open for hours, instead of lingering until the
 * customer reloads.
 */
export function PromoPrice({
  product,
  size = "default",
  showBadge = true,
}: {
  product: PromotionCandidate;
  /** `lg` is used on the detail page; `sm` inside dense admin tables. */
  size?: "sm" | "default" | "lg";
  showBadge?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // 30s is a compromise: fine-grained enough that a lapsing offer looks
    // timely, coarse enough that this is not a per-second re-render. Visibility
    // is checked so a backgrounded tab stops burning timers entirely.
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        setNow(Date.now());
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const { status, effectivePrice, regularPrice, discountPercent, promoEnd } =
    resolvePromotion(product, now);

  const priceClass =
    size === "lg"
      ? "text-4xl font-black"
      : size === "sm"
        ? "text-sm font-bold"
        : "text-2xl font-black";

  // The shelf card and the detail page share this renderer, so a price is
  // grouped and decimal-separated in the reader's locale in both places.
  const format = (value: number) => formatMoney(value, i18n.language);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        {status === "active" ? (
          <>
            <span
              className={`${priceClass} text-primary whitespace-nowrap`}
              data-testid="promo-effective-price"
            >
              {format(effectivePrice)}
            </span>
            <span
              className={`${
                size === "sm" ? "text-xs" : "text-sm"
              } text-muted-foreground line-through whitespace-nowrap`}
              data-testid="promo-regular-price"
            >
              {format(regularPrice)}
            </span>
          </>
        ) : (
          <span className={`${priceClass} text-primary whitespace-nowrap`} data-testid="promo-effective-price">
            {format(effectivePrice)}
          </span>
        )}

        {showBadge && status === "active" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold shadow-sm">
            <Tag className="w-3 h-3" />
            {t("promotion.discount", "-{{percent}}%", { percent: discountPercent })}
          </span>
        )}
      </div>

      {status === "scheduled" && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
          <Clock className="w-3.5 h-3.5" />
          {t("promotion.scheduled", "Bientôt en promotion")}
        </span>
      )}

      {status === "expired" && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <XCircle className="w-3.5 h-3.5" />
          {t("promotion.expired", "Promotion terminée")}
        </span>
      )}

      {status === "active" && promoEnd && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {t("promotion.ends_at", "Offre valide jusqu'au {{date}}", {
            date: formatDate(promoEnd, i18n.language, {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            }),
          })}
        </span>
      )}
    </div>
  );
}

/**
 * Compact status pill for the admin product table.
 *
 * Shows every state including `none`, because an admin scanning the list needs
 * to tell "no promotion" apart from "promotion configured but not running" — the
 * second one silently does nothing to the price and is otherwise invisible.
 */
export function PromotionStatusBadge({ status }: { status: PromotionStatus }) {
  const { t } = useTranslation();

  if (status === "none") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const styles: Record<Exclude<PromotionStatus, "none">, string> = {
    active: "bg-emerald-500 text-white",
    scheduled: "bg-blue-500 text-white",
    expired: "bg-slate-400 text-white",
  };

  const labels: Record<Exclude<PromotionStatus, "none">, string> = {
    active: t("promotion.active", "Active"),
    scheduled: t("promotion.scheduled_short", "Programmée"),
    expired: t("promotion.expired_short", "Terminée"),
  };

  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}