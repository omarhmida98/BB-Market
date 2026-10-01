import { motion } from "framer-motion";
import { Check, Plus } from "lucide-react";
import { type Product, PRODUCT_LOW_STOCK_THRESHOLD } from "@shared/schema";
import { resolvePromotion } from "@shared/promotions";
import { useSelection } from "@/hooks/use-selection";
import { ImageViewerModal } from "./ImageViewerModal";
import { PromoPrice } from "./PromoPrice";
import { FavoriteButton } from "./FavoriteButton";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface ProductCardProps {
  product: Product & { isAvailable?: boolean }; // Ajout du type optionnel
}

export function ProductCard({ product }: ProductCardProps) {
  const { t } = useTranslation();
  const { isSelected, addToSelection, removeFromSelection } = useSelection();
  const selected = isSelected(product.id, 'product');
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);

  // Real stock, straight from the database. The catalogue page used to overwrite
  // this with `quantity: 1, isAvailable: true`, which made an out-of-stock
  // product impossible to spot and impossible to filter for.
  const stock = Number(product.quantity ?? 0);
  const inStock = stock > 0;
  const lowStock = inStock && stock <= PRODUCT_LOW_STOCK_THRESHOLD;

  const stockLabel = !inStock
    ? t("product_card.out_of_stock")
    : lowStock
      ? t("product_card.low_stock")
      : t("product_card.in_stock");

  const toggleSelection = () => {
    if (selected) {
      removeFromSelection(product.id, 'product');
    } else {
      // Store the effective price so the cart total shown to the customer
      // matches what checkout will charge. The server recomputes it regardless —
      // this is presentation only, never authority.
      addToSelection({
        id: product.id,
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
        price: resolvePromotion(product).effectivePrice,
        type: 'product'
      });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={`group bg-white/70 dark:bg-slate-900/70 backdrop-blur-md rounded-2xl overflow-hidden border ${selected ? 'border-primary shadow-md' : 'border-border shadow-sm'} hover:shadow-xl hover:bg-white/90 dark:hover:bg-slate-900/90 transition-all duration-300 flex flex-col h-full ring-primary/20 ${selected ? 'ring-4' : ''}`}
    >
      <div className="relative h-64 overflow-hidden bg-white/40 dark:bg-slate-950/40 p-4 cursor-pointer" onClick={() => setIsImageViewerOpen(true)}>
        <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/10 transition-colors duration-300 z-10" />
        <img
          src={product.imageUrl}
          alt={product.name}
          className="w-full h-full object-contain transform group-hover:scale-105 transition-transform duration-700 ease-in-out"
        />
        <div className="absolute top-4 start-4 z-20 flex flex-col items-start gap-2">
          <span className="px-3 py-1 text-xs font-semibold bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm text-primary rounded-full shadow-sm">
            {product.category}
          </span>
          <span
            className={`px-3 py-1 text-xs font-semibold rounded-full shadow-sm ${
              !inStock
                ? 'bg-red-500 text-white'
                : lowStock
                  ? 'bg-amber-500 text-white'
                  : 'bg-emerald-500 text-white'
            }`}
          >
            {stockLabel}
          </span>
          {selected && (
            <span className="px-3 py-1 text-xs font-semibold bg-primary text-white rounded-full shadow-sm flex items-center gap-1 animate-in zoom-in-50 duration-300">
              <Check className="w-3 h-3" /> {t("product_card.selected")}
            </span>
          )}
        </div>
        {!inStock && (
          // Dims the picture so a sold-out product reads as unavailable at a
          // glance without hiding the photo the customer may still want to see.
          <div className="absolute inset-0 bg-white/55 dark:bg-slate-950/55 pointer-events-none" />
        )}

        {/* Top-end corner, mirrored with `end-*` so it follows the RTL flip. The
            badge column is `start-*`, so the heart never overlaps it. `z-30` puts
            it above the hover overlay and above the out-of-stock dimmer: a sold-out
            product must stay favouritable, since saving it for later is exactly
            what a customer does when something is temporarily unavailable. */}
        <div className="absolute top-4 end-4 z-30">
          <FavoriteButton product={product} variant="overlay" />
        </div>
      </div>

      <div className="p-6 flex flex-col flex-grow">
        <h3 className="font-display font-bold text-xl mb-2 group-hover:text-primary transition-colors text-slate-900 dark:text-slate-100">
          {product.name}
        </h3>
        <p className="text-muted-foreground text-sm line-clamp-3 mb-4 flex-grow">
          {product.description}
        </p>
        <div className="flex items-end justify-between gap-3 mb-5">
          {/* Single pricing renderer, so the card cannot disagree with the detail
              page or the admin list about what this product costs right now. */}
          <PromoPrice product={product} />
          {inStock && (
            <div className="text-xs text-muted-foreground font-semibold whitespace-nowrap">
              {t("product_card.units_left", { count: stock })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-center mt-auto pt-4 border-t border-border">
          {!inStock ? (
            <div
              className="w-full py-2.5 text-sm font-bold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-center cursor-not-allowed"
              aria-disabled="true"
            >
              {t("product_card.unavailable")}
            </div>
          ) : (
            <button
              onClick={toggleSelection}
              className={`w-full py-2.5 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${selected
                ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 hover:scale-[1.02] active:scale-[0.98]"
                : "bg-primary text-white shadow-md shadow-primary/20 hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98]"
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
          )}
        </div>
      </div>

      <ImageViewerModal
        isOpen={isImageViewerOpen}
        onClose={() => setIsImageViewerOpen(false)}
        imageUrl={product.imageUrl}
        title={product.name}
        description={product.description}
      />
    </motion.div>
  );
}