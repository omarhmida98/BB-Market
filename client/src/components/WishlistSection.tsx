import { Heart, Loader2, Package, ShoppingBag, Trash2, Plus } from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSelection } from "@/hooks/use-selection";
import { useToast } from "@/hooks/use-toast";
import { useRemoveFromWishlist, useWishlist } from "@/hooks/use-wishlist";
import type { WishlistItem } from "@shared/wishlist";
import { formatMoney } from "@/lib/format";

/**
 * The customer's saved products, inside the account page.
 *
 * Everything shown here is *live*: name, image, category, price, promotion and
 * stock all come from the catalogue at the moment of the request, not from the
 * moment the product was favourited. That is the opposite of the order history
 * next to it, and deliberately so — an order must not be rewritten by a later
 * repricing, but a shopping list has to reflect what is actually buyable now.
 *
 * A product that has since been deleted cannot appear at all: `wishlist.product_id`
 * cascades on delete, and the list query inner-joins the catalogue. So there is
 * no "missing product" state to design here — the row is simply gone, and
 * `total` no longer counts it.
 */
export function WishlistSection() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { data, isLoading } = useWishlist();
  const items = data?.items ?? [];

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="rounded-[2.5rem] border border-border bg-card/80 backdrop-blur-md shadow-xl overflow-hidden"
      data-testid="wishlist-section"
    >
      <div className="p-6 border-b border-border flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Heart className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display font-bold text-lg">
              {t("account.wishlist.title", "Mes favoris")}
            </h2>
            {!isLoading && items.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {t("account.wishlist.count", { count: items.length })}
              </p>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-20 px-6 text-center" data-testid="wishlist-empty">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6 text-primary">
            <Heart className="h-10 w-10" />
          </div>
          <h3 className="text-2xl font-display font-bold text-foreground mb-2">
            {t("account.wishlist.empty_title", "Aucun favori")}
          </h3>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto">
            {t(
              "account.wishlist.empty_description",
              "Touchez le cœur sur un produit pour le retrouver ici, même plus tard.",
            )}
          </p>
          <Button
            onClick={() => setLocation("/products")}
            className="rounded-xl font-bold"
            data-testid="wishlist-empty-cta"
          >
            <ShoppingBag className="w-4 h-4 me-2" />
            {t("account.wishlist.browse", "Découvrir nos produits")}
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border" data-testid="wishlist-list">
          {items.map((item, index) => (
            <WishlistRow key={item.productId} item={item} index={index} />
          ))}
        </ul>
      )}
    </motion.section>
  );
}

/**
 * One saved product.
 *
 * "Add to cart" is disabled rather than hidden when the product is out of stock:
 * hiding it would make the row look broken, and the point of saving a sold-out
 * item is to come back to it later. The row says so explicitly instead.
 */
function WishlistRow({ item, index }: { item: WishlistItem; index: number }) {
  const { t, i18n } = useTranslation();
  const { addToSelection, updateQuantity, selection } = useSelection();
  const { toast } = useToast();
  const remove = useRemoveFromWishlist();
  const [, setLocation] = useLocation();
  const [adding, setAdding] = useState(false);

  const { product, promotion, stock, inStock, lowStock } = item;

  const handleAddToCart = () => {
    if (!inStock) return;
    setAdding(true);
    try {
      const already = selection.find((s) => s.id === product.id && s.type === "product");
      if (already) {
        // `addToSelection` is a no-op for a line already in the cart, which is
        // what stops product cards from stacking duplicates. Here the customer
        // explicitly asked for more, so bump the existing line instead — clamped
        // to live stock so the cart cannot exceed what the store can ship.
        updateQuantity(product.id, "product", Math.min(already.quantity + 1, stock));
      } else {
        addToSelection({
          id: product.id,
          name: product.name,
          description: product.description,
          imageUrl: product.imageUrl,
          type: "product",
          // Effective price, so the cart total matches what checkout will charge.
          // The server recomputes it regardless; this is presentation only.
          price: promotion.effectivePrice,
          quantity: 1,
        });
      }
      toast({
        title: t("account.wishlist.added_to_cart", "Ajouté au panier"),
        description: product.name,
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      data-testid="wishlist-row"
    >
      <div className="flex flex-wrap items-center gap-4 p-5 sm:p-6">
        <button
          onClick={() => setLocation(`/products/${product.id}`)}
          className="relative w-20 h-20 rounded-2xl overflow-hidden bg-secondary border border-border shrink-0"
          data-testid="wishlist-row-image"
        >
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        </button>

        <div className="min-w-0 flex-1">
          <span className="inline-block px-2.5 py-0.5 rounded-full bg-secondary text-muted-foreground text-xs font-bold mb-1.5">
            {product.category}
          </span>
          <h3 className="font-bold text-base sm:text-lg truncate" title={product.name}>
            <button
              onClick={() => setLocation(`/products/${product.id}`)}
              className="text-start hover:text-primary transition-colors"
              data-testid="wishlist-row-name"
            >
              {product.name}
            </button>
          </h3>

          {/* Price and stock come from the live catalogue, so a price cut shows
              up here without the customer doing anything. */}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap text-sm">
            <span className="font-black text-primary text-lg">
              {formatMoney(promotion.effectivePrice, i18n.language)}
            </span>
            {promotion.status === "active" && (
              <>
                <span className="text-muted-foreground line-through text-sm">
                  {formatMoney(promotion.regularPrice, i18n.language)}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500 text-white text-[11px] font-bold">
                  {t("promotion.discount", "-{{percent}}%", { percent: promotion.discountPercent })}
                </span>
              </>
            )}
          </div>

          <div className="mt-2">
            {!inStock ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600 dark:text-red-400">
                <Package className="w-3.5 h-3.5" />
                {t("account.wishlist.out_of_stock", "Rupture de stock")}
              </span>
            ) : lowStock ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                <Package className="w-3.5 h-3.5" />
                {t("account.wishlist.low_stock", { count: stock })}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                <Package className="w-3.5 h-3.5" />
                {t("account.wishlist.in_stock", { count: stock })}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            onClick={handleAddToCart}
            disabled={!inStock || adding}
            className="rounded-xl font-bold flex-1 sm:flex-none"
            data-testid="wishlist-add-to-cart"
          >
            {adding ? (
              <Loader2 className="w-4 h-4 me-2 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 me-2" />
            )}
            {inStock
              ? t("account.wishlist.add_to_cart", "Ajouter au panier")
              : t("account.wishlist.unavailable", "Indisponible")}
          </Button>

          <button
            type="button"
            onClick={() =>
              remove.mutate(product.id, {
                onError: () =>
                  toast({
                    variant: "destructive",
                    title: t("account.wishlist.remove_failed", "Impossible de retirer le favori"),
                  }),
              })
            }
            disabled={remove.isPending}
            aria-label={t("account.wishlist.remove", "Retirer des favoris")}
            title={t("account.wishlist.remove", "Retirer des favoris")}
            className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-border text-muted-foreground hover:text-red-500 hover:border-red-300 dark:hover:border-red-900/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
            data-testid="wishlist-remove"
          >
            {remove.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </motion.li>
  );
}