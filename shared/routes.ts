import { z } from "zod";
import { insertMessageSchema, messageSchema, productSchema, productListSchema, productQuerySchema } from "./schema.js";
import { customerOrderSchema } from "./orders.js";
import { wishlistListSchema, wishlistToggleSchema } from "./wishlist.js";
import { analyticsDashboardSchema } from "./analytics.js";

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  products: {
    /**
     * Paginated catalogue. Filtering, searching, sorting, `total` and the page
     * window are all computed by the database; the client only ever renders
     * `items`. Query parameters are described by `productQuerySchema`, which the
     * route parses, so the accepted values are defined in exactly one place.
     *
     * This used to respond with a bare `Product[]`. The type change is deliberate
     * and is what makes a 3,000+ product catalogue workable.
     */
    list: {
      method: "GET" as const,
      path: "/api/products",
      query: productQuerySchema,
      responses: {
        200: productListSchema,
        400: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
    get: {
      method: "GET" as const,
      path: "/api/products/:id",
      responses: {
        200: productSchema,
        404: errorSchemas.validation,
      },
    },
  },
  messages: {
    create: {
      method: "POST" as const,
      path: "/api/messages",
      input: insertMessageSchema,
      responses: {
        201: messageSchema,
        400: errorSchemas.validation,
      },
    },
    list: {
      method: "GET" as const,
      path: "/api/messages",
      responses: {
        200: z.array(messageSchema),
      },
    },
    delete: {
      method: "DELETE" as const,
      path: "/api/messages/:id",
      responses: {
        200: z.object({ message: z.string() }),
        404: errorSchemas.validation,
      },
    },
  },
  /**
   * The customer's own account area. These never expose another customer's
   * order: the owner id is part of the SQL WHERE clause, so a mismatched id is
   * answered with 404 and is indistinguishable from an id that never existed.
   *
   * `items` is the checkout snapshot (paid unit price, original price, promo
   * flag, image). It is never recomputed from the live product table, so history
   * keeps showing what was actually billed.
   */
  myOrders: {
    list: {
      method: "GET" as const,
      path: "/api/my-orders",
      responses: {
        200: z.array(customerOrderSchema),
        401: errorSchemas.internal,
      },
    },
    detail: {
      method: "GET" as const,
      path: "/api/my-orders/:id",
      responses: {
        200: customerOrderSchema,
        400: errorSchemas.validation,
        // Returned for both "no such order" and "not yours": a 403 would confirm
        // the order exists and let a customer enumerate ids.
        401: errorSchemas.internal,
        404: errorSchemas.validation,
      },
    },
  },
  /**
   * The customer's own wishlist.
   *
   * Note what is *not* in these schemas: a user id. There is no such parameter to
   * send, because the owner always comes from the session. Accepting one would
   * make "save this item" a request to write another customer's list.
   *
   * Unlike `myOrders`, each entry carries the *live* product and its currently
   * resolved promotion. A wishlist is a shopping list, so a price cut or a
   * stock-out has to show up on it immediately; a frozen snapshot would only
   * describe what the product looked like on the day it was saved.
   */
  wishlist: {
    list: {
      method: "GET" as const,
      path: "/api/wishlist",
      responses: {
        200: wishlistListSchema,
        401: errorSchemas.internal,
      },
    },
    add: {
      method: "POST" as const,
      path: "/api/wishlist/:productId",
      responses: {
        // 201 when a row was written, 200 when it was already favourited. Both
        // are success; idempotency is what lets the heart be double-clicked.
        200: wishlistToggleSchema,
        201: wishlistToggleSchema,
        400: errorSchemas.validation,
        401: errorSchemas.internal,
        404: errorSchemas.validation,
      },
    },
    remove: {
      method: "DELETE" as const,
      path: "/api/wishlist/:productId",
      responses: {
// Also 200 when the entry was already absent: the requested end state
        // holds either way. Only an id that is not a product at all is a 404.
        200: wishlistToggleSchema,
        400: errorSchemas.validation,
        401: errorSchemas.internal,
        404: errorSchemas.validation,
      },
    },
  },
  /**
   * Admin analytics.
   *
   * One combined endpoint rather than four: the dashboard renders every panel at
   * once, so splitting it would mean four round trips and four chances for the
   * four responses to disagree about which window they describe. It also lets the
   * server resolve the date range once and reuse those bounds for every query.
   *
   * 403 is not `401` for a logged-in non-admin, so the client can tell "log in"
   * apart from "not allowed" and stop retrying.
   */
  adminAnalytics: {
    dashboard: {
      method: "GET" as const,
      path: "/api/admin/analytics",
      responses: {
        200: analyticsDashboardSchema,
        400: errorSchemas.validation,
        401: errorSchemas.internal,
        403: errorSchemas.internal,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
