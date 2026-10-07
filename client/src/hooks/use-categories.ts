import { useQuery } from "@tanstack/react-query";
import type { Category } from "@shared/schema";

/**
 * The shop's categories, straight from the database — the single source of
 * truth shared with Admin → Categories, the product create/edit form and the
 * homepage section picker.
 *
 * It queries `["/api/categories"]`, the exact key the admin category mutations
 * invalidate, so creating, renaming or deleting a category refreshes every
 * consumer (including the public filters) with no extra wiring.
 *
 * `activeCategories` is what a picker offers: the id/name pair of every
 * category the admin has left active, in the server's order. Products, homepage
 * shelves and promos are linked by `category_id`, so the id is the value sent
 * to `/api/products?categoryId=`; the name is only ever a label resolved from
 * this table, which is why renaming a category relabels the shop at once.
 * `activeNames` stays for the few call sites that still compare names.
 */
export function useCategories() {
  const query = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const categories = query.data ?? [];
  const activeCategories = categories
    .filter((category) => category.active)
    .map((category) => ({ id: category.id, name: category.name }));
  return {
    ...query,
    categories,
    activeCategories,
    activeNames: activeCategories.map((category) => category.name),
  };
}
