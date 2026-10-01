/**
 * Shared wishlist vocabulary and response contract.
 *
 * The join row itself is deliberately *not* what goes over the wire. `wishlist`
 * holds only `(user_id, product_id, created_at)`, and a client cannot render a
 * product from an id — the account page needs a name, an image, a price, the
 * live promotion and the current stock. So the serialiser below joins the row to
 * its product on the server and returns one flat, ready-to-render item.
 *
 * The counterpart to this file lives in `server/storage.ts` (`listWishlist`),
 * which produces exactly this shape; keeping both in one module is what stops the
 * list endpoint and the type the client renders from drifting apart.
 */
import { z } from "zod";
import type { Product } from "./schema.js";
import { PRODUCT_LOW_STOCK_THRESHOLD } from "./schema.js";
import { resolvePromotion, type PromotionState } from "./promotions.js";

/** Coerce a stock column to a non-negative whole number. */
function toStock(value: unknown): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * One favourited product as the account page renders it.
 *
 * Note what is *not* here: a snapshot of the price at the moment of favouriting.
 * That would be the wrong design — see `toWishlistItem` below.
 */
export type WishlistItem = {
  /** The `wishlist` row id. Identifies the entry, not the product. */
  id: number;
  productId: number;
  /** ISO timestamp of when the product was favourited. */
  createdAt: string | null;
  /** Live product row: name, image, category, stock, prices. */
  product: Product;
  /**
   * The promotion as it stands *now*, already resolved.
   *
   * Resolving here rather than in the browser is what keeps the wishlist page
   * honest: the server and the catalogue card use the same `resolvePromotion`
   * from shared/promotions.ts, so a product cannot show a discount in one place
   * and a full price in the other.
   */
  promotion: PromotionState;
  /** Current stock. 0 means the product is still listed but not buyable. */
  stock: number;
  /** Stock > 0 but at or below the shared low-stock cutoff. */
  lowStock: boolean;
  /** Convenience flag so the UI does not recompute `stock > 0` in three places. */
  inStock: boolean;
};

/**
 * Build the wire shape for one wishlist row.
 *
 * Deliberately reads the *live* product rather than a stored snapshot. The
 * opposite of order history, and for a good reason: an order must not change when
 * the shop is later repriced, but a wishlist is a shopping list, so a price cut
 * or a stock-out has to be visible on it immediately. Saving 200 items into
 * frozen snapshots would mean re-joining the whole catalogue to find out what is
 * actually orderable today.
 *
 * `product` must already be the product row; there is no lookup here, because the
 * caller has it from the join and re-fetching per row would be N queries.
 */
export function toWishlistItem(row: { id: number; productId: number; createdAt?: Date | string | null }, product: Product): WishlistItem {
  const stock = toStock(product.quantity);
  return {
    id: row.id,
    productId: row.productId,
    createdAt: row.createdAt ? new Date(row.createdAt as any).toISOString() : null,
    product,
    promotion: resolvePromotion(product),
    stock,
    lowStock: stock > 0 && stock <= PRODUCT_LOW_STOCK_THRESHOLD,
    inStock: stock > 0,
  };
}

/** Newest first. See the `idx_wishlist_user_created` index note in the schema. */
export type WishlistListResponse = {
  items: WishlistItem[];
  total: number;
};

/**
 * The response to a toggle.
 *
 * Small on purpose: after flipping a heart the client only needs to know the new
 * state, not re-read the whole list. It echoes `productId` so a UI that fired
 * several toggles without awaiting can still tell which one answered.
 *
 * `created` is present only on the add response (true when a row was written,
 * false when it already existed) and is what lets the caller skip a refetch.
 */
export const wishlistToggleSchema = z.object({
  productId: z.number().int().positive(),
  favorited: z.boolean(),
  created: z.boolean().optional(),
});

export const wishlistItemSchema = z.object({
  id: z.number(),
  productId: z.number(),
  createdAt: z.string().nullable(),
  product: z.object({
    id: z.number(),
    name: z.string(),
    description: z.string(),
    imageUrl: z.string(),
    category: z.string(),
    quantity: z.union([z.string(), z.number()]),
    price: z.union([z.string(), z.number()]),
    promoPrice: z.number().nullable().optional(),
    promoStart: z.string().nullable().optional(),
    promoEnd: z.string().nullable().optional(),
  }),
  promotion: z.object({
    status: z.enum(["none", "scheduled", "active", "expired"]),
    effectivePrice: z.number(),
    regularPrice: z.number(),
    promoPrice: z.number().nullable(),
    discountPercent: z.number(),
    promoStart: z.string().nullable(),
    promoEnd: z.string().nullable(),
  }),
  stock: z.number().int().min(0),
  lowStock: z.boolean(),
  inStock: z.boolean(),
});

export const wishlistListSchema = z.object({
  items: z.array(wishlistItemSchema),
  total: z.number().int().min(0),
});