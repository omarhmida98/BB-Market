import { Heart } from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToggleWishlist, useWishlist } from "@/hooks/use-wishlist";
import type { Product } from "@shared/schema";

/**
 * The wishlist heart.
 *
 * One component for the product card, the detail page and the promoted strip,
 * because the three must agree on what "favourited" means and what happens when
 * an anonymous visitor clicks. Inline implementations are how a card ends up
 * toggling locally while the detail page calls the API, so the two disagree
 * about the same product.
 *
 * The filled/outlined distinction is the whole affordance, so it is carried by
 * `fill` on the icon and by `aria-pressed`, not by colour alone — a customer who
 * cannot distinguish red from grey, or who is on a screen reader, still gets the
 * state.
 */
export function FavoriteButton({
  product,
  className = "",
  size = "default",
  variant = "overlay",
}: {
  product: Pick<Product, "id"> & Partial<Product>;
  className?: string;
  size?: "sm" | "default" | "lg";
  /**
   * `overlay` floats over a product image (card, hero). `inline` sits in a row of
   * buttons (detail page, account row) and carries its own border.
   */
  variant?: "overlay" | "inline";
}) {
  const { t } = useTranslation();
  const { user, isLoading: loadingUser } = useAuth();
  // The current path as well as the setter: the post-login redirect has to send
  // the customer back to the page they were actually on. Hardcoding `/products`
  // would dump someone who clicked a heart on the home page onto the catalogue.
  const [location, setLocation] = useLocation();
  const { data } = useWishlist();
  const toggle = useToggleWishlist();
  const [justFailed, setJustFailed] = useState(false);

  const productId = Number(product.id);
  const favorited = !!data?.items?.some((item) => item.productId === productId);
  const busy = toggle.isPending;

  const iconSize = size === "lg" ? "w-6 h-6" : size === "sm" ? "w-4 h-4" : "w-5 h-5";
  const buttonSize =
    size === "lg" ? "w-14 h-14" : size === "sm" ? "w-8 h-8" : "w-10 h-10";

  const handleClick = (event: React.MouseEvent) => {
    // The heart frequently sits inside a link or an image-click handler on the
    // card; without this the favourite action also navigates or opens the viewer.
    event.preventDefault();
    event.stopPropagation();

    // Anonymous visitors are sent to sign in rather than shown a failure: there is
    // no way to store a favourite without an account. The redirect carries the
    // current path so they land back where they clicked — encoded, because the
    // query string it becomes is parsed back out of `location.search`.
    // `loadingUser` matters — during that window `user` is briefly null, and
    // redirecting then would bounce a signed-in customer to the login page.
    if (!loadingUser && !user) {
      setLocation(`/login?redirect=${encodeURIComponent(location)}`);
      return;
    }

    setJustFailed(false);
    toggle.mutate(
      { productId, favorited, product: product as Product },
      { onError: () => setJustFailed(true) },
    );
  };

  const baseClasses = [
    "inline-flex items-center justify-center rounded-full transition-all duration-200",
    "transition-transform hover:scale-110 active:scale-95",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
    "disabled:opacity-60 disabled:cursor-not-allowed",
    buttonSize,
    className,
  ].join(" ");

  const stateClasses = favorited
    ? "bg-white/95 dark:bg-slate-900/95 text-red-500 border border-red-200 dark:border-red-900/60"
    : "bg-white/85 dark:bg-slate-900/85 text-slate-400 dark:text-slate-500 border border-transparent hover:text-red-500";

  const inlineClasses = favorited
    ? "bg-red-50 dark:bg-red-950/40 text-red-500 border border-red-200 dark:border-red-900/60"
    : "bg-white dark:bg-slate-900 text-slate-500 border border-border hover:text-red-500 hover:border-red-300 dark:hover:border-red-900/60";

  const label = favorited
    ? t("wishlist.remove_favorite", "Retirer des favoris")
    : t("wishlist.add_favorite", "Ajouter aux favoris");

  return (
    <button
      type="button"
      onClick={handleClick}
      // `aria-pressed` is the accessible form of the filled/outlined distinction,
      // so the state is available without relying on the icon or its colour.
      aria-pressed={favorited}
      aria-label={label}
      title={justFailed ? t("wishlist.save_failed", "Impossible d'enregistrer. Réessayez.") : label}
      disabled={busy}
      data-testid="favorite-button"
      // The product id is exposed because a product grid renders many of these
      // and a test (or a smoke script) has to be able to address one specific
      // heart rather than "the first one on the page".
      data-product-id={productId}
      data-favorited={favorited ? "true" : "false"}
      className={`${baseClasses} ${variant === "overlay" ? stateClasses : inlineClasses}`}
    >
      {busy ? (
        // Deliberately no spinner here. The list update is optimistic, so the
        // heart has already flipped by the time this renders; replacing the icon
        // with a spinner would retract that instant feedback and leave the button
        // reading "in progress" for the length of a request the customer cannot
        // influence. The heart stays visible in its new state and the button is
        // simply disabled until the server answers.
        <Heart
          className={`${iconSize} ${favorited ? "animate-[heart-pop_300ms_ease-out]" : ""}`}
          fill={favorited ? "currentColor" : "none"}
          strokeWidth={2}
          aria-hidden="true"
        />
      ) : (
        <Heart
          className={iconSize}
          // Solid when favourited, outline when not. This is the primary signal,
          // so it is an explicit fill rather than a className on the container.
          fill={favorited ? "currentColor" : "none"}
          strokeWidth={2}
          aria-hidden="true"
        />
      )}
    </button>
  );
}