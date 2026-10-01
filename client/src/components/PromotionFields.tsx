import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tag, Percent, AlertTriangle } from "lucide-react";
import { resolvePromotion, validatePromotion } from "@shared/promotions";
import { formatMoney } from "@/lib/format";

/**
 * Promotion inputs plus a live preview, shared by the admin create form and the
 * admin edit dialog.
 *
 * Two rules are deliberately enforced here rather than left to the server:
 *
 *  1. Validation runs on every keystroke through the *shared*
 *     `validatePromotion`, the exact function `POST /api/products` and
 *     `PATCH /api/products/:id` call. If this component had its own copy of the
 *     rules, the preview would happily show "valid" for something the server
 *     then rejects.
 *
 *  2. The preview runs the real `resolvePromotion` at the current instant, so
 *     "scheduled" / "active" / "expired" in the admin is the same judgement the
 *     shopper's card and the checkout will make, not an optimistic guess.
 */

/** ISO string -> `datetime-local` value in the browser's timezone. */
export function toLocalInputValue(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type PromotionFormValues = {
  promoPrice: string;
  promoStart: string;
  promoEnd: string;
};

export const EMPTY_PROMOTION_FORM: PromotionFormValues = { promoPrice: "", promoStart: "", promoEnd: "" };

/** Read promotion values off a stored product into the string shape the form uses. */
export function promotionValuesFromProduct(product: {
  promoPrice?: number | string | null;
  promoStart?: string | number | Date | null;
  promoEnd?: string | number | Date | null;
}): PromotionFormValues {
  return {
    promoPrice: product.promoPrice === null || product.promoPrice === undefined ? "" : String(product.promoPrice),
    promoStart: toLocalInputValue(product.promoStart),
    promoEnd: toLocalInputValue(product.promoEnd),
  };
}

export function PromotionFields({
  regularPrice,
  values,
  onChange,
  idPrefix = "promo",
}: {
  /** The product's normal price, as typed in the parent form. */
  regularPrice: string;
  values: PromotionFormValues;
  onChange: (next: PromotionFormValues) => void;
  idPrefix?: string;
}) {
  const { t, i18n } = useTranslation();

  const errors = useMemo(
    () => validatePromotion({ price: regularPrice, ...values }),
    [regularPrice, values],
  );

  const preview = useMemo(
    () =>
      resolvePromotion({
        price: regularPrice,
        promoPrice: values.promoPrice,
        // datetime-local has no timezone, and `new Date(string)` reads it as
        // local time. Converting through Date keeps the preview and the stored
        // instant describing the same moment.
        promoStart: values.promoStart ? new Date(values.promoStart) : null,
        promoEnd: values.promoEnd ? new Date(values.promoEnd) : null,
      }),
    [regularPrice, values],
  );

  const savings = preview.regularPrice - preview.effectivePrice;

  const message: Record<string, string> = {
    "Promotional price cannot be negative.": t("promotion.errors.negative"),
    "Promotional price must be lower than the regular price.": t("promotion.errors.not_lower"),
    "The offer end must not be before the offer start.": t("promotion.errors.end_before_start"),
    "A promotional price is required to schedule an offer window.": t("promotion.errors.date_required"),
    "Regular price cannot be negative.": t("promotion.errors.negative"),
  };

  return (
    <div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-red-300 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4 text-red-500" />
        <span className="font-black text-sm uppercase tracking-wider text-red-600 dark:text-red-400">
          {t("promotion.title", "Promotion")}
        </span>
        <span className="text-xs text-muted-foreground ms-auto">
          {t("promotion.no_dates", "Sans limite de dates")}
        </span>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${idPrefix}-price`} className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
            {t("promotion.promo_price", "Prix promotionnel")}
          </label>
          <input
            id={`${idPrefix}-price`}
            type="number"
            step="0.001"
            min="0"
            placeholder={t("promotion.remove_promo", "Aucune promotion")}
            value={values.promoPrice}
            onChange={(e) => onChange({ ...values, promoPrice: e.target.value })}
            className="field mt-1"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-start`} className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
            {t("promotion.start_date", "Début de l'offre")}
          </label>
          <input
            id={`${idPrefix}-start`}
            type="datetime-local"
            value={values.promoStart}
            onChange={(e) => onChange({ ...values, promoStart: e.target.value })}
            className="field mt-1"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-end`} className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
            {t("promotion.end_date", "Fin de l'offre")}
          </label>
          <input
            id={`${idPrefix}-end`}
            type="datetime-local"
            value={values.promoEnd}
            onChange={(e) => onChange({ ...values, promoEnd: e.target.value })}
            className="field mt-1"
          />
        </div>
      </div>

      {errors.length > 0 && (
        <ul className="space-y-1">
          {errors.map((error) => (
            <li key={error} className="flex items-start gap-2 text-xs font-bold text-red-600 dark:text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{message[error] ?? error}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Live preview: exactly what a shopper will see, computed by the shared
          resolver rather than by a second admin-only implementation. */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
          {t("promotion.preview", "Aperçu")}
        </span>
        <span className="text-sm">
          <span className="text-muted-foreground">{t("promotion.regular_price", "Prix normal")}: </span>
          <span className="font-bold line-through">{formatMoney(preview.regularPrice, i18n.language)}</span>
        </span>
        {preview.status === "active" && (
          <>
            <span className="text-sm">
              <span className="text-muted-foreground">{t("promotion.promo_price", "Prix promotionnel")}: </span>
              <span className="font-black text-red-600">{formatMoney(preview.effectivePrice, i18n.language)}</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-black">
              <Percent className="w-3 h-3" />-{preview.discountPercent}%
            </span>
            <span className="text-xs text-muted-foreground">
              {t("promotion.preview_discount", "Économie : {{amount}} (-{{percent}}%)", {
                amount: formatMoney(savings, i18n.language),
                percent: preview.discountPercent,
              })}
            </span>
          </>
        )}
        <span className="text-xs font-bold ms-auto">
          {preview.status === "active" && <span className="text-emerald-600">{t("promotion.preview_active", "Cette promotion sera active")}</span>}
          {preview.status === "scheduled" && <span className="text-blue-600">{t("promotion.preview_scheduled", "Cette promotion commencera plus tard")}</span>}
          {preview.status === "expired" && <span className="text-muted-foreground">{t("promotion.preview_expired", "Cette promotion est terminée")}</span>}
          {preview.status === "none" && <span className="text-muted-foreground">{t("promotion.preview_none", "Aucune promotion : prix normal")}</span>}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {t(
          "promotion.hint",
          "Laissez vide pour ne pas avoir de promotion. Le prix promotionnel doit être inférieur au prix normal.",
        )}
      </p>
    </div>
  );
}