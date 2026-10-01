import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Minus, Package, Plus, ShoppingCart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolvePromotion } from "@shared/promotions";
import { PRODUCT_LOW_STOCK_THRESHOLD, type Product } from "@shared/schema";
import { useSelection } from "@/hooks/use-selection";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";

/** How long the button reads "Added" after a successful add. */
const ADDED_FEEDBACK_MS = 1600;

/**
 * Add-to-cart block for the product detail page: quantity stepper plus the
 * primary call to action.
 *
 * It drives the *existing* cart store (`useSelection`) rather than introducing a
 * second one. That store keeps one line per (id, type) — `addToSelection` is a
 * no-op for a line that is already present — so every add either creates the
 * single line or updates it, never a duplicate.
 *
 * Pricing shown here comes from the shared `resolvePromotion`, the same resolver
 * the checkout re-prices with, but the value is presentation only: the server
 * recomputes every line from the database when the order is placed and is the
 * sole authority on totals.
 */
export function AddToCart({ product }: { product: Product }) {
  const { t, i18n } = useTranslation();
  const { addToSelection, updateQuantity, selection } = useSelection();
  const { toast } = useToast();

  const stock = Number(product.quantity ?? 0);
  const inStock = stock > 0;

  // Live clock so a promotion that lapses while the page stays open is reflected
  // here too, on the same 30s cadence as PromoPrice above it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const promotion = useMemo(() => resolvePromotion(product, now), [product, now]);

  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const addedTimer = useRef<number | null>(null);

  // The existing line for this product, if any. Read straight from the shared
  // store so the "already in cart" quantity and the navbar badge stay in sync.
  const line = selection.find((i) => i.id === product.id && i.type === "product");
  const inCartQuantity = line?.quantity ?? 0;
  const remaining = Math.max(0, stock - inCartQuantity);

  // Keep the stepper inside [1, stock] whenever the shelf changes underneath it.
  useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), Math.max(1, stock)));
  }, [stock]);

  useEffect(
    () => () => {
      if (addedTimer.current !== null) window.clearTimeout(addedTimer.current);
    },
    [],
  );

  const step = (delta: number) =>
    setQuantity((q) => Math.min(Math.max(1, q + delta), Math.max(1, stock)));

  const handleAdd = () => {
    if (!inStock) return;

    const current = line?.quantity ?? 0;
    // Clamp the *resulting total*, not merely the delta, so repeated adds can
    // never push the line past the shelf.
    const target = Math.min(current + quantity, stock);

    if (target <= current) {
      // The cart already holds every unit there is; this is the only path that
      // refuses an add while the button is enabled.
      toast({ title: t("product_detail.max_stock", "Stock maximum atteint") });
      return;
    }

    if (line) {
      // Already in the cart — bump the existing line instead of pushing a second
      // one. `addToSelection` deliberately no-ops for a present line, which is
      // exactly why the update path is used here (same approach as the wishlist
      // row and the reorder button).
      updateQuantity(product.id, "product", target);
    } else {
      addToSelection({
        id: product.id,
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
        type: "product",
        // Effective price so the cart's running total tracks what checkout will
        // charge. The server recomputes it from scratch regardless.
        price: resolvePromotion(product).effectivePrice,
        quantity: target,
      });
    }

    // The navbar badge is driven by the same store, so it increments with no
    // extra wiring as soon as the store emits.
    toast({
      title: t("product_detail.added_to_cart", "Ajouté au panier"),
      description: product.name,
    });

    setJustAdded(true);
    if (addedTimer.current !== null) window.clearTimeout(addedTimer.current);
    addedTimer.current = window.setTimeout(() => setJustAdded(false), ADDED_FEEDBACK_MS);

    // Back to 1 so the next click is a fresh, deliberate amount.
    setQuantity(1);
  };

  const lowStock = inStock && stock <= PRODUCT_LOW_STOCK_THRESHOLD;
  const maxedOut = inStock && remaining === 0;
  const canAdd = inStock && !maxedOut;

  const stockLabel = !inStock
    ? t("product_detail.out_of_stock", "Rupture de stock")
    : lowStock
      ? t("product_detail.low_stock", "Stock faible")
      : t("product_detail.units_left", { count: stock, defaultValue: "{{count}} en stock" });

  const buttonLabel = !inStock
    ? t("product_detail.out_of_stock", "Rupture de stock")
    : maxedOut
      ? t("product_detail.max_stock", "Stock maximum atteint")
      : justAdded
        ? t("product_detail.added", "Ajouté")
        : t("product_detail.add_to_cart", "Ajouter au panier");

  return (
    <div className="rounded-2xl border border-border bg-secondary/50 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        {/* Effective (promo-aware) unit price, and the shelf state. */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xl font-black text-primary" data-testid="add-to-cart-unit-price">
            {formatMoney(promotion.effectivePrice, i18n.language)}
          </span>
          {promotion.status === "active" && (
            <span className="text-sm text-muted-foreground line-through">
              {formatMoney(promotion.regularPrice, i18n.language)}
            </span>
          )}
        </div>

        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap",
            !inStock
              ? "bg-red-500 text-white"
              : lowStock
                ? "bg-amber-500 text-white"
                : "bg-emerald-500 text-white",
          )}
          data-testid="add-to-cart-stock"
        >
          <Package className="w-3.5 h-3.5" />
          {stockLabel}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {/* Quantity stepper: never below 1, never above the shelf. */}
        <div
          className="inline-flex items-center justify-between rounded-xl border border-border bg-background overflow-hidden sm:w-auto"
          role="group"
          aria-label={t("product_detail.quantity", "Quantité")}
        >
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={!canAdd || quantity <= 1}
            aria-label={t("product_detail.decrease_quantity", "Diminuer la quantité")}
            className="w-11 h-11 inline-flex items-center justify-center text-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            data-testid="add-to-cart-decrease"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span
            className="min-w-10 text-center font-black text-lg tabular-nums"
            aria-live="polite"
            data-testid="add-to-cart-quantity"
          >
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={!canAdd || quantity >= stock}
            aria-label={t("product_detail.increase_quantity", "Augmenter la quantité")}
            className="w-11 h-11 inline-flex items-center justify-center text-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            data-testid="add-to-cart-increase"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-black text-base transition-all",
            canAdd
              ? justAdded
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                : "bg-primary text-white shadow-md shadow-primary/20 hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98]"
              : "bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed",
          )}
          data-testid="add-to-cart-button"
        >
          {justAdded ? <Check className="w-5 h-5" /> : <ShoppingCart className="w-5 h-5" />}
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
