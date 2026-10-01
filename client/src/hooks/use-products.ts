// hooks/use-products.ts
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  PRODUCT_DEFAULT_LIMIT,
  PRODUCT_MAX_LIMIT,
  productQuerySchema,
  type Product,
  type ProductListResponse,
  type ProductPromoFilter,
  type ProductQuery,
  type ProductSort,
  type ProductStockFilter,
} from "@shared/schema";

/**
 * The catalogue endpoint speaks the paginated envelope documented in
 * shared/routes.ts. Filtering, sorting and the page window happen in SQL, so
 * the only thing a caller chooses is which slice it wants.
 *
 * The query key starts with "/api/products" on purpose: every product mutation
 * in the admin panel invalidates that exact key, and React Query invalidates by
 * prefix, so one call refreshes the catalogue, the admin table and the homepage
 * together.
 */
async function fetchProducts(query: ProductQuery): Promise<ProductListResponse> {
  const params = new URLSearchParams();
  if (query.page > 1) params.set("page", String(query.page));
  if (query.limit !== PRODUCT_DEFAULT_LIMIT) params.set("limit", String(query.limit));
  if (query.search) params.set("search", query.search);
  if (query.category) params.set("category", query.category);
  if (query.stock && query.stock !== "all") params.set("stock", query.stock);
  if (query.promo && query.promo !== "all") params.set("promo", query.promo);
  if (query.sort && query.sort !== "newest") params.set("sort", query.sort);

  const qs = params.toString();
  const response = await fetch(qs ? `/api/products?${qs}` : "/api/products");
  if (!response.ok) {
    throw new Error("Failed to fetch products");
  }
  const data = await response.json();

  // quantity/price are numeric columns as of migration 0002, but coerce anyway:
  // a database restored from an old backup can still hand back text, and
  // `.map(p => ...)` on a non-array would otherwise fail far from the cause.
  const items: Product[] = (data?.items ?? []).map((product: any) => ({
    ...product,
    quantity: Number(product.quantity) || 0,
    price: Number(product.price) || 0,
    // Promotion columns are nullable. `Number(null)` is 0, which would read as a
    // free product, so an absent promo price has to stay null rather than become
    // a number. resolvePromotion treats null as "no promotion".
    promoPrice:
      product.promoPrice === null || product.promoPrice === undefined || product.promoPrice === ""
        ? null
        : Number(product.promoPrice),
    promoStart: product.promoStart ?? null,
    promoEnd: product.promoEnd ?? null,
  }));

  return {
    items,
    page: Number(data?.page) || 1,
    limit: Number(data?.limit) || PRODUCT_DEFAULT_LIMIT,
    total: Number(data?.total) || 0,
    totalPages: Number(data?.totalPages) || 0,
  };
}

export type ProductQueryInput = Partial<ProductQuery>;

/** Merge caller overrides over the defaults and clamp them the same way the route does. */
export function buildProductQuery(input: ProductQueryInput = {}): ProductQuery {
  return productQuerySchema.parse({
    page: input.page ?? 1,
    limit: input.limit ?? PRODUCT_DEFAULT_LIMIT,
    search: input.search ?? "",
    category: input.category ?? "",
    stock: input.stock ?? "all",
    promo: input.promo ?? "all",
    sort: input.sort ?? "newest",
  });
}

export function useProducts(input: ProductQueryInput = {}) {
  const query = buildProductQuery(input);
  return useQuery<ProductListResponse>({
    queryKey: ["/api/products", query],
    queryFn: () => fetchProducts(query),
    // Keep the previous page on screen while the next one loads, otherwise every
    // page change flashes an empty grid.
    placeholderData: keepPreviousData,
  });
}

/**
 * The newest products for the homepage. Bounded query, not a `slice()` of the
 * whole catalogue.
 */
export function useFeaturedProducts(limit = 6) {
  return useQuery<ProductListResponse>({
    queryKey: ["/api/products", buildProductQuery({ limit, sort: "newest" })],
    queryFn: () => fetchProducts(buildProductQuery({ limit, sort: "newest" })),
  });
}

/**
 * Products whose promotion is live right now, for the homepage strip.
 *
 * `promo: "active"` is applied by the database, so this stays a bounded query
 * even when most of the catalogue is on offer. The limit is capped in SQL rather
 * than in the component so the homepage never downloads the full promotion list
 * just to show the first eight.
 */
export function usePromotedProducts(limit = 8) {
  const capped = Math.min(limit, PRODUCT_MAX_LIMIT);
  return useQuery<ProductListResponse>({
    queryKey: ["/api/products", buildProductQuery({ limit: capped, promo: "active", sort: "newest" })],
    queryFn: () => fetchProducts(buildProductQuery({ limit: capped, promo: "active", sort: "newest" })),
  });
}

export type { ProductSort, ProductStockFilter, ProductPromoFilter };
export type { ProductListResponse };

async function fetchProduct(id: number): Promise<Product> {
  const response = await fetch(`/api/products/${id}`);
  if (!response.ok) {
    throw new Error("Failed to fetch product");
  }
  const data = await response.json();

  return {
    ...data,
    quantity: Number(data.quantity) || 0,
    price: Number(data.price) || 0,
    promoPrice:
      data.promoPrice === null || data.promoPrice === undefined || data.promoPrice === ""
        ? null
        : Number(data.promoPrice),
    promoStart: data.promoStart ?? null,
    promoEnd: data.promoEnd ?? null,
  };
}

export function useProduct(id: number) {
  return useQuery({
    queryKey: ["/api/products", "detail", id],
    queryFn: () => fetchProduct(id),
    enabled: !!id,
  });
}
