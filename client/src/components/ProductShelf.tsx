import { useState } from "react";
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
  // Remembered per URL rather than as a flag, so a replaced image gets its own
  // chance to load instead of inheriting the old one's failure.
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  // Text comes from the reader's language with a French fallback; the shelf
  // heading stands in when the tile has no title/CTA of its own.
  const localizedTitle = sectionTitle(shelf, locale);
  const title = sectionTileTitle(shelf, locale) || localizedTitle;
  const subtitle = sectionTileSubtitle(shelf, locale);
  const cta = sectionTileCtaLabel(shelf, locale) || localizedTitle;

  const body = (
    <>
      {shelf.tileImageUrl && failedImageUrl !== shelf.tileImageUrl ? (
        <img
          src={shelf.tileImageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedImageUrl(shelf.tileImageUrl)}
        />
      ) : (
        // No image configured, or it failed to load. A branded gradient stands
        // in so the tile still reads as a deliberate panel rather than an empty
        // box or a broken-image icon.
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
        <h3 className="font-display text-xl font-black leading-tight text-white line-clamp-5 break-words">{title}</h3>
        {subtitle && <p className="text-sm leading-snug text-white/85 line-clamp-4 break-words">{subtitle}</p>}
        <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-xl bg-[#ff6200] px-3.5 py-2 text-sm font-bold text-white">
          {cta} <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" />
        </span>
      </div>
    </>
  );

  const className =
    "relative flex h-full min-h-56 flex-col overflow-hidden rounded-2xl border border-border shadow-sm transition-shadow duration-300 hover:shadow-xl";

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
  const hasTile = Boolean(
    shelf.tileImageUrl ||
      sectionTileTitle(shelf, i18n.language) ||
      sectionTileSubtitle(shelf, i18n.language) ||
      sectionTileCtaLabel(shelf, i18n.language),
  );

  if (products.length === 0) return null;

  return (
    <section className="py-5 sm:py-7" aria-label={title}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Each shelf is its own framed panel. That is what sets a homepage
            section apart from the open product grid of the catalogue page, and
            what keeps two shelves in a row from reading as one long list. */}
        <div className="rounded-[2rem] border border-border bg-card/75 backdrop-blur-md shadow-sm p-4 sm:p-7 lg:p-8">
          {/* The header lives *inside* the Carousel because the arrows read their
              state from the carousel context - rendered as siblings they would
              throw "useCarousel must be used within a <Carousel />". The wrapper
              is just a provider and a `relative` div, so nothing shifts. */}
          <Carousel key={dir} dir={dir} opts={{ align: "start", containScroll: "trimSnaps" }} className="relative">
            <div className="flex items-center justify-between gap-4 mb-5 sm:mb-6">
              <div className="flex min-w-0 items-stretch gap-3">
                <span aria-hidden className="w-1.5 shrink-0 rounded-full bg-[#ff6200]" />
                <h2 className="text-xl sm:text-2xl font-display font-black text-foreground line-clamp-2 break-words sm:line-clamp-1" title={title}>{title}</h2>
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
              {hasTile && (
                <CarouselItem className="basis-auto w-48 sm:w-56 lg:w-64">
                  <ShelfTile shelf={shelf} locale={i18n.language} />
                </CarouselItem>
              )}
              {products.map((product) => (
                <CarouselItem key={product.id} className="basis-auto w-48 sm:w-52 lg:w-56">
                  <ProductCard product={product} variant="shelf" />
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>

          {/* On small screens the header arrows are hidden, so the shelf needs its
              own way out - the full list is always one tap away. On desktop the
              tile's button is that way out, so the link only shows there when the
              shelf has no tile. */}
          <div className={hasTile ? "mt-5 sm:hidden" : "mt-5"}>
            <Link
              href={viewAllHref(shelf)}
              className="text-primary font-bold inline-flex items-center gap-2"
            >
              {t("homepage.shelf_view_all", "Tout voir")} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}