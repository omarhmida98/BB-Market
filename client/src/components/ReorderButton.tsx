import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Loader2 } from "lucide-react";
import { useSelection } from "@/hooks/use-selection";
import { useToast } from "@/hooks/use-toast";
import type { Product } from "@shared/schema";
import type { CustomerOrder, OrderItemSnapshot } from "@shared/orders";

/**
 * "Reorder" for a past order.
 *
 * Reordering is only offered when it can be done *correctly*, so this component
 * deliberately does not trust the order snapshot:
 *
 *   - a product may since have been deleted, or renamed/repriced;
 *   - its stock may be gone, and the cart's quantity would then be unsatisfiable;
 *   - the snapshot's price is historical, so adding it straight to the cart would
 *     show a price the server will not honour.
 *
 * So it re-reads each product, skips the ones that no longer exist or are out of
 * stock, adds the rest at the *current* price, and reports what was skipped. If
 * nothing is still available the button does nothing and says so, rather than
 * producing a cart the checkout will reject.
 *
 * The customer still confirms and pays at checkout — nothing is ordered here.
 */
export function ReorderButton({ order, className = "" }: { order: CustomerOrder; className?: string }) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { addToSelection, updateQuantity, selection } = useSelection();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const productIds = order.items.map((item) => item.id).filter(Boolean);

  // Fetch only the products this order referenced. A single catalogue request
  // would drag the whole page in; the ids are known, so ask for exactly them.
  const { data, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products", "reorder", productIds],
    enabled: productIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        productIds.map(async (id) => {
          try {
            const res = await fetch(`/api/products/${id}`);
            if (!res.ok) return null;
            return (await res.json()) as Product;
          } catch {
            return null;
          }
        }),
      );
      return results.filter((p): p is Product => !!p);
    },
    staleTime: 15000,
  });

  const handleReorder = () => {
    const current = data ?? [];
    const available: Array<{ item: OrderItemSnapshot; product: Product }> = [];
    let unavailable = 0;

    for (const item of order.items) {
      const product = current.find((p) => p.id === item.id);
      if (!product || Number(product.quantity || 0) <= 0) {
        unavailable++;
        continue;
      }
      available.push({ item, product });
    }

    if (available.length === 0) {
      toast({
        variant: "destructive",
        title: t("account.reorder.unavailable", "Commande non disponible"),
        description: t(
          "account.reorder.none_available",
          "Aucun des articles de cette commande n'est encore disponible.",
        ),
      });
      return;
    }

    // Clamp to live stock: a snapshot may say 5 while only 2 remain.
    //
    // `addToSelection` deliberately does nothing when the line is already in the
    // cart (it is how product cards avoid stacking duplicates), so reordering an
    // item the customer still has would silently add nothing. Those lines go
    // through `updateQuantity` instead, and the total is clamped to live stock so
    // a reorder cannot leave the cart over what the store can actually ship.
    for (const { item, product } of available) {
      const stock = Number(product.quantity) || 0;
      const wanted = Math.min(item.quantity, stock);
      if (wanted <= 0) continue;
      const id = product.id;
      const already = selection.find((s) => s.id === id && s.type === "product");

      if (already) {
        updateQuantity(id, "product", Math.min(already.quantity + wanted, stock));
        continue;
      }

      addToSelection({
        id,
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
        type: "product",
        // Current price, never the historical snapshot price.
        price: Number(product.price) || 0,
        quantity: wanted,
      });
    }

    if (unavailable > 0) {
      toast({
        title: t("account.reorder.partial", "Articles ajoutés"),
        description: t("account.reorder.partial_desc", { count: unavailable }),
      });
    }

    queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    setLocation("/checkout");
  };

  if (isLoading) {
    return (
      <span className={`inline-flex items-center gap-2 text-sm text-muted-foreground ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </span>
    );
  }

  // Nothing from this order can be reordered, so do not offer it at all.
  if (data && !data.some((p) => Number(p.quantity || 0) > 0)) {
    return (
      <span className={`inline-flex items-center gap-2 text-sm text-muted-foreground ${className}`}>
        {t("account.reorder.unavailable", "Commande non disponible")}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleReorder}
      className={`inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 font-bold text-sm hover:bg-secondary transition-colors disabled:opacity-60 ${className}`}
      data-testid="reorder-button"
    >
      <RefreshCw className="h-4 w-4" />
      {t("account.reorder.button", "Commander à nouveau")}
    </button>
  );
}