import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { CalendarClock, Flame, ShoppingBag, Tag } from "lucide-react";
import { resolvePromotion, type PromotionState } from "@shared/promotions";
import type { Product } from "@shared/schema";
import { usePromotedProducts } from "@/hooks/use-products";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  type CarouselApi,
} from "@/components/ui/carousel";

/** How long each slide is held before the carousel advances on its own. */
const AUTOPLAY_MS = 6000;

/**
 * Upper bound on slides. Deliberately narrower than the "Nos promotions" grid
 * below it (which requests 8): the banner is the highlight reel, the grid is the
 * full list. The route applies `promo: "active"` in SQL and the limit is capped
 * in the query, so this is a bounded read rather than a slice of the catalogue.
 */
const MAX_PROMOTED = 4;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type ActivePromo = { product: Product; promo: PromotionState };

/**
 * Fnac-style flash sale hero, driven entirely by whichever product promotions
 * are live right now.
 *
 * Two independent things can take a promotion off the screen, and both are
 * needed:
 *
 *   1. the request asks the API for `promo: "active"`, which the database
 *      resolves against its own clock;
 *   2. the response is re-resolved here against a ticking clock, because the
 *      payload is cached and a promotion that lapses while the tab is open would
 *      otherwise stay on screen until a reload.
 *
 * Both go through `resolvePromotion` from shared/promotions.ts, which is the same
 * function the checkout uses, so the price shown here is the price charged.
 */
export function FlashSaleBanner() {
  const { t, i18n } = useTranslation();
  const { data } = usePromotedProducts(MAX_PROMOTED);

  const items = useMemo(() => data?.items ?? [], [data]);

  // Clock used for the liveness re-check. 30s matches PromoPrice: fine enough
  // that a lapsing offer looks timely, coarse enough to avoid per-second renders.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Only `active` survives. `scheduled` and `expired` never reach the banner,
  // and when everything has lapsed the whole section unmounts.
  const active: ActivePromo[] = useMemo(
    () =>
      items
        .map((product) => ({ product, promo: resolvePromotion(product, now) }))
        .filter((entry) => entry.promo.status === "active"),
    [items, now],
  );

  const dir = i18n.language === "ar" ? "rtl" : "ltr";

  const [api, setApi] = useState<CarouselApi>();
  const [selected, setSelected] = useState(0);
  // Tracked separately so one ending cannot cancel the other: with a single
  // flag, the mouse leaving would resume the rotation under a keyboard user
  // still focused inside.
  const [hovered, setHovered] = useState(false);
  const [focusedInside, setFocusedInside] = useState(false);
  const paused = hovered || focusedInside;
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  // Track the active slide so the dots stay in step with drags and arrows.
  useEffect(() => {
    if (!api) return;
    const sync = () => setSelected(api.selectedScrollSnap());
    sync();
    api.on("select", sync);
    api.on("reInit", sync);
    return () => {
      api.off("select", sync);
      api.off("reInit", sync);
    };
  }, [api]);

  // When a promotion expires the slide count drops. Re-init so embla re-measures
  // the shorter track, and pull the selection back inside the new range.
  useEffect(() => {
    if (!api) return;
    api.reInit();
    const last = api.scrollSnapList().length - 1;
    if (last >= 0 && api.selectedScrollSnap() > last) api.scrollTo(last);
  }, [api, active.length]);

  // Keep the reduced-motion preference live: turning it on stops the rotation,
  // turning it off starts it again, without a reload.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(query.matches);
    setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Autoplay. The countdown is re-armed after every slide change, so a manual
  // move (arrow, dot, drag, keyboard) gets a full AUTOPLAY_MS before the next
  // automatic advance instead of being cut short by the previous timer. It is
  // cleared while the user is hovering or focused inside, while the tab is
  // hidden, for reduced-motion users, and when there is only one slide.
  useEffect(() => {
    if (!api) return;

    let timer: number | null = null;
    const clear = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const arm = () => {
      clear();
      if (active.length < 2 || paused || reducedMotion) return;
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        timer = null;
        api.scrollNext();
      }, AUTOPLAY_MS);
    };

    const onSlideChange = () => arm();
    const onVisibilityChange = () => arm();

    // Only a real slide change restarts the countdown. Embla also re-inits on
    // its own whenever the banner is resized (an image finishing loading, the
    // window changing width); restarting on that would stretch a slide past
    // AUTOPLAY_MS for no reason the visitor can see.
    api.on("select", onSlideChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    arm();

    return () => {
      clear();
      api.off("select", onSlideChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [api, active.length, paused, reducedMotion]);

  if (active.length === 0) return null;

  const many = active.length > 1;

  return (
    <section
      className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8"
      aria-label={t("flash_sale.region_label", "Ventes flash en cours")}
    >
      <div
        // Pausing on hover and on focus keeps the offer the user is reading from
        // sliding away underneath them.
        //
        // Mouse only: a touch also fires an "enter" but never a matching
        // "leave", which would leave a phone paused for good after one tap.
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setHovered(false);
        }}
        // Keyboard focus only (`:focus-visible`). A click or tap on an arrow or
        // a dot also focuses it, and that focus stays there after the pointer
        // has gone - counting it would stop the rotation until the visitor
        // happened to click somewhere else.
        onFocusCapture={(event) => setFocusedInside((event.target as HTMLElement).matches(":focus-visible"))}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedInside(false);
        }}
      >
        <Carousel
          // Remount on a direction flip so embla re-initialises with the correct
          // starting edge instead of keeping LTR scroll maths under RTL content.
          key={dir}
          dir={dir}
          setApi={setApi}
          opts={{ loop: many, align: "start", duration: 30 }}
        >
          <CarouselContent>
            {active.map(({ product, promo }, index) => {
              const isFirst = index === 0;
              return (
                <CarouselItem key={product.id} aria-label={product.name}>
                  <div
                    // `h-full` so every slide matches the tallest one; otherwise a
                    // short slide leaves a blank band above the dots.
                    className="relative h-full overflow-hidden rounded-[2rem] text-white shadow-2xl"
                    style={{
                      background:
                        "linear-gradient(115deg, #04382a 0%, #063f2e 45%, #0a5a42 100%)",
                    }}
                  >
                    {/* Decorative glows. Logical insets so they mirror in RTL. */}
                    <div className="pointer-events-none absolute -top-24 end-[-6rem] h-80 w-80 rounded-full bg-[#ff6200]/25 blur-3xl" />
                    <div className="pointer-events-none absolute -bottom-24 start-[-4rem] h-72 w-72 rounded-full bg-white/10 blur-3xl" />

                    <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-2 lg:items-center lg:gap-12 lg:p-14">
                      {/* Image stage. `order` is left alone so mobile stacks the
                          picture above the copy, which is the retail convention. */}
                      <div className="relative flex items-center justify-center rounded-[1.5rem] bg-white p-6 shadow-xl">
                        <span className="absolute top-4 start-4 inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-sm font-black text-white shadow-lg">
                          <Tag className="h-3.5 w-3.5" />
                          {t("promotion.discount", "-{{percent}}%", {
                            percent: promo.discountPercent,
                          })}
                        </span>
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          // The first slide is the likely LCP element, so it is
                          // fetched eagerly; the rest wait until they are near.
                          loading={isFirst ? "eager" : "lazy"}
                          {...{ fetchpriority: isFirst ? "high" : "auto" }}
                          decoding="async"
                          className="h-52 w-full object-contain sm:h-72 lg:h-80"
                        />
                      </div>

                      <div className="relative min-w-0">
                        <span className="inline-flex items-center gap-2 rounded-full bg-[#ff6200] px-4 py-1.5 text-xs font-black uppercase tracking-[.18em] text-white shadow-lg">
                          <Flame className="h-4 w-4" />
                          {t("flash_sale.badge", "Vente Flash")}
                        </span>

                        {/* Explicit white: the global heading rule is slate-900,
                            which is unreadable on the green banner. */}
                        <h2 className="mt-4 break-words font-display text-3xl font-black leading-tight text-white sm:text-4xl lg:text-5xl">
                          {product.name}
                        </h2>

                        <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-1">
                          <span className="font-display text-4xl font-black leading-none sm:text-5xl">
                            {formatMoney(promo.effectivePrice, i18n.language)}
                          </span>
                          <span className="text-lg font-semibold text-white/60 line-through">
                            {formatMoney(promo.regularPrice, i18n.language)}
                          </span>
                        </div>

                        {promo.promoEnd && (
                          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-white/80">
                            <CalendarClock className="h-4 w-4" />
                            {t("promotion.ends_at", "Offre valide jusqu'au {{date}}", {
                              date: formatDate(promo.promoEnd, i18n.language),
                            })}
                          </p>
                        )}

                        <Link
                          href={`/products/${product.id}`}
                          className="mt-7 flex w-fit items-center gap-2 rounded-2xl bg-[#ff6200] px-7 py-3.5 text-base font-black text-white shadow-lg shadow-black/20 transition-transform hover:-translate-y-0.5 hover:bg-[#ff7a26] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#063f2e]"
                        >
                          <ShoppingBag className="h-5 w-5" />
                          {t("flash_sale.cta", "J'en profite")}
                        </Link>
                      </div>
                    </div>
                  </div>
                </CarouselItem>
              );
            })}
          </CarouselContent>

          {many && (
            <>
              {/* Override the primitive's outside placement so the arrows sit on
                  the banner itself. `start`/`end` swap sides with the direction.
                  Hidden on phones, where they would cover the stacked title and
                  price; the banner is swiped there and the dots remain. */}
              <CarouselPrevious
                aria-label={t("flash_sale.previous", "Offre précédente")}
                className="hidden sm:inline-flex start-3 h-11 w-11 border-0 bg-white/90 text-[#063f2e] shadow-xl backdrop-blur hover:bg-white hover:text-[#063f2e] focus-visible:ring-2 focus-visible:ring-[#ff6200]"
              />
              <CarouselNext
                aria-label={t("flash_sale.next", "Offre suivante")}
                className="hidden sm:inline-flex end-3 h-11 w-11 border-0 bg-white/90 text-[#063f2e] shadow-xl backdrop-blur hover:bg-white hover:text-[#063f2e] focus-visible:ring-2 focus-visible:ring-[#ff6200]"
              />
            </>
          )}
        </Carousel>

        {many && (
          <div className="mt-5 flex items-center justify-center gap-2">
            {active.map(({ product }, index) => (
              <button
                key={product.id}
                type="button"
                aria-label={t("flash_sale.slide_label", "Offre {{index}} sur {{total}}", {
                  index: index + 1,
                  total: active.length,
                })}
                aria-current={index === selected ? "true" : undefined}
                onClick={() => api?.scrollTo(index)}
                className={cn(
                  "h-2.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6200] focus-visible:ring-offset-2",
                  index === selected
                    ? "w-8 bg-[#ff6200]"
                    : "w-2.5 bg-foreground/25 hover:bg-foreground/40",
                )}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
