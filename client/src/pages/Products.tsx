import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ProductCard } from "@/components/ProductCard";
import { useProducts } from "@/hooks/use-products";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { X, ChevronLeft, ChevronRight, Search, SlidersHorizontal, PackageSearch } from "lucide-react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useMemo, useRef } from "react";
import { SiteBackground } from "@/components/SiteBackground";
import { useCategories } from "@/hooks/use-categories";
import { useLocation } from "wouter";
import {
  PRODUCT_DEFAULT_LIMIT,
  type ProductPromoFilter,
  type ProductSort,
  type ProductStockFilter,
} from "@shared/schema";

/**
 * Public catalogue.
 *
 * All filtering, searching, sorting and paging is done by the database through
 * GET /api/products. This component owns only the current query, and mirrors it
 * into the URL so a filtered page can be shared, bookmarked and restored by the
 * back button. It never filters or slices the returned `items` itself.
 */
const PUBLIC_SORTS: ProductSort[] = ["newest", "price_asc", "price_desc"];
const PUBLIC_STOCK: ProductStockFilter[] = ["all", "in", "low", "out"];
const PUBLIC_PROMO: ProductPromoFilter[] = ["all", "active"];

type UrlState = {
  page: number;
  search: string;
  /** Relational filter — the one the app writes and reads. */
  categoryId: number | null;
  /**
   * Legacy `?category=<name>` param, kept only so an old shared link still
   * parses. It is resolved to an id against the categories table and never
   * written back once it has been.
   */
  category: string;
  stock: ProductStockFilter;
  promo: ProductPromoFilter;
  sort: ProductSort;
};

const DEFAULT_STATE: UrlState = {
  page: 1,
  search: "",
  categoryId: null,
  category: "",
  stock: "all",
  promo: "all",
  sort: "newest",
};

function readUrlState(search: string): UrlState {
  const p = new URLSearchParams(search);
  const page = Number(p.get("page"));
  const sort = p.get("sort") as ProductSort | null;
  const stock = p.get("stock") as ProductStockFilter | null;
  const promo = p.get("promo") as ProductPromoFilter | null;
  const rawCategoryId = Number(p.get("categoryId"));
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    search: p.get("search") ?? "",
    // Not validated against the list: categories are dynamic, and a value whose
    // category has since been deleted simply matches no products.
    categoryId: Number.isInteger(rawCategoryId) && rawCategoryId > 0 ? rawCategoryId : null,
    // Legacy bookmark. Resolved once the categories are loaded; an unknown name
    // (deleted category left in an old link) matches no products.
    category: p.get("category") ?? "",
    stock: stock && PUBLIC_STOCK.includes(stock) ? stock : "all",
    // The homepage "see all promotions" link lands on ?promo=active; unknown
    // values fall back to "all" rather than erroring the page.
    promo: promo && PUBLIC_PROMO.includes(promo) ? promo : "all",
    sort: sort && PUBLIC_SORTS.includes(sort) ? sort : "newest",
  };
}

function toQueryString(state: UrlState): string {
  const p = new URLSearchParams();
  if (state.page > 1) p.set("page", String(state.page));
  if (state.search) p.set("search", state.search);
  if (state.categoryId) p.set("categoryId", String(state.categoryId));
  else if (state.category) p.set("category", state.category);
  if (state.stock !== "all") p.set("stock", state.stock);
  if (state.promo !== "all") p.set("promo", state.promo);
  if (state.sort !== "newest") p.set("sort", state.sort);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export default function Products() {
  const { t } = useTranslation();
  const [location, setLocation] = useLocation();
  const [state, setState] = useState<UrlState>(() => readUrlState(window.location.search));
  // Real categories from the database (same source as the admin). Empty until
  // loaded and empty when the shop has none, in which case only the
  // "all categories" option is offered.
  const { categories, activeCategories } = useCategories();

  // The text box is debounced separately from the query so typing does not fire
  // a request per keystroke, while the visible input stays responsive.
  const [searchInput, setSearchInput] = useState(state.search);
  const searchInputRef = useRef(state.search);
  searchInputRef.current = searchInput;

  useEffect(() => {
    const id = setTimeout(() => {
      setState((current) => (current.search === searchInputRef.current ? current : { ...current, search: searchInputRef.current, page: 1 }));
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Back/forward and shared links drive the same state the selectors write to.
  useEffect(() => {
    const next = readUrlState(window.location.search);
    setState(next);
    setSearchInput(next.search);
  }, [location]);

  const update = (patch: Partial<UrlState>) => {
    setState((current) => {
      const next = { ...current, ...patch };
      // Any change other than paging returns to page 1, otherwise you land on
      // page 7 of a result set that has 2 pages and see an empty grid.
      if (!("page" in patch)) next.page = 1;
      setLocation(`/products${toQueryString(next)}`, { replace: true });
      return next;
    });
  };

  // A legacy ?category=<name> link is turned into the id it points at, against
  // the same table the server matches it on. Until the list arrives this is
  // null and the request goes out with the name instead, which the server
  // resolves — so one slow request is the only cost of the old bookmark.
  const resolvedLegacyId = useMemo(() => {
    if (state.categoryId || !state.category) return null;
    const match = categories.find((category) => category.name === state.category);
    return match ? match.id : null;
  }, [state.categoryId, state.category, categories]);

  const activeCategoryId = state.categoryId ?? resolvedLegacyId;

  // Labels come from the whole list, not just the active one: an inactive
  // category still exists and still names its products correctly.
  const categoryName = (id: number | null): string =>
    (id !== null && categories.find((category) => category.id === id)?.name) || "";

  const { data, isLoading, isError, isFetching, refetch } = useProducts({
    page: state.page,
    limit: PRODUCT_DEFAULT_LIMIT,
    search: state.search,
    // One or the other: an id makes the name redundant, and a name that never
    // resolved keeps filtering through the server's categories lookup.
    categoryId: activeCategoryId ?? undefined,
    category: activeCategoryId ? "" : state.category,
    stock: state.stock,
    promo: state.promo,
    sort: state.sort,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;

  // An out-of-range page (a stale bookmark, or a filter that shrank the result
  // set) is corrected instead of showing an empty grid.
  useEffect(() => {
    if (!isLoading && totalPages > 0 && state.page > totalPages) {
      update({ page: totalPages });
    }
  }, [isLoading, totalPages, state.page]);

  const hasFilters = Boolean(
    state.search || activeCategoryId || state.category || state.stock !== "all" || state.promo !== "all" || state.sort !== "newest",
  );

  const clearFilters = () => {
    setSearchInput("");
    setState(DEFAULT_STATE);
    setLocation("/products", { replace: true });
  };

  const from = total === 0 ? 0 : (state.page - 1) * PRODUCT_DEFAULT_LIMIT + 1;
  const to = Math.min(state.page * PRODUCT_DEFAULT_LIMIT, total);

  // A compact window of page numbers with ellipses, so 125 pages does not render
  // 125 buttons.
  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = new Set<number>([1, totalPages, state.page]);
    for (const d of [1, 2]) {
      if (state.page - d > 1) pages.add(state.page - d);
      if (state.page + d < totalPages) pages.add(state.page + d);
    }
    return [...pages].sort((a, b) => a - b);
  }, [totalPages, state.page]);

  const sortLabel: Record<ProductSort, string> = {
    newest: t("products.sort_newest"),
    price_asc: t("products.sort_price_asc"),
    price_desc: t("products.sort_price_desc"),
    name_asc: t("products.sort_newest"),
    stock_asc: t("products.sort_newest"),
    stock_desc: t("products.sort_newest"),
  };

  return (
    <div className="min-h-screen font-sans relative">
      <SiteBackground />
      <Navbar />

      <div className="pt-32 pb-12 bg-white/40 dark:bg-slate-950/40 backdrop-blur-sm border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-3xl mx-auto"
          >
            <h1 className="text-4xl font-display font-bold text-slate-900 dark:text-slate-100 mb-4">{t("products.title")}</h1>
            <p className="text-slate-600 dark:text-slate-300 text-lg">
              {t("products.subtitle")}
            </p>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Filters and search */}
        <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-md p-6 rounded-3xl border border-slate-200/50 dark:border-slate-700/50 shadow-sm mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-end">
            {/* Search */}
            <div className="space-y-2 lg:col-span-2">
              <Label className="text-xs font-bold text-slate-400 uppercase tracking-wider ms-1">{t("products.search")}</Label>
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder={t("products.search_placeholder")}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full ps-10 pe-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-950/40 bg-white/50 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm"
                />
              </div>
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-400 uppercase tracking-wider ms-1">{t("products.category")}</Label>
              <Select
                value={activeCategoryId ? String(activeCategoryId) : "all"}
                onValueChange={(val) =>
                  update({ categoryId: val === "all" ? null : Number(val), category: "" })
                }
              >
                <SelectTrigger className="w-full h-11 rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-950/40 bg-white/50 backdrop-blur-sm text-sm font-medium focus:ring-primary/30 focus:border-primary transition-all hover:bg-white/80 dark:hover:bg-slate-900/80">
                  <SelectValue placeholder={t("products.all_categories")} />
                </SelectTrigger>
                <SelectContent side="bottom" avoidCollisions={false} sideOffset={4} className="rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-slate-200/50 dark:border-slate-700/50 shadow-2xl">
                  <SelectItem value="all" className="rounded-xl focus:bg-primary focus:text-white transition-colors cursor-pointer">{t("products.all_categories")}</SelectItem>
                  {activeCategories.map(cat => (
                    <SelectItem key={cat.id} value={String(cat.id)} className="rounded-xl focus:bg-primary focus:text-white transition-colors cursor-pointer">{cat.name}</SelectItem>
                  ))}
                  {/* The filtered category is not always one the shop still
                      offers (inactive, or a link to a deleted one). It gets its
                      own item so the trigger keeps naming what is being filtered
                      instead of silently falling back to "all categories". */}
                  {activeCategoryId !== null && !activeCategories.some(cat => cat.id === activeCategoryId) && (
                    <SelectItem value={String(activeCategoryId)} className="rounded-xl focus:bg-primary focus:text-white transition-colors cursor-pointer">
                      {categoryName(activeCategoryId) || state.category || t("products.uncategorized")}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Sort */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-400 uppercase tracking-wider ms-1">{t("products.sort")}</Label>
              <Select value={state.sort} onValueChange={(val) => update({ sort: val as ProductSort })}>
                <SelectTrigger className="w-full h-11 rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-950/40 bg-white/50 backdrop-blur-sm text-sm font-medium focus:ring-primary/30 focus:border-primary transition-all hover:bg-white/80 dark:hover:bg-slate-900/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="bottom" avoidCollisions={false} sideOffset={4} className="rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-slate-200/50 dark:border-slate-700/50 shadow-2xl">
                  {PUBLIC_SORTS.map(s => (
                    <SelectItem key={s} value={s} className="rounded-xl focus:bg-primary focus:text-white transition-colors cursor-pointer">{sortLabel[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Stock filter */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-end mt-6">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-400 uppercase tracking-wider ms-1">{t("products.stock_filter")}</Label>
              <div className="flex flex-wrap gap-2">
                {PUBLIC_STOCK.map(s => {
                  const active = state.stock === s;
                  return (
                    <button
                      key={s}
                      onClick={() => update({ stock: s })}
                      aria-pressed={active}
                      className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all ${
                        active
                          ? "bg-primary text-white border-primary shadow-sm"
                          : "bg-white/60 dark:bg-slate-950/40 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-primary/40"
                      }`}
                    >
{s === "all" ? t("products.stock_all") : s === "in" ? t("products.stock_in") : s === "low" ? t("products.stock_low") : t("products.stock_out")}
                  </button>
                  );
                })}
              </div>
            </div>

            {/* Promotion filter. Server-side (`promo=active`), so it composes with
                paging and the other filters instead of hiding rows in the browser. */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-400 uppercase tracking-wider ms-1">{t("promotion.label", "Promotion")}</Label>
              <div className="flex flex-wrap gap-2">
                {PUBLIC_PROMO.map(p => {
                  const active = state.promo === p;
                  return (
                    <button
                      key={p}
                      onClick={() => update({ promo: p })}
                      aria-pressed={active}
                      className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all ${
                        active
                          ? "bg-red-500 text-white border-red-500 shadow-sm"
                          : "bg-white/60 dark:bg-slate-950/40 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-red-400/50"
                      }`}
                    >
                      {p === "all" ? t("promotion.all", "Toutes") : t("promotion.only", "En promotion")}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {hasFilters && (
            <div className="flex items-center gap-2 mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 flex-wrap">
              <span className="text-xs font-bold text-slate-400 uppercase me-2 flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5" /> {t("products.active_filters")}:
              </span>
              <div className="flex flex-wrap gap-2">
                {(activeCategoryId || state.category) && (
                  <button
                    onClick={() => update({ categoryId: null, category: "" })}
                    className="px-3 py-1 bg-primary/5 text-primary text-[10px] font-black rounded-full flex items-center gap-1.5 hover:bg-primary/10 transition-colors"
                  >
                    {activeCategoryId
                      ? categoryName(activeCategoryId) || state.category || t("products.uncategorized")
                      : state.category}{" "}
                    <X className="w-3 h-3" />
                  </button>
                )}
                {state.search && (
                  <button onClick={() => { setSearchInput(""); update({ search: "" }); }} className="px-3 py-1 bg-primary/5 text-primary text-[10px] font-black rounded-full flex items-center gap-1.5 hover:bg-primary/10 transition-colors">
                    "{state.search}" <X className="w-3 h-3" />
                  </button>
                )}
                {state.stock !== "all" && (
                  <button onClick={() => update({ stock: "all" })} className="px-3 py-1 bg-primary/5 text-primary text-[10px] font-black rounded-full flex items-center gap-1.5 hover:bg-primary/10 transition-colors">
                    {state.stock === "in" ? t("products.stock_in") : state.stock === "low" ? t("products.stock_low") : t("products.stock_out")} <X className="w-3 h-3" />
                  </button>
                )}
                {state.promo !== "all" && (
                  <button onClick={() => update({ promo: "all" })} className="px-3 py-1 bg-red-500/10 text-red-500 text-[10px] font-black rounded-full flex items-center gap-1.5 hover:bg-red-500/20 transition-colors">
                    {t("promotion.only", "En promotion")} <X className="w-3 h-3" />
                  </button>
                )}
                {state.sort !== "newest" && (
                  <button onClick={() => update({ sort: "newest" })} className="px-3 py-1 bg-primary/5 text-primary text-[10px] font-black rounded-full flex items-center gap-1.5 hover:bg-primary/10 transition-colors">
                    {sortLabel[state.sort]} <X className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={clearFilters}
                  className="text-[10px] font-black text-slate-400 uppercase hover:text-red-500 transition-colors ms-2"
                >
                  {t("products.clear_all")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Result count. `isFetching` keeps the previous count visible while a new
            page loads, instead of the number blinking to zero. */}
        {!isLoading && !isError && total > 0 && (
          <div className="flex items-center justify-between mb-6 text-sm text-slate-500 dark:text-slate-400">
            <span className={isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
              {t("products.showing_range", { from, to, total })}
            </span>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t("products.page_of", { page: state.page, total: totalPages })}
            </span>
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <p className="text-sm text-slate-500 dark:text-slate-400">{t("products.loading")}</p>
          </div>
        ) : isError ? (
          <div className="text-center py-20 bg-red-50 dark:bg-red-950/30 rounded-2xl border border-red-100 dark:border-red-900/50">
            <p className="text-red-600 dark:text-red-400 font-medium">{t("products.error")}</p>
            <button onClick={() => refetch()} className="mt-4 text-sm underline text-red-700 dark:text-red-400">{t("products.retry")}</button>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 bg-white/60 dark:bg-slate-900/60 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
            <PackageSearch className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
            <p className="text-slate-500 dark:text-slate-400 text-lg">{t("products.no_products")}</p>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-4 text-primary font-medium hover:underline">
                {t("products.clear_filters")}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className={`grid md:grid-cols-2 lg:grid-cols-3 gap-8 transition-opacity ${isFetching ? "opacity-60" : "opacity-100"}`}>
              {items.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {/* Pagination Controls. `start-`/`end-` logical utilities plus an
                RTL-aware chevron keep the arrows pointing the right way when the
                document direction flips. */}
            {totalPages > 1 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-wrap justify-center items-center gap-2 mt-16"
              >
                <button
                  onClick={() => update({ page: Math.max(1, state.page - 1) })}
                  disabled={state.page === 1 || isFetching}
                  className="p-3 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 transition-all focus:outline-none focus:ring-2 focus:ring-primary/20"
                  aria-label={t("products.prev_page")}
                >
                  {/* rotate on RTL rather than swapping icons, so the glyphs and
                      the reading order stay consistent. */}
                  <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
                </button>

                <div className="flex flex-wrap items-center gap-1 px-3 py-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                  {pageNumbers.map((p, i) => {
                    const previous = pageNumbers[i - 1];
                    const gap = previous !== undefined && p - previous > 1;
                    return (
                      <span key={p} className="flex items-center gap-1">
                        {gap && <span className="px-1 text-slate-400 text-sm">…</span>}
                        <button
                          onClick={() => update({ page: p })}
                          aria-current={p === state.page ? "page" : undefined}
                          className={`min-w-[2.25rem] h-9 px-2 rounded-lg text-sm font-bold transition-all ${
                            p === state.page
                              ? "bg-primary text-white shadow-sm"
                              : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                        >
                          {p}
                        </button>
                      </span>
                    );
                  })}
                </div>

                <button
                  onClick={() => update({ page: Math.min(totalPages, state.page + 1) })}
                  disabled={state.page === totalPages || isFetching}
                  className="p-3 rounded-xl bg-primary text-white shadow-md hover:bg-primary/95 hover:-translate-y-0.5 transition-all disabled:opacity-40 disabled:hover:translate-y-0 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  aria-label={t("products.next_page")}
                >
                  <ChevronRight className="w-5 h-5 rtl:rotate-180" />
                </button>
              </motion.div>
            )}
          </>
        )}
      </div>

      <Footer />
    </div>
  );
}
