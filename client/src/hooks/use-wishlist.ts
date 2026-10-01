// hooks/use-wishlist.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { toWishlistItem, type WishlistItem, type WishlistListResponse } from "@shared/wishlist";
import type { Product } from "@shared/schema";

const KEY = ["/api/wishlist"];

/**
 * The signed-in customer's wishlist.
 *
 * `enabled: !!user` is load-bearing, not an optimisation: every wishlist route
 * answers 401 without a session, so without this the heart on a public product
 * card would fire a request on behalf of every anonymous visitor and collect a
 * 401 each time. With it, the query only runs for someone who can actually have
 * favourites.
 *
 * There is deliberately no user id in the query key or the request. The session
 * cookie is the only identity the server accepts, and a key that included one
 * would invite the belief that sending it widens access — it does not.
 */
async function fetchWishlist(): Promise<WishlistListResponse> {
  const response = await fetch("/api/wishlist", { credentials: "include" });
  if (response.status === 401) return { items: [], total: 0 };
  if (!response.ok) throw new Error("Failed to fetch wishlist");
  const data = await response.json();
  // Tolerate a bare array as well as the envelope, so a response shape change
  // degrades to "empty list" rather than crashing on `.items`.
  if (Array.isArray(data)) return { items: data as WishlistItem[], total: data.length };
  return { items: data?.items ?? [], total: data?.total ?? 0 };
}

export function useWishlist() {
  const { user } = useAuth();
  return useQuery<WishlistListResponse>({
    queryKey: KEY,
    queryFn: fetchWishlist,
    enabled: !!user,
    staleTime: 30000,
  });
}

/**
 * Optimistic add/remove.
 *
 * The heart flips immediately and rolls back if the server refuses. That matters
 * on a public product grid: waiting for a round trip before showing anything
 * makes the button feel broken, and waiting *silently* would leave a filled heart
 * on a product the server never saved.
 *
 * `add` carries the whole `Product` because an optimistic row has to be renderable
 * the instant it appears. The alternative — inserting an entry with no name and
 * no image — briefly shows the account page a blank card, and borrowing some
 * other product's data would be worse: it would show the wrong name.
 */
export function useToggleWishlist() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { productId: number; favorited: boolean; product?: Product }) => {
      const response = await fetch(`/api/wishlist/${vars.productId}`, {
        method: vars.favorited ? "DELETE" : "POST",
        credentials: "include",
      });
      if (!response.ok) {
        // Surfaced so the caller can explain *why* it did not save instead of
        // silently reverting. 401 is the case that matters: the session expired
        // between page load and click.
        const body = await response.json().catch(() => ({}));
        const error = new Error(body?.message || "Failed to update wishlist") as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      return response.json();
    },

    onMutate: async (vars) => {
      if (!user) return;
      await queryClient.cancelQueries({ queryKey: KEY });
      const previous = queryClient.getQueryData<WishlistListResponse>(KEY);

      queryClient.setQueryData<WishlistListResponse>(KEY, (current) => {
        const items = current?.items ?? [];
        if (vars.favorited) {
          const next = items.filter((item) => item.productId !== vars.productId);
          return { items: next, total: next.length };
        }
        // Already there: leave it alone rather than adding a second entry that
        // the refetch would collapse anyway.
        if (items.some((item) => item.productId === vars.productId)) return current ?? { items, total: items.length };
        if (!vars.product) return current ?? { items, total: items.length };
        // Newest first, matching the server's own ordering, so the list does not
        // visibly reshuffle when the refetch lands. The negative id marks the row
        // as not-yet-persisted; nothing keys off it, it just cannot collide with a
        // real row id.
        const optimistic = toWishlistItem(
          { id: -vars.productId, productId: vars.productId, createdAt: new Date() },
          vars.product,
        );
        const next = [optimistic, ...items];
        return { items: next, total: next.length };
      });

      return { previous };
    },

    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(KEY, context.previous);
    },

    onSettled: () => {
      // Both paths refetch: after a success the list must carry the server's own
      // row ids and timestamps, and after a rollback the server state is the only
      // thing that can be trusted.
      if (user) queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}

/**
 * Remove a favourite, for the account page's explicit "remove" action.
 *
 * Same optimistic treatment as the toggle — the row disappears at once rather
 * than after a round trip, and comes back if the server says no.
 */
export function useRemoveFromWishlist() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (productId: number) => {
      const response = await fetch(`/api/wishlist/${productId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = new Error(body?.message || "Failed to remove from wishlist") as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      return response.json();
    },
    onMutate: async (productId: number) => {
      if (!user) return;
      await queryClient.cancelQueries({ queryKey: KEY });
      const previous = queryClient.getQueryData<WishlistListResponse>(KEY);
      queryClient.setQueryData<WishlistListResponse>(KEY, (current) => {
        const items = current?.items ?? [];
        const next = items.filter((item) => item.productId !== productId);
        return { items: next, total: next.length };
      });
      return { previous };
    },
    onError: (_error, _productId, context) => {
      if (context?.previous) queryClient.setQueryData(KEY, context.previous);
    },
    onSettled: () => {
      if (user) queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}