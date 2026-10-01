// hooks/use-homepage-sections.ts
import { useQuery } from "@tanstack/react-query";
import type { HomepageShelf, Product } from "@shared/schema";

/**
 * Coerce a shelf's products the same way `use-products.ts` does.
 *
 * `quantity` and `price` are numeric columns as of migration 0002, but a database
 * restored from an old backup can still hand back text. ProductCard renders
 * `ProductCard.out_of_stock` off `Number(quantity) > 0` and `PromoPrice` off
 * `Number(price)`, and `resolvePromotion` compares `promoPrice < price` - so a
 * single un-coerced field makes the stock badge, the price and the promotion
 * badge disagree on the same card.
 */
function normaliseProduct(product: any): Product {
  return {
    ...product,
    quantity: Number(product.quantity) || 0,
    price: Number(product.price) || 0,
    // A null promo price means "no promotion". `Number(null)` is 0, which would
    // read as a free product, so an absent promo has to stay null.
    promoPrice:
      product.promoPrice === null || product.promoPrice === undefined || product.promoPrice === ""
        ? null
        : Number(product.promoPrice),
    promoStart: product.promoStart ?? null,
    promoEnd: product.promoEnd ?? null,
  };
}

/**
 * Every homepage shelf with its products, in the admin's display order.
 *
 * One request for the whole homepage rather than one per shelf: the server
 * de-duplicates across shelves in the same pass, and a client that excluded
 * already-shown ids shelf by shelf would refetch each shelf as soon as the one
 * above it resolved.
 *
 * The query key is the endpoint path on purpose - every homepage-section mutation
 * in the admin panel invalidates `["/api/homepage-sections"]`, and React Query
 * matches by prefix, so saving an edit refreshes the homepage with no wiring.
 */
async function fetchHomepageShelves(): Promise<HomepageShelf[]> {
  const response = await fetch("/api/homepage-sections");
  if (!response.ok) throw new Error("Failed to fetch homepage sections");
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map((shelf: any) => ({
    ...shelf,
    products: Array.isArray(shelf?.products) ? shelf.products.map(normaliseProduct) : [],
  }));
}

export function useHomepageShelves() {
  return useQuery<HomepageShelf[]>({
    queryKey: ["/api/homepage-sections"],
    queryFn: fetchHomepageShelves,
  });
}

export type { HomepageShelf };