import express, { type Express, type RequestHandler } from "express";
import path from "path";
import { fileURLToPath } from "url";
import type { Server } from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { storage } from "./storage.js";
import { api } from "shared/routes.js";
import { z } from "zod";
import { insertCategorySchema, insertOrderSchema, upsertSocialMediaEmbedSchema, insertSettingsSchema, computeDeliveryFee, SOCIAL_PLATFORMS, productQuerySchema, checkPromotion, homepageSectionInputSchema, homepageSectionPatchSchema, HOMEPAGE_TILE_IMAGE_MAX_BYTES, HOMEPAGE_TILE_IMAGE_MIME_TYPES, HOMEPAGE_TILE_IMAGE_EXTENSIONS, type SocialPlatform } from "shared/schema.js";
import { resolvePromotion } from "shared/promotions.js";
import { dbg } from "./debug.js";
import { toCustomerOrder, toCustomerOrderSummary } from "shared/orders.js";
import { analyticsQuerySchema } from "shared/analytics.js";
import { getAnalyticsDashboard } from "./analytics.js";
import multer from "multer";
import fs from "fs";
import { setupAuth, hashPassword, comparePasswords } from "./auth.js";
import crypto from "crypto";
import { sendResetCodeEmail, sendPasswordResetLinkEmail, sendWelcomeEmail, sendRejectionEmail, sendStockAlertEmail } from "./email.js";
import { uploadImage } from "./cloudinary_util.js";
import { performBackup } from "./backup.js";
import { resolveDbTarget } from "./db-target.js";
import { resolveAssetsDir, resolveUploadsDir } from "./paths.js";

/**
 * Write an uploaded file to the local uploads directory and return its public
 * URL (`/uploads/<file>`).
 *
 * This is the only place an upload is written to disk. The directory comes from
 * `resolveUploadsDir()` - UPLOADS_DIR when set, otherwise
 * `<project root>/public/uploads` - which is the same directory the `/uploads`
 * static route serves. Writing anywhere else breaks one of two things: the file
 * is saved where nothing serves it, or it is saved under `dist/`, where the
 * compiled server lives, and the next `npm run build` deletes it.
 *
 * Nothing from the request reaches the path: a fixed prefix, the clock, random
 * bytes and an extension the caller has already reduced to a short
 * alphanumeric token.
 */
function saveUploadLocally(buffer: Buffer, prefix: string, extension: string): string {
  const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}.${extension}`;
  const uploadsDir = resolveUploadsDir();
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);
  return `/uploads/${filename}`;
}

/**
 * The extension to store an upload under, taken from the name it arrived with.
 *
 * The original filename is the sender's to choose, so only a short alphanumeric
 * extension is accepted from it; anything else falls back to `jpg`, as a
 * missing extension always has.
 */
function uploadExtension(originalName: string): string {
  const extension = path.extname(originalName).slice(1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(extension) ? extension : "jpg";
}

/**
 * Identify a JPEG, PNG or WebP from its leading bytes.
 *
 * Returns the extension to store the file under, or `null` when the content is
 * none of the three - whatever name or MIME type it arrived with.
 */
function detectTileImageExtension(buffer: Buffer): "jpg" | "png" | "webp" | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/**
 * Route every rejected promise into Express's error middleware.
 *
 * Express 4 does not do this on its own: it catches synchronous throws from a
 * handler, but an `async` handler that rejects produces an unhandled rejection,
 * which Node treats as fatal and terminates the process. The error middleware in
 * `index.ts` never sees it.
 *
 * That makes any `await storage.someQuery(...)` that can reject a remote way to kill
 * the API. The shortest path is a malformed path id: `Number(req.params.id)` on
 * `"abc"` is `NaN`, and binding `NaN` into an integer column is `22P02 invalid input
 * syntax for type integer: "NaN"` on PostgreSQL. On SQLite the same query returns no
 * rows, so the crash only ever appears on the production dialect.
 *
 * Wrapping the verb methods once here covers every handler in this file, including
 * ones added later, without editing each route. `use` is deliberately left alone:
 * four-argument middleware there is the error handler itself.
 */
function forwardAsyncErrors(target: Express): void {
  const verbs = ["get", "post", "put", "patch", "delete"] as const;
  for (const verb of verbs) {
    const original = target[verb].bind(target);
    target[verb] = ((routePath: string, ...rest: RequestHandler[]) => {
      const handlers = rest.map((handler) =>
        typeof handler === "function"
          ? (req: express.Request, res: express.Response, next: express.NextFunction) => {
              try {
                const out = (handler as Function)(req, res, next);
                if (out && typeof (out as Promise<unknown>).catch === "function") {
                  (out as Promise<unknown>).catch(next);
                }
              } catch (err) {
                next(err);
              }
            }
          : handler,
      );
      return original(routePath, ...handlers);
    }) as Express[typeof verb];
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  setupAuth(app);
  forwardAsyncErrors(app);


  // B&B Market categories
  app.get("/api/categories", async (_req, res) => {
    try {
      res.json(await storage.getCategories());
    } catch (error) {
      console.error("[CATEGORIES] get failed:", error);
      res.status(500).json({ message: "Unable to load categories" });
    }
  });

  app.post("/api/categories", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    try {
      const parsed = insertCategorySchema.parse(req.body);
      const slug = (parsed.slug || parsed.name)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const category = await storage.createCategory({ ...parsed, slug });
      await storage.createUserActivity(currentUser.id, "category_create", `Catégorie créée: ${category.name}`);
      res.status(201).json(category);
    } catch (error: any) {
      console.error("[CATEGORIES] create failed:", error);
      res.status(400).json({ message: error?.message || "Unable to create category" });
    }
  });

  app.patch("/api/categories/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid category ID" });
    try {
      const parsed = insertCategorySchema.partial().parse(req.body);
      const update: any = { ...parsed };
      if (parsed.name && !parsed.slug) {
        update.slug = parsed.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      }
      const category = await storage.updateCategory(id, update);
      if (!category) return res.sendStatus(404);
      res.json(category);
    } catch (error: any) {
      res.status(400).json({ message: error?.message || "Unable to update category" });
    }
  });

app.delete("/api/categories/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid category ID" });
    const success = await storage.deleteCategory(id);
    return success ? res.sendStatus(204) : res.status(404);
  });

  // Homepage sections
  //
  // Two audiences, one configuration. The public read serves the homepage and
  // returns each shelf with its products already resolved; the admin CRUD serves
  // the panel with configuration only. The split matters for one specific reason:
  // a disabled shelf must disappear from the public homepage but stay visible in
  // the admin list, or "disabled" would be indistinguishable from "deleted".
  //
  // The public read is capped per shelf by the shelf's own `max_products`, which
  // storage clamps again, and empty shelves are dropped server-side, so this
  // endpoint cannot be widened by anything a caller sends.
  app.get("/api/homepage-sections", async (_req, res) => {
    try {
      res.json(await storage.queryHomepageShelves());
    } catch (error) {
      console.error("[HOMEPAGE] shelves failed:", error);
      res.status(500).json({ message: "Unable to load homepage sections" });
    }
  });

  app.get("/api/admin/homepage-sections", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    try {
      // Each row also says how many products the homepage shows for it, so the
      // admin can tell a hidden shelf from a working one. Hiding empty shelves
      // is deliberate, but silently hiding them left "saved" and "visible"
      // indistinguishable in the admin.
      //
      //   visibleProductCount  - what the public homepage renders right now, from
      //                          the same pass the public endpoint uses.
      //   matchingProductCount - what the shelf would hold on its own. Only
      //                          differs when a shelf above already took its
      //                          products, which is the other reason to be empty.
      const sections = await storage.getHomepageSections(true);
      const shelves = await storage.queryHomepageShelves();
      const visible = new Map(shelves.map((shelf) => [shelf.id, shelf.products.length]));
      const rows = [];
      for (const section of sections) {
        const visibleProductCount = section.enabled ? visible.get(section.id) ?? 0 : 0;
        const matchingProductCount =
          visibleProductCount > 0 ? visibleProductCount : (await storage.queryHomepageSectionProducts(section)).length;
        rows.push({ ...section, visibleProductCount, matchingProductCount });
      }
      res.json(rows);
    } catch (error) {
      console.error("[HOMEPAGE] admin list failed:", error);
      res.status(500).json({ message: "Unable to load homepage sections" });
    }
  });

  app.post("/api/homepage-sections", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    try {
      const parsed = homepageSectionInputSchema.parse(req.body);
      const section = await storage.createHomepageSection(parsed);
      await storage.createUserActivity(currentUser.id, "homepage_section_create", section.titleFr);
      res.status(201).json(section);
    } catch (error: any) {
      res.status(400).json({ message: error?.issues?.[0]?.message || error?.message || "Unable to create section" });
    }
  });

  /**
   * The patch is validated against the *merged* row, not on its own.
   *
   * A partial schema cannot know whether a section is still valid: switching the
   * type to `category` without naming a category passes any "all fields optional"
   * check and produces a shelf that silently renders nothing. Merging first and
   * running the full `homepageSectionInputSchema` over the result means that case
   * is rejected, while an unrelated edit to a `category` shelf that still carries
   * a category name is accepted.
   */
  app.patch("/api/homepage-sections/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid section ID" });
    try {
      const patch = homepageSectionPatchSchema.parse(req.body);
      const existing = await storage.getHomepageSection(id);
      if (!existing) return res.sendStatus(404);
      homepageSectionInputSchema.parse({ ...existing, ...patch });
      const section = await storage.updateHomepageSection(id, patch);
      if (!section) return res.sendStatus(404);
      await storage.createUserActivity(currentUser.id, "homepage_section_update", section.titleFr);
      res.json(section);
    } catch (error: any) {
      res.status(400).json({ message: error?.issues?.[0]?.message || error?.message || "Unable to update section" });
    }
  });

  app.delete("/api/homepage-sections/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid section ID" });
    const success = await storage.deleteHomepageSection(id);
    if (success) {
      await storage.createUserActivity(currentUser.id, "homepage_section_delete", `#${id}`);
    }
    return success ? res.sendStatus(204) : res.status(404);
  });

  app.post("/api/homepage-sections/reorder", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    try {
      const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(100) }).parse(req.body);
      res.json(await storage.reorderHomepageSections(ids));
    } catch (error: any) {
      res.status(400).json({ message: error?.issues?.[0]?.message || error?.message || "Unable to reorder sections" });
    }
  });

  /**
   * Shelf tile image upload.
   *
   * Returns `{ url }` and nothing else: the section row is not touched here. The
   * admin form puts the URL in `tileImageUrl` and saves it through the normal
   * create/update routes, so an upload that is never saved changes nothing on
   * the homepage.
   *
   * Storage follows the product images: Cloudinary when it is configured, with
   * the local `/uploads` directory as the fallback and the dev default. The
   * local directory comes from `resolveUploadsDir()`, which sits outside `dist/`
   * and is the directory `/uploads` is served from, so a rebuild keeps the file.
   *
   * Errors are `admin.homepage_error_*` keys, like the section validation, so
   * the admin panel can show them in the admin's language.
   */
  const tileImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: HOMEPAGE_TILE_IMAGE_MAX_BYTES, files: 1 },
  }).single("image");

  // Runs before multer so an anonymous request is refused without its body
  // being buffered.
  const requireAdminForUpload: RequestHandler = (req, res, next) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (!["admin", "superadmin"].includes((req.user as any).role)) return res.sendStatus(403);
    next();
  };

  app.post("/api/homepage-sections/tile-image", requireAdminForUpload, (req, res) => {
    tileImageUpload(req, res, async (uploadError: unknown) => {
      if (uploadError) {
        const tooLarge = uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE";
        return res
          .status(tooLarge ? 413 : 400)
          .json({ message: tooLarge ? "admin.homepage_error_image_too_large" : "admin.homepage_error_image_upload" });
      }
      const file = req.file;
      if (!file) return res.status(400).json({ message: "admin.homepage_error_image_upload" });

      // Three independent checks. The declared MIME type and the extension are
      // both chosen by the sender, so the file's own leading bytes are what
      // decide the type - and the stored extension comes from those bytes, never
      // from the original filename.
      const declaredExtension = path.extname(file.originalname).slice(1).toLowerCase();
      const detectedExtension = detectTileImageExtension(file.buffer);
      if (
        !(HOMEPAGE_TILE_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype) ||
        !(HOMEPAGE_TILE_IMAGE_EXTENSIONS as readonly string[]).includes(declaredExtension) ||
        !detectedExtension
      ) {
        return res.status(400).json({ message: "admin.homepage_error_image_type" });
      }

      try {
        // The extension comes from the detected content, never from the request.
        const saveLocally = () => saveUploadLocally(file.buffer, "homepage", detectedExtension);

        const isCloudinaryConfigured =
          process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;

        let url: string;
        if (isCloudinaryConfigured) {
          try {
            url = await uploadImage(file.buffer, "homepage");
          } catch (cloudErr) {
            console.error("[UPLOAD] Cloudinary failed, falling back to local storage:", cloudErr);
            url = saveLocally();
          }
        } else {
          url = saveLocally();
        }

        res.status(201).json({ url });
      } catch (error) {
        console.error("[HOMEPAGE] tile image upload failed:", error);
        res.status(500).json({ message: "admin.homepage_error_image_upload" });
      }
    });
  });

  // B&B Market orders / checkout
  app.post("/api/orders", async (req, res) => {
    try {
      const parsed = insertOrderSchema.parse(req.body);
      const normalizedItems: any[] = [];
      let subtotal = 0;

      // Never trust client-submitted prices. Re-read product prices and stock from the database.
      for (const requested of parsed.items) {
        const productId = Number(requested.id);
        if (!Number.isInteger(productId)) {
          return res.status(400).json({ message: `Produit invalide: ${requested.name}` });
        }
        const product = await storage.getProduct(productId);
        if (!product) return res.status(400).json({ message: `Produit introuvable: ${requested.name}` });
        const available = Number(product.quantity || 0);
        if (available < requested.quantity) {
          return res.status(409).json({ message: `Stock insuffisant pour ${product.name}. Disponible: ${available}` });
        }

        // Price, promotion and stock are all decided here from the freshly read
        // row, never from `requested`. The browser sends a `price` purely so the
        // cart can render a number; it has no authority over what is charged.
        //
        // `resolvePromotion` is the shared resolver the product cards also use, so
        // the price shown in the cart is by construction the price charged here.
        // A promotion that expired between page load and checkout silently falls
        // back to the regular price, which is the correct outcome: the customer
        // never pays more than the list price.
        const promotion = resolvePromotion(product);
        const unitPrice = promotion.effectivePrice;
        subtotal += unitPrice * requested.quantity;

        // Snapshot the *paid* unit price plus the promotion facts, so an order
        // placed during a promo still shows what was actually charged after the
        // offer ends. `originalPrice` is kept so the order history can show the
        // saving that was applied.
        normalizedItems.push({
          id: product.id,
          name: product.name,
          quantity: requested.quantity,
          price: unitPrice,
          originalPrice: promotion.regularPrice,
          promoApplied: promotion.status === "active",
          imageUrl: product.imageUrl,
        });
      }

      const user = req.isAuthenticated() ? (req.user as any) : null;
      const fulfillmentMethod = parsed.fulfillmentMethod;

      // Reject a method the admin has switched off. Read fresh from the database
      // so a stale client copy cannot resurrect a disabled option.
      const deliverySettings = await storage.getDeliverySettings();
      if (fulfillmentMethod === "delivery" && !deliverySettings.deliveryEnabled) {
        return res.status(400).json({ message: "La livraison à domicile n'est pas disponible actuellement." });
      }
      if (fulfillmentMethod === "pickup" && !deliverySettings.pickupEnabled) {
        return res.status(400).json({ message: "Le retrait en magasin n'est pas disponible actuellement." });
      }

      // The delivery fee is NEVER read from the request body. It is recomputed here
      // from the saved settings so a tampered payload cannot change what is charged.
      const deliveryFee = computeDeliveryFee(deliverySettings, fulfillmentMethod, subtotal);
      const total = Number((subtotal + deliveryFee).toFixed(3));

      const order = await storage.createOrder({
        userId: user?.id || null,
        customerName: parsed.customerName,
        email: parsed.email || user?.email || null,
        phone: parsed.phone,
        address: parsed.address || null,
        notes: parsed.notes || null,
        itemsJson: JSON.stringify(normalizedItems),
        subtotal,
        total,
        fulfillmentMethod,
        deliveryFee,
        status: "pending",
        paymentMethod: parsed.paymentMethod,
      });

      // Reserve/decrement stock after the order is persisted.
      for (const item of normalizedItems) {
        const product = await storage.getProduct(Number(item.id));
        if (product) await storage.updateProductStock(product.id, Math.max(0, Number(product.quantity || 0) - Number(item.quantity)));
      }

      if (user?.id) {
        await storage.createUserActivity(user.id, "order_create", `Commande #${order.id} créée (${order.total.toFixed(3)} DT)`);
      }
      res.status(201).json(order);
    } catch (error: any) {
      console.error("[ORDERS] create failed:", error);
      res.status(400).json({ message: error?.message || "Unable to create order" });
    }
  });

  // ---------------------------------------------------------------------------
  // Customer account: the customer's own orders.
  //
  // These are deliberately separate from the admin order routes above. Admins
  // read every order, including guest orders with no user_id, through
  // `GET /api/orders`. A customer only ever reaches rows where `user_id` is
  // their own id, and that filter happens in SQL (see
  // `storage.getOrderByIdForUser`).
  //
  // `GET /api/my-orders/:id` answers 404 rather than 403 for someone else's
  // order. A 403 would confirm the id exists, which turns the endpoint into an
  // oracle for enumerating order ids and their existence; 404 is the same
  // response a nonexistent id gets, so there is nothing to learn.
  // ---------------------------------------------------------------------------
  app.get("/api/my-orders", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    const orders = await storage.getOrdersByUserId(user.id);
    res.json(orders.map((order) => toCustomerOrderSummary(order)));
  });

  app.get("/api/my-orders/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    const id = parseInt(req.params.id);
    // A non-numeric id is a malformed request, not a missing order, so it is a
    // 400 rather than being folded into the 404 below.
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid order ID" });

    const order = await storage.getOrderByIdForUser(id, user.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Snapshots only: no product is re-read here. The response is built from the
    // stored row so history keeps showing what was billed even if the product
    // has since been renamed, repriced, promoted or deleted.
    res.json(toCustomerOrder(order));
  });

  app.get("/api/orders/my", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    // Kept for the pre-existing client/admin callers; same owner-scoped query
    // and same serialiser as `/api/my-orders`, so both paths agree exactly.
    const orders = await storage.getOrdersByUserId(user.id);
    res.json(orders.map((order) => toCustomerOrderSummary(order)));
  });

  app.get("/api/orders", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    res.json(await storage.getOrders());
  });

  app.patch("/api/orders/:id/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const status = String(req.body?.status || "");
    if (!["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid order ID" });
    const order = await storage.updateOrderStatus(id, status);
    if (!order) return res.sendStatus(404);
    await storage.createUserActivity(currentUser.id, "order_status", `Commande #${order.id}: ${order.status}`);
    res.json(order);
  });

  // ---------------------------------------------------------------------------
  // Customer wishlist.
  //
  // Every route here is owner-scoped from the session, never from the request
  // body: `user.id` is the only user id these handlers read. A body or query
  // parameter carrying a user id would be an easy way to turn "save my item"
  // into "read or delete someone else's", so there is no such parameter to
  // accept even if a caller sends one — Express ignores it.
  //
  // The same "404, not 403" rule as `/api/my-orders/:id` applies: one customer
  // must not be able to learn anything about another's favourites from the status
  // code of a delete.
  // ---------------------------------------------------------------------------

  /**
   * The current customer's favourites, joined to their products.
   *
   * Returns a `{ items, total }` envelope rather than a bare array, so the
   * response has one obvious place to grow (paging) without another breaking
   * change, and so the client can tell "loaded, empty" from "not loaded yet".
   */
  app.get("/api/wishlist", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    res.json(await storage.listWishlist(user.id));
  });

  app.post("/api/wishlist/:productId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    const productId = parseInt(req.params.productId, 10);

    // `parseInt` is lenient ("12abc" -> 12), so the integer check is what
    // actually rejects malformed input. A malformed id is a bad request; only a
    // well-formed id that resolves to nothing is a 404.
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    // `addWishlistItem` verifies the product exists and returns undefined when it
    // does not. Checking again here would only open a race with a concurrent
    // delete between the two reads.
    const result = await storage.addWishlistItem(user.id, productId);
    if (!result) return res.status(404).json({ message: "Product not found" });

    // 201 the first time, 200 on a repeat. Both are success: the state the client
    // asked for is already in place, and a double-clicked heart should not look
    // like a failure.
    res.status(result.created ? 201 : 200).json({
      productId,
      favorited: true,
      created: result.created,
    });
  });

  app.delete("/api/wishlist/:productId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    const productId = parseInt(req.params.productId, 10);

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const removed = await storage.removeWishlistItem(user.id, productId);
    // Unfavouriting something that is not favourited is a 200, not a 404: the
    // requested end state (not favourited) holds either way, so the toggle stays
    // idempotent. Only a product that does not exist at all is a 404, because
    // that tells the caller the id is meaningless.
    if (!removed) {
      const product = await storage.getProduct(productId);
      if (!product) return res.status(404).json({ message: "Product not found" });
    }

    res.json({ productId, favorited: false });
  });

  // Password Reset Routes
  app.post("/api/forgot-password", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!email) return res.status(400).send("Email requis");

      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(200).send("Si un compte existe, un lien de réinitialisation a été envoyé.");
      }

      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetCode = resetToken.slice(0, 8).toLowerCase();
      const expires = new Date(Date.now() + 10 * 60 * 1000);

      const emailSent = await sendPasswordResetLinkEmail(user.email, resetToken, resetCode);

      if (!emailSent) {
        return res.status(500).send("Erreur lors de l'envoi de l'email. Veuillez vérifier la configuration SMTP.");
      }

      await storage.setResetToken(user.id, resetToken, expires);
      res.status(200).send("Si un compte existe, un lien de réinitialisation a été envoyé.");
    } catch (error) {
      console.error("[ERROR] Dans /api/forgot-password:", error);
      res.status(500).send("Une erreur interne est survenue.");
    }
  });

  app.post("/api/verify-code", async (req, res) => {
    try {
      const { email, code } = req.body;
      if (!email || !code) {
        return res.status(400).send("Email et code requis");
      }

      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(400).send("Utilisateur non trouvé");
      }

      const normalizedCode = String(code).toLowerCase().replace(/\s/g, '');
      const storedToken = (user.resetToken || "").toLowerCase().replace(/\s/g, '');
      const isValid = !!storedToken && (normalizedCode === storedToken || normalizedCode === storedToken.slice(0, 8));

      if (!storedToken || !isValid) {
        return res.status(400).send("Code de confirmation incorrect.");
      }

      if (user.resetTokenExpires && new Date() > user.resetTokenExpires) {
        return res.status(400).send("Le code a expiré.");
      }

      res.status(200).send("Code valide.");
    } catch (error) {
      console.error("[ERROR] Dans /api/verify-code:", error);
      res.status(500).send("Une erreur est survenue.");
    }
  });

  app.post("/api/reset-password", async (req, res) => {
    try {
      const { email, code, token, newPassword, password } = req.body;
      const incomingToken = token || code || null;
      const finalPassword = newPassword || password || null;

      if ((!email && !incomingToken) || !finalPassword) {
        return res.status(400).send("Token/email et nouveau mot de passe sont requis.");
      }

      if (finalPassword.length < 6) {
        return res.status(400).send("Le nouveau mot de passe doit faire au moins 6 caractères.");
      }

      let user: any = null;

      if (email) {
        user = await storage.getUserByEmail(email);
      }

      if (!user && incomingToken) {
        const allUsers = await storage.getUsers();
        user = allUsers.find((candidate) => !!candidate.resetToken && candidate.resetToken.toLowerCase() === String(incomingToken).toLowerCase())
          || allUsers.find((candidate) => !!candidate.resetToken && candidate.resetToken.toLowerCase().startsWith(String(incomingToken).toLowerCase()));
      }

      if (!user || !user.resetToken) {
        return res.status(400).send("Lien ou code invalide ou expiré.");
      }

      if (user.resetTokenExpires && new Date() > user.resetTokenExpires) {
        return res.status(400).send("Le lien a expiré. Veuillez en demander un nouveau.");
      }

      const hashedPassword = await hashPassword(finalPassword);

      try {
        await storage.updateUserPassword(user.id, hashedPassword);
        await storage.setResetToken(user.id, null, null);
        res.status(200).send("Votre mot de passe a été réinitialisé avec succès.");
      } catch (dbError) {
        console.error(`[ERROR] Erreur lors de l'update en base pour ${user.id}:`, dbError);
        res.status(500).send("Erreur lors de l'enregistrement du nouveau mot de passe.");
      }
    } catch (error) {
      console.error("[ERROR] Dans /api/reset-password:", error);
      res.status(500).send("Une erreur est survenue lors de la réinitialisation.");
    }
  });

  // =====================================================================
  //  CATALOGUE
  //
  //  Every filter, sort, the total and the page window are applied by the
  //  database (see storage.queryProducts). The browser never receives more than
  //  `limit` rows.
  //
  //  This returns a paginated envelope rather than the bare array it used to
  //  return. The old shape had no ORDER BY at all and read the whole table on
  //  every call, so there was no page to request and no way to keep the admin
  //  panel from rendering thousands of rows. shared/routes.ts declares the
  //  envelope, so the compiler flags any consumer still expecting an array.
  // =====================================================================
  app.get(api.products.list.path, async (req, res) => {
    const parsed = productQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid query parameters" });
    }
    try {
      const result = await storage.queryProducts(parsed.data);
      res.json(result);
    } catch (err) {
      console.error("[ERROR] GET /api/products:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  const assetsDir = resolveAssetsDir();
  console.log(`[STATIC_ASSETS] Serving attached_assets`);
  app.use("/attached_assets", express.static(assetsDir));

  // Uploads live outside dist/ on purpose. `npm run build` empties dist/, so
  // serving them from there would drop every image an admin had uploaded.
  const uploadsDir = resolveUploadsDir();
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log(`[STATIC_UPLOADS] Serving /uploads`);
  app.use("/uploads", express.static(uploadsDir));

  // ---------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------
  // Registered with no auth guard, so Nginx/OVH can probe liveness without a
  // cookie. It performs no database query (only reports which dialect is
  // configured) so a locked-down or unreachable database cannot fail the probe
  // while the process itself is still healthy.
  //
  // Returns only safe, non-sensitive facts: no hostnames, no credentials,
  // no row counts, no internal paths.
  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "bb-market",
      database: resolveDbTarget().dialect,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get(api.products.get.path, async (req, res) => {
    // `Number("abc")` is NaN, which binds into the integer column as `22P02` on
    // PostgreSQL. Validated here so a malformed id is a 400 rather than a query
    // error; the sibling routes below already do this.
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid product ID" });
    }
    const product = await storage.getProduct(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(product);
  });

  app.post(api.messages.create.path, async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).send("Veuillez vous connecter pour passer une commande.");
      }
      const input = api.messages.create.input.parse(req.body);
      const user = req.user as any;
      const messageData = {
        ...input,
        email: input.email || user.email || null,
      };
      const message = await storage.createMessage(messageData);
      await storage.createUserActivity(user.id, "quote_request", "Demande de devis envoyée");
      res.status(201).json(message);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
        });
      }
      throw err;
    }
  });

  app.get(api.messages.list.path, async (req, res) => {
    // Contact messages carry names, emails and phone numbers, so this is admin-only.
    // There is no global auth middleware in front of the API; without this guard any
    // visitor could read the whole inbox.
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const messages = await storage.getMessages();
    res.json(messages);
  });

  app.delete(api.messages.delete.path, async (req, res) => {
    // Admin-only for the same reason as the list above, and the id is validated
    // because `parseInt("abc")` binds as NaN, which PostgreSQL rejects outright.
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid ID" });
    const success = await storage.deleteMessage(id);
    if (!success) {
      return res.status(404).json({ message: "Message introuvable" });
    }
    res.json({ message: "Message supprimé" });
  });

  // ============================================
  //  ROUTE CORRIGÉE: Update message status avec déduction du stock
  // ============================================
  app.patch("/api/messages/:id/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "ID invalide" });

    const { status } = req.body;
    if (!status || !["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Statut invalide. Utilisez: pending, approved, rejected" });
    }

    try {
      const currentUser = req.user as any;
      const message = await storage.updateMessageStatusWithActor(id, status, currentUser.username);
      if (!message) {
        return res.status(404).json({ message: "Message introuvable" });
      }

      // ============================================
      //  DÉDUCTION DU STOCK - Version ultra robuste
      // ============================================
      if (status === "approved") {
        dbg(`📦 [STOCK] ========== DÉBUT TRAITEMENT COMMANDE #${id} ==========`);
        dbg(`📦 [STOCK] selectedItems brut:`, message.selectedItems);
        dbg(`📦 [STOCK] Type de selectedItems:`, typeof message.selectedItems);

        if (message.selectedItems) {
          try {
            let selectedItems = null;
            let rawData = message.selectedItems;

            // Étape 1: Parser si c'est une chaîne JSON
            if (typeof rawData === 'string') {
              try {
                selectedItems = JSON.parse(rawData);
                dbg(`📦 [STOCK] Parse JSON réussi`);
              } catch (e) {
                dbg(`📦 [STOCK] Erreur de parse JSON, tentative avec évaluation`);
                // Si c'est une chaîne qui ressemble à un tableau mais mal formaté
                try {
                  selectedItems = eval(`(${rawData})`);
                } catch (e2) {
                  console.error(`[STOCK] Impossible de parser les articles de la commande`);
                  selectedItems = null;
                }
              }
            } else {
              selectedItems = rawData;
            }

            if (!selectedItems) {
              dbg(`📦 [STOCK] selectedItems est null après parsing`);
            } else {
              dbg(`📦 [STOCK] selectedItems après parsing:`, JSON.stringify(selectedItems, null, 2));
              dbg(`📦 [STOCK] Type après parsing:`, typeof selectedItems);
              dbg(`📦 [STOCK] Est un tableau?`, Array.isArray(selectedItems));

              // Étape 2: Normaliser en tableau
              let itemsArray = [];

              if (Array.isArray(selectedItems)) {
                itemsArray = selectedItems;
              } else if (selectedItems && typeof selectedItems === 'object') {
                // Si c'est un objet, essayer d'extraire les valeurs
                if (selectedItems.items && Array.isArray(selectedItems.items)) {
                  itemsArray = selectedItems.items;
                } else {
                  // Convertir l'objet en tableau de ses valeurs
                  const values = Object.values(selectedItems);
                  // Vérifier si les valeurs ressemblent à des items
                  if (values.length > 0 && values[0] && typeof values[0] === 'object') {
                    itemsArray = values;
                  } else {
                    itemsArray = [selectedItems];
                  }
                }
              }

              dbg(`📦 [STOCK] Nombre d'articles après normalisation:`, itemsArray.length);

              let stockUpdated = false;
              const stockDetails = [];
              const stockErrors = [];

              // Étape 3: Traiter chaque item
              for (let index = 0; index < itemsArray.length; index++) {
                const item = itemsArray[index];
                dbg(`📦 [STOCK] --- Article ${index + 1}/${itemsArray.length} ---`);
                dbg(`📦 [STOCK] Item brut:`, JSON.stringify(item, null, 2));

                // Extraire l'ID du produit (chercher dans toutes les propriétés possibles)
                let productId = null;
                const possibleIdFields = ['id', 'productId', 'product_id', 'product.id', 'ID', 'productID'];
                for (const field of possibleIdFields) {
                  const parts = field.split('.');
                  let value = item;
                  for (const part of parts) {
                    if (value && typeof value === 'object') {
                      value = value[part];
                    } else {
                      value = undefined;
                      break;
                    }
                  }
                  if (value !== undefined && value !== null) {
                    productId = parseInt(value);
                    if (!isNaN(productId)) break;
                  }
                  // Essayer directement
                  if (item[field] !== undefined && item[field] !== null) {
                    productId = parseInt(item[field]);
                    if (!isNaN(productId)) break;
                  }
                }

                // Si toujours pas d'ID, essayer de trouver une propriété qui ressemble à un ID
                if (!productId) {
                  for (const key of Object.keys(item)) {
                    if (key.toLowerCase().includes('id') && !isNaN(parseInt(item[key]))) {
                      productId = parseInt(item[key]);
                      break;
                    }
                  }
                }

                // Extraire la quantité
                let quantity = 0;
                const possibleQtyFields = ['quantity', 'qty', 'quantite', 'amount', 'count', 'number', 'Qty'];
                for (const field of possibleQtyFields) {
                  if (item[field] !== undefined && item[field] !== null) {
                    const val = String(item[field]).replace('x', '').trim();
                    const num = parseInt(val);
                    if (!isNaN(num) && num > 0) {
                      quantity = num;
                      break;
                    }
                  }
                }

                // Si pas de quantité, utiliser 1 par défaut
                if (quantity <= 0) {
                  quantity = 1;
                }

                dbg(`📦 [STOCK] ID extrait: ${productId}, Quantité extraite: ${quantity}`);

                if (!productId) {
                  stockErrors.push(`Article ${index + 1} sans ID: ${JSON.stringify(item)}`);
                  continue;
                }

                // Récupérer le produit
                const product = await storage.getProduct(productId);
                if (!product) {
                  stockErrors.push(`Produit ID ${productId} non trouvé`);
                  continue;
                }

                // Calculer la nouvelle quantité
                const currentQuantity = parseInt(String(product.quantity)) || 0;

                if (currentQuantity < quantity) {
                  stockErrors.push(`Stock insuffisant pour ${product.name} (disponible: ${currentQuantity}, commandé: ${quantity})`);
                  continue;
                }

                const newQuantity = currentQuantity - quantity;

                // Mettre à jour le stock
                const updatedProduct = await storage.updateProductStock(productId, newQuantity);
                if (updatedProduct) {
                  stockUpdated = true;
                  stockDetails.push(`${product.name}: ${currentQuantity} → ${newQuantity} (${quantity} déduits)`);
                  dbg(`📦 [STOCK] ${product.name}: ${currentQuantity} → ${newQuantity}`);

                  // Envoyer une alerte si le stock devient faible
                  if (newQuantity <= 10) {
                    await sendStockAlertEmail(
                      product.name,
                      product.category,
                      newQuantity,
                      10
                    );
                  }
                } else {
                  stockErrors.push(`Erreur lors de la mise à jour du stock pour ${product.name}`);
                }
              }

              // Logger les résultats
              dbg(`📦 [STOCK] ========== RÉSULTATS ==========`);
              if (stockDetails.length > 0) {
                dbg(`📦 [STOCK] Mises à jour effectuées:`, stockDetails);
              }
              if (stockErrors.length > 0) {
                console.warn("[STOCK] Stock deduction errors:", stockErrors);
              }

              if (stockUpdated) {
                await storage.createUserActivity(
                  (req.user as any).id,
                  "stock_deducted",
                  `Stock déduit pour la commande #${id} (${itemsArray.length} article(s)): ${stockDetails.join('; ')}`
                );
                dbg(`📦 [STOCK] Stock mis à jour avec succès pour la commande #${id}`);
              } else {
                dbg(`📦 [STOCK] Aucun stock mis à jour pour la commande #${id}`);
                if (stockErrors.length > 0) {
                  console.warn("[STOCK] Stock deduction errors:", stockErrors);
                }
              }
            }
          } catch (parseError) {
            console.error(`[STOCK] Erreur lors du traitement:`, parseError);
          }
        } else {
          dbg(`📦 [STOCK] selectedItems est null ou vide pour la commande #${id}`);
        }
        dbg(`📦 [STOCK] ========== FIN TRAITEMENT COMMANDE #${id} ==========`);
      }

      // Send rejection email if status is "rejected"
      if (status === "rejected" && message.email) {
        sendRejectionEmail(message.email, message.name).catch(err => {
          console.error("[ERROR] Erreur envoi email de rejet:", err);
        });
      }

      // Track status change activity
      const statusLabels: Record<string, string> = { approved: "approuvée", rejected: "rejetée", pending: "mise en attente" };
      await storage.createUserActivity(currentUser.id, "status_change", `Commande de ${message.name} ${statusLabels[status] || status}`);

      if (message.email) {
        try {
          const messageOwner = await storage.getUserByEmail(message.email);
          if (messageOwner) {
            const userStatusLabels: Record<string, string> = { approved: "approuvée", rejected: "rejetée", pending: "remise en attente" };
            await storage.createUserActivity(messageOwner.id, "status_change", `Votre commande a été ${userStatusLabels[status] || status}`);
          }
        } catch (e) {
          console.error("[ERROR] Failed to log activity for message owner:", e);
        }
      }

      res.json(message);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur lors de la mise à jour du statut" });
    }
  });

  // Configure Multer
  // `limits.fileSize` is required in production: without it a single oversized
  // upload is buffered entirely in memory and can OOM the process. 10 MB is
  // comfortably above normal product photos. Nginx enforces the same ceiling
  // (client_max_body_size) so oversized bodies are rejected before they arrive.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024), // 10 MB
      files: 1,
    },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(null, false);
      }
    }
  });

  app.patch("/api/settings/stickers-image", upload.single('stickersImage'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Image file is required" });
      }

      let stickersImageUrl: string;
      const isCloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME && 
        process.env.CLOUDINARY_API_KEY && 
        process.env.CLOUDINARY_API_SECRET;

      if (isCloudinaryConfigured) {
        try {
          stickersImageUrl = await uploadImage(req.file.buffer, 'settings');
        } catch (cloudErr) {
          console.error("[UPLOAD] Cloudinary failed, falling back to local storage:", cloudErr);
          stickersImageUrl = saveUploadLocally(req.file.buffer, "settings", uploadExtension(req.file.originalname));
        }
      } else {
        stickersImageUrl = saveUploadLocally(req.file.buffer, "settings", uploadExtension(req.file.originalname));
      }

      const settings = await storage.updateSettings({ stickersImageUrl });
      res.json(settings);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/products", upload.single('image'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Image is required" });
      }

      // Validate the promotion *before* the image is uploaded, so a rejected
      // promotion does not leave an orphaned file in Cloudinary or /uploads.
      // Without this the row was still written, just with whatever price was
      // sent, because storage only normalises and does not validate.
      const promoErrors = checkPromotion({
        price: req.body.price,
        promoPrice: req.body.promoPrice,
        promoStart: req.body.promoStart,
        promoEnd: req.body.promoEnd,
      });
      if (promoErrors.length) {
        return res.status(400).json({ message: promoErrors[0], errors: promoErrors });
      }

      let imageUrl: string;
      const isCloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME && 
        process.env.CLOUDINARY_API_KEY && 
        process.env.CLOUDINARY_API_SECRET;

      if (isCloudinaryConfigured) {
        try {
          imageUrl = await uploadImage(req.file.buffer, 'products');
        } catch (cloudErr) {
          console.error("[UPLOAD] Cloudinary failed, falling back to local storage:", cloudErr);
          imageUrl = saveUploadLocally(req.file.buffer, "product", uploadExtension(req.file.originalname));
        }
      } else {
        imageUrl = saveUploadLocally(req.file.buffer, "product", uploadExtension(req.file.originalname));
      }

      const productData = {
        name: req.body.name,
        description: req.body.description,
        category: req.body.category,
        quantity: req.body.quantity || "10",
        price: req.body.price || "0",
        // Already validated above; storage normalises "" to NULL. An empty field
        // simply stores no promotion, so products created before migration 0003
        // and products created today with no offer are the same shape.
        promoPrice: req.body.promoPrice || null,
        promoStart: req.body.promoStart || null,
        promoEnd: req.body.promoEnd || null,
        imageUrl
      };

      if (!productData.name || !productData.description || !productData.category) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const product = await storage.createProduct(productData);
      await storage.createUserActivity(currentUser.id, "product_create", `Produit créé: ${product.name}`);
      res.status(201).json(product);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/products/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const success = await storage.deleteProduct(id);
    if (success) {
      await storage.createUserActivity(currentUser.id, "product_delete", `Produit supprimé (ID: ${id})`);
      res.sendStatus(204);
    } else {
      res.status(404).json({ message: "Product not found" });
    }
  });

  app.patch("/api/products/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    try {
      // Whitelist the updatable fields instead of forwarding `req.body`.
      // Forwarding the raw body meant a caller could set `id`, `createdAt`, or
      // anything else the client invented, and there was no validation at all.
      const patch: Record<string, unknown> = {};
      for (const field of ["name", "description", "category", "imageUrl", "quantity", "price"]) {
        if (req.body[field] !== undefined) patch[field] = req.body[field];
      }

      // Promotion fields are always written together when any of them is present:
      // sending `promoPrice` alone must also clear a stale window, or the row
      // would keep an end date for a discount that no longer exists.
      const touchesPromotion = ["promoPrice", "promoStart", "promoEnd"].some(
        (field) => req.body[field] !== undefined,
      );
      // Validation must also run when only `price` changes: a promo that was
      // valid at price 100 breaks the moment the price is dropped to 50 while
      // the stored promo stays at 80. Validating on `touchesPromotion` alone
      // let that through.
      if (touchesPromotion || patch.price !== undefined) {
        // Validate against the *resulting* row, not against the patch alone.
        const existing = await storage.getProduct(id);
        if (!existing) return res.status(404).json({ message: "Product not found" });

        const merged = {
          price: (patch.price !== undefined ? patch.price : existing.price) as string | number,
          promoPrice: req.body.promoPrice !== undefined ? req.body.promoPrice : existing.promoPrice,
          promoStart: req.body.promoStart !== undefined ? req.body.promoStart : existing.promoStart,
          promoEnd: req.body.promoEnd !== undefined ? req.body.promoEnd : existing.promoEnd,
        };

        const promoErrors = checkPromotion(merged);
        if (promoErrors.length) {
          return res.status(400).json({ message: promoErrors[0], errors: promoErrors });
        }

        // Only rewrite the promotion columns when the caller actually sent them;
        // a price-only edit must leave the stored window untouched.
        if (touchesPromotion) {
          patch.promoPrice = req.body.promoPrice ?? null;
          patch.promoStart = req.body.promoStart ?? null;
          patch.promoEnd = req.body.promoEnd ?? null;
        }
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ message: "No updatable fields provided" });
      }

      const product = await storage.updateProduct(id, patch as any);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      await storage.createUserActivity(currentUser.id, "product_update", `Produit modifié: ${product.name}`);
      res.json(product);
    } catch (err) {
      console.error("[PRODUCTS] Product update failed:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Stock management endpoint
  app.patch("/api/products/:id/stock", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (currentUser.role !== "admin" && currentUser.role !== "superadmin") {
      return res.status(403).send("Accessible aux administrateurs uniquement");
    }
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "ID invalide" });

    const { quantity } = req.body;
    if (quantity === undefined || quantity === null || typeof quantity !== "number" || quantity < 0) {
      return res.status(400).json({ message: "Quantité invalide. Doit être un nombre >= 0" });
    }

    try {
      const product = await storage.updateProductStock(id, quantity);
      if (!product) return res.status(404).json({ message: "Produit non trouvé" });

      await storage.createUserActivity(currentUser.id, "product_update", `Stock mis à jour: ${product.name} → ${quantity}`);

      const currentQuantity = typeof product.quantity === 'string'
        ? parseInt(product.quantity, 10) || 0
        : product.quantity || 0;

      if (currentQuantity <= 10) {
        await sendStockAlertEmail(product.name, product.category, currentQuantity, 10);
        if (currentQuantity === 0) {
          await storage.createUserActivity(currentUser.id, "out_of_stock", `🚨 ${product.name} est en Repture de stock!`);
        } else {
          await storage.createUserActivity(currentUser.id, "low_stock", `${product.name} a un stock faible (${currentQuantity} restants)`);
        }
      }

      res.json(product);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur lors de la mise à jour du stock" });
    }
  });

  // Debug helper for the stock-alert email. Unused by the client, and it sends a real
  // message on every call, so it is admin-only rather than open: otherwise anyone who
  // can reach the API can use the server as a mail relay.
  app.post('/api/test/stock-alert', async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const { productName = 'Produit Test', category = 'Test', quantity = 3 } = req.body;
    const result = await sendStockAlertEmail(productName, category, quantity, 10);
    res.json({ 
      message: result ? 'Email envoyé avec succès' : 'Erreur lors de l\'envoi',
      sent: result 
    });
  });

  // Promos API
  app.get("/api/promos", async (req, res) => {
    const promos = await storage.getPromos();
    res.json(promos);
  });

  app.post("/api/promos", upload.single('image'), async (req, res) => {
    // Guarded before the file check, so an unauthorised caller cannot tell a missing
    // upload apart from a valid request. GET stays public: the storefront renders
    // these to anonymous visitors.
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Image is required" });
      }

      let imageUrl: string;
      const isCloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME && 
        process.env.CLOUDINARY_API_KEY && 
        process.env.CLOUDINARY_API_SECRET;

      if (isCloudinaryConfigured) {
        try {
          imageUrl = await uploadImage(req.file.buffer, 'promos');
        } catch (cloudErr) {
          console.error("[UPLOAD] Cloudinary failed, falling back to local storage:", cloudErr);
          imageUrl = saveUploadLocally(req.file.buffer, "promo", uploadExtension(req.file.originalname));
        }
      } else {
        imageUrl = saveUploadLocally(req.file.buffer, "promo", uploadExtension(req.file.originalname));
      }

      const promoData = {
        productName: req.body.productName,
        category: req.body.category,
        description: req.body.description,
        imageUrl
      };

      const promo = await storage.createPromo(promoData);
      res.status(201).json(promo);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/promos/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const success = await storage.deletePromo(id);
    if (success) {
      res.sendStatus(204);
    } else {
      res.status(404).json({ message: "Promo not found" });
    }
  });

  app.patch("/api/promos/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    try {
      const promo = await storage.updatePromo(id, req.body);
      if (!promo) return res.status(404).json({ message: "Promo not found" });
      res.json(promo);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Settings API
  app.get("/api/settings", async (req, res) => {
    const settings = await storage.getSettings();
    res.json(settings);
  });

  // Public: the checkout needs the delivery rules before any order exists.
  app.get("/api/delivery-settings", async (_req, res) => {
    res.json(await storage.getDeliverySettings());
  });

  // Admin only: the delivery & pickup configuration.
  app.patch("/api/delivery-settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    try {
      const parsed = insertSettingsSchema.parse(req.body);
      const updated = await storage.updateSettings({
        pickupEnabled: parsed.pickupEnabled,
        deliveryEnabled: parsed.deliveryEnabled,
        deliveryFee: parsed.deliveryFee,
        freeDeliveryThreshold: parsed.freeDeliveryThreshold,
        deliveryNote: parsed.deliveryNote,
      });
      if (currentUser.id) {
        await storage.createUserActivity(currentUser.id, "delivery_settings_update", "Paramètres de livraison mis à jour");
      }
      res.json(updated);
    } catch (err: any) {
      const message = err?.issues?.[0]?.message || err?.message || "Unable to update delivery settings";
      res.status(400).json({ message });
    }
  });

  app.patch("/api/settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const settings = await storage.updateSettings(req.body);
      res.json(settings);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Social Media Embeds API
  // Public read: the homepage renders these embeds for anonymous visitors.
  app.get("/api/social-media", async (req, res) => {
    try {
      res.json(await storage.getSocialMediaEmbeds());
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Admin only: upsert (save or clear) the embed URL for one platform.
  app.patch("/api/social-media", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    try {
      const parsed = upsertSocialMediaEmbedSchema.parse(req.body);
      // An empty url means "remove this link" - keep the row so ordering stays stable.
      const embed = await storage.upsertSocialMediaEmbed(
        parsed.platform,
        parsed.url === "" ? null : parsed.url,
      );
      await storage.createUserActivity(currentUser.id, "social_media_update", `Réseau social mis à jour: ${parsed.platform}`);
      res.json(embed);
    } catch (error: any) {
      res.status(400).json({ message: error?.message || "Unable to update social media link" });
    }
  });

  // Admin only: hard-remove the record for a platform.
  app.delete("/api/social-media/:platform", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const platform = String(req.params.platform || "");
    if (!SOCIAL_PLATFORMS.includes(platform as any)) {
      return res.status(400).json({ message: "Plateforme invalide" });
    }
    try {
      const removed = await storage.deleteSocialMediaEmbed(platform as SocialPlatform);
      if (!removed) return res.sendStatus(404);
      await storage.createUserActivity(currentUser.id, "social_media_update", `Réseau social supprimé: ${platform}`);
      res.sendStatus(204);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Sticker Catalogs API
  app.get("/api/stickers", async (req, res) => {
    try {
      const catalogs = await storage.getStickerCatalogs();
      res.json(catalogs);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/stickers", upload.single('image'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
try {
      if (!req.file) {
        return res.status(400).json({ message: "Image is required" });
      }

      let imageUrl: string;
      const isCloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME && 
        process.env.CLOUDINARY_API_KEY && 
        process.env.CLOUDINARY_API_SECRET;

      if (isCloudinaryConfigured) {
        try {
          imageUrl = await uploadImage(req.file.buffer, 'stickers');
        } catch (cloudErr) {
          console.error("[UPLOAD] Cloudinary failed, falling back to local storage:", cloudErr);
          imageUrl = saveUploadLocally(req.file.buffer, "sticker", uploadExtension(req.file.originalname));
        }
      } else {
        imageUrl = saveUploadLocally(req.file.buffer, "sticker", uploadExtension(req.file.originalname));
      }

      const catalogData = {
        title: req.body.title,
        description: req.body.description || "",
        imageUrl
      };

      if (!catalogData.title) {
        return res.status(400).json({ message: "Title is required" });
      }

      const catalog = await storage.createStickerCatalog(catalogData);
      res.status(201).json(catalog);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/stickers/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const success = await storage.deleteStickerCatalog(id);
    if (success) {
      res.sendStatus(204);
    } else {
      res.status(404).json({ message: "Catalog not found" });
    }
  });

  app.patch("/api/stickers/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    try {
      const catalog = await storage.updateStickerCatalog(id, req.body);
      if (!catalog) return res.status(404).json({ message: "Catalog not found" });
      res.json(catalog);
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

app.post("/api/user/change-password", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { oldPassword, newPassword } = req.body;
      const user = req.user as any;

      const isMatch = await comparePasswords(oldPassword, user.password);
      if (!isMatch) {
        return res.status(400).send("L'ancien mot de passe est incorrect");
      }

      const hashed = await hashPassword(newPassword);
      await storage.updateUserPassword(user.id, hashed);
      await storage.createUserActivity(user.id, "password_change", "Mot de passe modifié");

      res.status(200).send("Mot de passe mis à jour avec succès");
    } catch (err) {
      res.status(500).json({ message: "Erreur lors de la mise à jour du mot de passe" });
    }
  });

  // Route pour définir un mot de passe pour les utilisateurs Google
  app.post("/api/user/set-password", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { newPassword } = req.body;
      const user = req.user as any;

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).send("Le mot de passe doit contenir au moins 6 caractères");
      }

      const hashed = await hashPassword(newPassword);
      await storage.updateUserPassword(user.id, hashed);
      await storage.createUserActivity(user.id, "password_set", "Mot de passe créé");

      res.status(200).send("Mot de passe créé avec succès");
    } catch (err) {
      res.status(500).json({ message: "Erreur lors de la création du mot de passe" });
    }
  });

  app.get("/api/user/my-activities", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    try {
      const activities = await storage.getUserActivitiesByUserId(user.id);
      res.json(activities);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur lors de la récupération de l'historique" });
    }
  });

  // User Management API
  app.get("/api/admin/users", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    if (user.role !== "superadmin") return res.status(403).send("Accessible aux Super Admins uniquement");

    const userList = await storage.getUsers();
    const sanitizedUsers = userList.map(({ password, ...u }) => u);
    res.json(sanitizedUsers);
  });

  app.get("/api/admin/user-activities", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (currentUser.role !== "superadmin") return res.status(403).send("Accessible aux Super Admins uniquement");

    const [activities, userList] = await Promise.all([storage.getUserActivities(), storage.getUsers()]);
    const usersById = new Map(userList.map(({ password, ...safeUser }) => [safeUser.id, safeUser]));
    res.json(activities.map(activity => ({ ...activity, user: usersById.get(activity.userId) || null })));
  });

  app.post("/api/admin/users", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (currentUser.role !== "superadmin") return res.status(403).send("Accessible aux Super Admins uniquement");

    try {
      const { username, email, password, role } = req.body;

      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) return res.status(400).send("Cet identifiant est déjà utilisé");

      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) return res.status(400).send("Cet email est déjà utilisé");

      const hashedPassword = await hashPassword(password);
      const newUser = await storage.createUser({
        username,
        email,
        password: hashedPassword,
        role: role || "admin"
      });

      const { password: _, ...sanitized } = newUser;

      sendWelcomeEmail(newUser.email, newUser.username).catch(err => {
        console.error("[ERROR] Erreur envoi email bienvenue admin:", err);
      });

      res.status(201).json(sanitized);
    } catch (err) {
      res.status(500).json({ message: "Erreur lors de la création de l'utilisateur" });
    }
  });

  app.delete("/api/admin/users/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (currentUser.role !== "superadmin") return res.status(403).send("Accessible aux Super Admins uniquement");

    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) return res.status(400).send("ID invalide");

    const allUsers = await storage.getUsers();
    const superAdmins = allUsers.filter(u => u.role === "superadmin");
    const targetUser = allUsers.find(u => u.id === targetId);

    if (targetId === currentUser.id) {
      return res.status(400).send("Vous ne pouvez pas supprimer votre propre compte");
    }

    if (targetUser?.username === "Mohamed") {
      return res.status(403).send("Le compte de Mohamed est protégé et ne peut pas être supprimé");
    }

    if (targetUser?.role === "superadmin" && superAdmins.length <= 1) {
      return res.status(400).send("Impossible de supprimer le dernier Super Admin");
    }

    const success = await storage.deleteUser(targetId);
    if (success) {
      res.sendStatus(204);
    } else {
      res.status(404).send("Utilisateur non trouvé");
    }
  });

  app.post("/api/admin/backup", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (currentUser.role !== "superadmin") return res.status(403).send("Accessible aux Super Admins uniquement");

    try {
      const filename = await performBackup();
      res.status(200).json({ 
        message: "Sauvegarde réussie et envoyée vers Backblaze B2.", 
        filename 
      });
    } catch (err: any) {
      console.error("[ERROR] Échec de la sauvegarde:", err);
      res.status(500).json({ 
        message: "Échec de la sauvegarde de la base de données.", 
        error: err.message 
      });
    }
  });

  // =====================================================================
  // Admin analytics dashboard
  // =====================================================================
  //
  // One endpoint for the whole dashboard, for the reasons recorded on
  // `api.adminAnalytics` in shared/routes.ts: the panels render together, and a
  // single response cannot describe two different date windows.
  //
  // The role check mirrors the rest of the admin surface in this file: 401 when
  // there is no session, 403 when the session is not an admin. `/api/admin/users`
  // is superadmin-only, but analytics is aggregate sales reporting rather than
  // account administration, so `admin` is allowed - the same rule as
  // `/api/products`.
  app.get("/api/admin/analytics", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) {
      return res.status(403).json({ message: "Analytics is restricted to administrators" });
    }

    const parsed = analyticsQuerySchema.safeParse({
      range: req.query.range,
      from: req.query.from,
      to: req.query.to,
    });
    if (!parsed.success) {
      // Surface the first message rather than a Zod dump: the client shows this
      // text next to the date inputs, where a schema path would be meaningless.
      return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid analytics range" });
    }

    try {
      res.json(await getAnalyticsDashboard(parsed.data));
    } catch (error) {
      console.error("[ANALYTICS] dashboard failed:", error);
      res.status(500).json({ message: "Unable to load analytics" });
    }
  });

  app.patch("/api/user/profile", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    
    try {
      const { fullName, phone, email } = req.body;
      const updateData: any = {};
      if (fullName !== undefined) updateData.fullName = fullName;
      if (phone !== undefined) updateData.phone = phone;
      if (email !== undefined) updateData.email = email;

      const updatedUser = await storage.updateUser(currentUser.id, updateData);
      if (!updatedUser) return res.status(404).json({ message: "Utilisateur non trouvé" });

      await storage.createUserActivity(currentUser.id, "profile_update", "Profil mis à jour");

      const { password, ...safeUser } = updatedUser as any;
      res.json(safeUser);
    } catch (err) {
      console.error("[ERROR] Profile update failed:", err);
      res.status(500).json({ message: "Erreur lors de la mise à jour du profil" });
    }
  });

  // Notifications API
  app.get("/api/notifications", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    
    try {
      if (currentUser.role === "admin" || currentUser.role === "superadmin") {
        const allMessages = await storage.getMessages();
        const unreadMessages = allMessages.filter(m => !m.read);
        const recentMessages = allMessages.slice(0, 10).map(m => ({
          id: m.id,
          type: "message",
          title: `Nouveau message de ${m.name}`,
          description: m.message?.substring(0, 80) + (m.message?.length > 80 ? "..." : ""),
          createdAt: m.createdAt,
          read: m.read,
          link: "/admin?section=messages"
        }));

        // Stock alerts are derived in SQL instead of by reading the whole table.
        // `stock_asc` over the in-stock rows is exactly the low-stock list, and
        // the quantity index serves it, so this stays cheap at any catalogue
        // size. The badge count uses `total`, so it is not capped by the limit.
        const LOW_STOCK_ALERT_LIMIT = 20;
        const [lowStockPage, outOfStockPage] = await Promise.all([
          storage.queryProducts({ page: 1, limit: LOW_STOCK_ALERT_LIMIT, search: "", category: "", stock: "in", promo: "all", sort: "stock_asc" }),
          storage.queryProducts({ page: 1, limit: LOW_STOCK_ALERT_LIMIT, search: "", category: "", stock: "out", promo: "all", sort: "newest" }),
        ]);

        // "Low stock" means 1..5 units. A dedicated range filter is not exposed in
        // the public API, so trim the (already cheapest-first) page here.
        const lowStockProducts = lowStockPage.items
          .filter((p) => Number(p.quantity ?? 0) <= 5)
          .map(p => ({
            id: p.id,
            type: "stock_alert",
            title: `Stock faible: ${p.name}`,
            description: `Il ne reste que ${p.quantity} unité(s) en stock.`,
            createdAt: new Date().toISOString(),
            read: false,
            link: "/admin?section=stock"
          }));

        const outOfStockProducts = outOfStockPage.items.map(p => ({
          id: p.id,
          type: "out_of_stock",
          title: `Rupture de stock: ${p.name}`,
          description: `Le produit "${p.name}" est en rupture de stock.`,
          createdAt: new Date().toISOString(),
          read: false,
          link: "/admin?section=stock"
        }));

        const stockNotifications = [...lowStockProducts, ...outOfStockProducts];
        const allNotifications = [...recentMessages, ...stockNotifications];
        // The true number of products needing attention, not the capped list length.
        const outOfStockTotal = outOfStockPage.total;
        const badgeCount = unreadMessages.length + outOfStockTotal;

        res.json({
          count: badgeCount,
          items: allNotifications
        });
      } else {
        const activities = await storage.getUserActivitiesByUserId(currentUser.id);
        const recentActivityItems = activities.slice(0, 10).map(a => {
          const typeLabels: Record<string, string> = {
            status_change: "Mise à jour de commande",
            quote_request: "Demande de devis",
            password_change: "Mot de passe modifié",
            profile_update: "Profil mis à jour",
            login: "Connexion",
            logout: "Déconnexion",
            register: "Inscription"
          };
          return {
            id: a.id,
            type: a.type,
            title: typeLabels[a.type] || a.type,
            description: a.details || "",
            createdAt: a.createdAt,
            read: true,
            link: "/my-history"
          };
        });
        
        const unreadCount = activities.filter(a => a.type === "status_change").length;

        res.json({
          count: unreadCount,
          items: recentActivityItems
        });
      }
    } catch (err) {
      console.error("[ERROR] Failed to fetch notifications:", err);
      res.status(500).json({ count: 0, items: [] });
    }
  });

  // ---------------------------------------------------------------------------
  // Demo seed data - LOCAL DEVELOPMENT ONLY
  // ---------------------------------------------------------------------------
  // This inserts placeholder products from the SRED template whenever the
  // products table is empty. On a fresh production database that would inject
  // five wrong products, priced at 0 DT and pointing at SRED image paths, into
  // the live catalog the moment the service started.
  //
  // It is therefore gated on NODE_ENV and on an explicit opt-in flag. Production
  // databases must be populated through the admin UI or an import.
  // ---------------------------------------------------------------------------
  if (process.env.NODE_ENV !== "production" && process.env.SEED_DEMO_PRODUCTS === "1") {
    // A single row is enough to answer "is the catalogue empty?"; fetching the
    // whole table to check a count is the pattern this feature set removes.
    const existing = await storage.queryProducts({ page: 1, limit: 1, search: "", category: "", stock: "all", promo: "all", sort: "newest" });
    if (existing.total === 0) {
      await storage.createProduct({
      name: "Bouquet de Roses Éternelles - Noir",
      description: "Un élégant bouquet de roses roses présenté dans un étui noir sophistiqué 'Best Wishes'.",
      imageUrl: "/attached_assets/qsdf_1768570430833.jpeg",
      category: "Cadeaux & Décor",
      quantity: "60",
      price: "0"
    });
    await storage.createProduct({
      name: "Bouquet de Roses Passion - Rose",
      description: "Roses rouges vibrantes dans un étui rose délicat.",
      imageUrl: "/attached_assets/qsdqsd_1768570430833.jpeg",
      category: "Cadeaux & Décor",
      quantity: "60",
      price: "0"
    });
    await storage.createProduct({
      name: "Bouquet Lavande Sérénité - Rose",
      description: "Délicates roses lilas dans un étui rose, apportant une touche de calme.",
      imageUrl: "/attached_assets/qsdqsdqds_1768570430834.jpeg",
      category: "Cadeaux & Décor",
      quantity: "60",
      price: "0"
    });
    await storage.createProduct({
      name: "Bouquet Azur Éclatant - Rose",
      description: "Roses bleues uniques dans un étui rose contrasté.",
      imageUrl: "/attached_assets/WhatsApp_Image_2026-01-16_at_2.27.45_PM_1768570430834.jpeg",
      category: "Cadeaux & Décor",
      quantity: "60",
      price: "0"
    });
    await storage.createProduct({
      name: "Boîtes en Carton Sur Mesure",
      description: "Solutions d'emballage robustes et personnalisables.",
      imageUrl: "https://images.unsplash.com/photo-1589793462417-10afb737d926?auto=format&fit=crop&q=80&w=800",
      category: "Emballage Industriel",
      quantity: "60",
      price: "0"
    });
      console.log("[SEED] Inserted demo products (SEED_DEMO_PRODUCTS=1, non-production only)");
    }
  }

// Route de debug pour voir le contenu de selectedItems
app.get('/api/debug/message/:id', async (req, res) => {
  // Admin-only, not merely authenticated: this returns a full contact message
  // (name, phone, address, notes), and a signed-in customer must not be able to
  // read other people's enquiries. /api/messages is already admin-gated, so
  // leaving this at isAuthenticated() would be a hole straight around it.
  if (!req.isAuthenticated()) return res.sendStatus(401);
  const currentUser = req.user as any;
  if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ message: "ID invalide" });
  
  const messages = await storage.getMessages();
  const message = messages.find(m => m.id === id);
  
  if (!message) {
    return res.status(404).json({ message: "Message non trouvé" });
  }
  
  // Tenter de parser selectedItems
  let parsed = null;
  let parseError = null;
  if (message.selectedItems) {
    try {
      parsed = JSON.parse(message.selectedItems);
    } catch (e: any) {
      parseError = e.message;
      // Essayer avec eval
      try {
        parsed = eval(`(${message.selectedItems})`);
      } catch (e2: any) {
        parseError = e2.message;
      }
    }
  }
  
  res.json({
    id: message.id,
    name: message.name,
    email: message.email,
    selectedItemsRaw: message.selectedItems,
    selectedItemsType: typeof message.selectedItems,
    parsed: parsed,
    parseError: parseError,
    status: message.status,
    createdAt: message.createdAt
  });
});
  // ============================================
  //  ROUTE DE DEBUG - Voir le contenu de selectedItems
  // ============================================
  app.get('/api/debug/message/:id', async (req, res) => {
    // Duplicate of the route above; Express always stops at the first match, so
    // this block is unreachable. Kept only so the role guard is not accidentally
    // relaxed if the first registration is ever removed.
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "ID invalide" });
    
    try {
      const messages = await storage.getMessages();
      const message = messages.find(m => m.id === id);
      
      if (!message) {
        return res.status(404).json({ message: "Message non trouvé" });
      }
      
      // Tenter de parser selectedItems
      let parsed = null;
      let parseError = null;
      let parsedType = 'null';
      
      if (message.selectedItems) {
        parsedType = typeof message.selectedItems;
        try {
          parsed = JSON.parse(message.selectedItems);
          dbg('Parse JSON réussi');
        } catch (e: any) {
          parseError = e.message;
          dbg('Erreur JSON:', e.message);
          // Essayer avec eval
          try {
            parsed = eval(`(${message.selectedItems})`);
            dbg('Parse avec eval réussi');
          } catch (e2: any) {
            parseError = e2.message;
            dbg('Erreur eval:', e2.message);
          }
        }
      }
      
      res.json({
        id: message.id,
        name: message.name,
        email: message.email,
        phone: message.phone,
        message: message.message,
        selectedItemsRaw: message.selectedItems,
        selectedItemsType: typeof message.selectedItems,
        parsed: parsed,
        parseError: parseError,
        status: message.status,
        createdAt: message.createdAt,
        read: message.read
      });
    } catch (err) {
      console.error("[MESSAGES] Debug message parse failed:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ============================================
  //  ROUTE DE DEBUG - Voir tout le stock
  // ============================================
  app.get('/api/debug/stock', async (req, res) => {
    // Admin-only: exposes product names and stock levels to any signed-in user.
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    // Capped and ordered rather than dumping the table: this used to return one
    // row per product, which is how a debug endpoint becomes an outage at a few
    // thousand products.
    const page = await storage.queryProducts({ page: 1, limit: 100, search: "", category: "", stock: "all", promo: "all", sort: "stock_asc" });
    res.json(page.items.map(p => ({
      id: p.id,
      name: p.name,
      quantity: p.quantity,
      type: typeof p.quantity
    })));
  });

  // ============================================
  //  ROUTE DE DEBUG - Tous les messages
  // ============================================
  app.get('/api/debug/messages', async (req, res) => {
    // Admin-only: returns every contact message (name + selectedItems) in one
    // response, so an authenticated customer could harvest the whole inbox.
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const currentUser = req.user as any;
    if (!["admin", "superadmin"].includes(currentUser.role)) return res.sendStatus(403);
    const messages = await storage.getMessages();
    res.json(messages.map(m => ({
      id: m.id,
      name: m.name,
      selectedItems: m.selectedItems,
      status: m.status
    })));
  });
  return httpServer;
}