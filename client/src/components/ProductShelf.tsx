import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { ProductCard } from "@/components/ProductCard";
import type { HomepageShelf } from "@shared/schema";
import {
  normalizeHomepageLocale,
  sectionTileCtaLabel,
  sectionTileSubtitle,
  sectionTileTitle,
  sectionTitle,
} from "@shared/homepage";

/**
 * Where a shelf's "see all" link goes.
 *
 * The link carries the same filter the shelf is built from, so the shelf and the
 * catalogue page it opens can never disagree about what they are showing. That
 * matters most for promotions: a link to a bare catalogue would drop the filter
 * and the customer would land on products with no discount.
 *
 * `price_under` has no equivalent catalogue filter (the page does not read a
 * price ceiling), so it links to the catalogue rather than to a URL that would
 * silently do nothing.
 */
function viewAllHref(shelf: HomepageShelf): string {
  if (shelf.type === "promotions") return "/products?promo=active";
  if (shelf.type === "category" && shelf.category) {
    return `/products?category=${encodeURIComponent(shelf.category)}`;
  }
  return "/products";
}

/**
 * The optional tall tile at the head of a shelf.
 *
 * Every field is optional by design, so this degrades rather than breaking: no
 * image means a B&B gradient instead of a broken-image icon, and no CTA label
 * means no button. The image is lazy like every other shelf image, since a tile
 * is decoration beside the products rather than the reason to load the page.
 */
function ShelfTile({ shelf, locale }: { shelf: HomepageShelf; locale: string }) {
  const href = shelf.tileHref?.trim() || viewAllHref(shelf);
  // Text comes from the reader's language with a French fallback; the shelf
  // heading stands in when the tile has no title/CTA of its own.
  const localizedTitle = sectionTitle(shelf, locale);
  const title = sectionTileTitle(shelf, locale) || localizedTitle;
  const subtitle = sectionTileSubtitle(shelf, locale);
  const cta = sectionTileCtaLabel(shelf, locale) || localizedTitle;

  const body = (
    <>
      {shelf.tileImageUrl ? (
        <img
          src={shelf.tileImageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        // No image configured. A branded gradient stands in so the tile still
        // reads as a deliberate panel rather than an empty box.
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: "linear-gradient(150deg, #063f2e 0%, #0a5a42 55%, #ff6200 190%)" }}
        />
      )}
      {/* Guarantees legible text whether the admin supplied a busy photo or the
          default gradient. */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />

      <div className="relative flex h-full flex-col justify-end gap-2 p-5">
        <h3 className="font-display text-xl font-black leading-tight text-white">{title}</h3>
        {subtitle && <p className="text-sm leading-snug text-white/85">{subtitle}</p>}
        <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-xl bg-[#ff6200] px-3.5 py-2 text-sm font-bold text-white">
          {cta} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
        </span>
      </div>
    </>
  );

  const className =
    "relative flex h-full min-h-64 flex-col overflow-hidden rounded-2xl border border-border shadow-sm transition-shadow duration-300 hover:shadow-xl";

  // A tile href may be absolute (an admin linking to a category elsewhere), so
  // only in-app targets go through wouter's Link; the rest are plain anchors.
  return href.startsWith("/") ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  );
}

/**
 * One admin-configured homepage shelf: a heading, an optional tile, and a
 * horizontal run of product cards.
 *
 * Scrolling is Embla rather than a CSS `overflow-x` scroller, which buys touch
 * dragging on mobile and momentum for free, and gives the header arrows a real
 * "is there more to see" state instead of a guess.
 *
 * Rendering nothing when `products` is empty is deliberate: the server drops
 * empty shelves, so an empty array here means the configuration changed between
 * the request and the render, and a heading with nothing under it would read as a
 * broken page.
 */
export function ProductShelf({ shelf }: { shelf: HomepageShelf }) {
  const { t, i18n } = useTranslation();
  // Embla's direction is fixed at init, so a direction flip has to remount the
  // carousel rather than be patched in. Same treatment as FlashSaleBanner.
  const dir = normalizeHomepageLocale(i18n.language) === "ar" ? "rtl" : "ltr";
  const title = sectionTitle(shelf, i18n.language);
  const products = shelf.products ?? [];

  if (products.length === 0) return null;

  return (
    <section className="py-10" aria-label={title}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* The header lives *inside* the Carousel because the arrows read their
            state from the carousel context - rendered as siblings they would
            throw "useCarousel must be used within a <Carousel />". The wrapper
            is just a provider and a `relative` div, so nothing shifts. */}
        <Carousel key={dir} dir={dir} opts={{ align: "start", containScroll: "trimSnaps" }} className="relative">
          <div className="flex items-end justify-between gap-4 mb-6">
            <div className="min-w-0">
              <p className="text-[#ff6200] font-black uppercase tracking-[.22em] text-xs mb-2">B&amp;B MARKET</p>
              <h2 className="text-2xl sm:text-3xl font-display font-black text-foreground truncate">{title}</h2>
            </div>

            {/* Arrows live in the header row rather than over the cards, so they
                never cover a product image. Hidden on touch-sized screens, where
                the shelf is swiped instead. */}
            <div className="hidden items-center gap-2 shrink-0 sm:flex">
              <CarouselPrevious
                className="static size-10 translate-y-0 -start-0 rounded-full"
                aria-label={t("homepage.shelf_prev", "Produits précédents")}
              />
              <CarouselNext
                className="static size-10 translate-y-0 -end-0 rounded-full"
                aria-label={t("homepage.shelf_next", "Produits suivants")}
              />
            </div>
          </div>

          <CarouselContent className="-ms-4">
            {(shelf.tileImageUrl ||
              sectionTileTitle(shelf, i18n.language) ||
              sectionTileSubtitle(shelf, i18n.language) ||
              sectionTileCtaLabel(shelf, i18n.language)) && (
              <CarouselItem className="basis-auto w-52 sm:w-64 lg:w-72">
                <ShelfTile shelf={shelf} locale={i18n.language} />
              </CarouselItem>
            )}
            {products.map((product) => (
              <CarouselItem key={product.id} className="basis-auto w-56 sm:w-64 lg:w-72">
                <ProductCard product={product} />
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>

        {/* On small screens the header arrows are hidden, so the shelf needs its
            own way out - the full list is always one tap away. */}
        <div className="mt-5 sm:hidden">
          <Link
            href={viewAllHref(shelf)}
            className="text-primary font-bold inline-flex items-center gap-2"
          >
            {t("homepage.shelf_view_all", "Tout voir")} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </section>
  );
}