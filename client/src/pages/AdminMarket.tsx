import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BarChart3, Boxes, ClipboardList, FolderPlus, LayoutGrid, LogOut, PackagePlus, ShoppingBag, Trash2, Share2, Eye, Save, Loader2, MapPin, Mail, Phone, StickyNote, CreditCard, Hash, Clock, Truck, ArrowDown, ArrowUp, Pencil, RotateCcw, ImagePlus } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { SocialEmbed, platformIcon } from "@/components/SocialEmbed";
import { SOCIAL_PLATFORMS, computeDeliveryFee, PRODUCT_LOW_STOCK_THRESHOLD, HOMEPAGE_SECTION_TYPES, HOMEPAGE_SECTION_MIN_PRODUCTS, HOMEPAGE_SECTION_MAX_PRODUCTS, HOMEPAGE_SECTION_DEFAULT_PRODUCTS, HOMEPAGE_TILE_IMAGE_MAX_BYTES, HOMEPAGE_TILE_IMAGE_MIME_TYPES, HOMEPAGE_TILE_IMAGE_EXTENSIONS, HOMEPAGE_LOCALES, type HomepageLocale, type HomepageSectionType, type ProductListResponse, type ProductSort, type ProductStockFilter, type SocialMediaEmbed, type SocialPlatform, type DeliverySettings, type FulfillmentMethod } from "@shared/schema";
import { useProducts } from "@/hooks/use-products";
import { PromoPrice, PromotionStatusBadge } from "@/components/PromoPrice";
import {
  PromotionFields,
  promotionValuesFromProduct,
  EMPTY_PROMOTION_FORM,
  type PromotionFormValues,
} from "@/components/PromotionFields";
import { resolvePromotion, validatePromotion } from "@shared/promotions";
import { normalizeHomepageLocale, sectionTitle } from "@shared/homepage";
import { formatDate, formatMoney } from "@/lib/format";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import AdminAnalytics from "@/components/admin/AdminAnalytics";
import logo from "@assets/bb_market_logo.png";

type Category = { id: number; name: string; slug: string; active: boolean };
// Promotion fields are included because the admin list resolves the promo state
// per row. `price` stays `number | string` so a legacy text column cannot break
// rendering; resolvePromotion coerces either.
type Product = { id: number; name: string; description: string; imageUrl: string; category: string; quantity: number | string; price: number | string; promoPrice?: number | string | null; promoStart?: string | number | Date | null; promoEnd?: string | number | Date | null };
type Order = { id: number; customerName: string; email?: string | null; phone: string; address?: string | null; notes?: string | null; itemsJson: string; subtotal: number; total: number; fulfillmentMethod?: FulfillmentMethod | null; deliveryFee?: number | string | null; status: string; paymentMethod: string; createdAt?: string | number | Date | null };

/**
 * The label tables below used to be module-level `Record`s of French strings.
 * They now hold i18n keys instead, resolved through a `t` at render time: a
 * module-level map has no access to the active language, and building one per
 * render would be the only other option. Keeping the keys here means the shape of
 * each table (which enum values exist) is still checkable against the schema.
 */
type LabelKey = [value: string, key: string];

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  // Brand names, deliberately not translated.
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

const PLATFORM_FIELD: Record<SocialPlatform, string> = {
  instagram: "admin.social_field_instagram",
  facebook: "admin.social_field_facebook",
  tiktok: "admin.social_field_tiktok",
};

const PLATFORM_HINT: Record<SocialPlatform, string> = {
  instagram: "admin.social_hint_instagram",
  facebook: "admin.social_hint_facebook",
  tiktok: "admin.social_hint_tiktok",
};

const ADMIN_EMAILS = ["bbmarket26@gmail.com", "omar.hmida.lgl@gmail.com"];
const STATUS_OPTIONS: readonly LabelKey[] = [
  ["pending", "admin.status_pending"],
  ["confirmed", "admin.status_confirmed"],
  ["preparing", "admin.status_preparing"],
  ["ready", "admin.status_ready"],
  ["delivered", "admin.status_delivered"],
  ["cancelled", "admin.status_cancelled"],
];

const PAYMENT_KEYS: Record<string, string> = {
  cash_on_delivery: "admin.payment_cash_on_delivery",
  cash: "admin.payment_cash",
  card: "admin.payment_card",
  bank_transfer: "admin.payment_bank_transfer",
  online: "admin.payment_online",
};

/**
 * One line of an order. Every field is a snapshot taken at checkout time
 * (see POST /api/orders), so an old order keeps showing the product name, the
 * price that was charged and the original picture even after the product has
 * been renamed, re-priced or deleted from the catalogue.
 */
type OrderItem = {
  id: number;
  name: string;
  quantity: number;
  price: number;
  imageUrl: string | null;
};

function parseOrderItems(itemsJson: string | null | undefined): OrderItem[] {
  if (!itemsJson) return [];
  try {
    const parsed: unknown = JSON.parse(itemsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      return [{
        id: Number(item.id ?? 0),
        name: String(item.name ?? i18n.t("admin.product_fallback", "Produit")),
        quantity: Number(item.quantity ?? 0),
        // Older payloads may carry `unitPrice` instead of `price`.
        price: Number(item.price ?? item.unitPrice ?? 0),
        imageUrl: typeof item.imageUrl === "string" && item.imageUrl ? item.imageUrl : null,
      }];
    });
  } catch {
    return [];
  }
}

const formatPrice = (value: number | string | null | undefined) => formatMoney(Number(value ?? 0), i18n.language);

function formatOrderDate(value: string | number | Date | null | undefined, locale: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date
    ? value
    : new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatDate(date, locale, { dateStyle: "medium", timeStyle: "short" });
}

function paymentLabel(method: string | null | undefined, t: TFunction): string {
  if (!method) return "—";
  const key = PAYMENT_KEYS[method];
  // Unknown values fall through, so an unrecognised method stays readable instead
  // of rendering a raw i18n key at the operator.
  return key ? t(key) : method;
}

/** Translated label for an order status, or the raw value if it is not one we know. */
function statusLabel(status: string, t: TFunction): string {
  const entry = STATUS_OPTIONS.find(([value]) => value === status);
  return entry ? t(entry[1]) : status;
}

/**
 * wa.me needs a full international number. B&B Market ships in Tunisia (+216),
 * so local forms (8 digits, or a leading 0) are normalised to +216.
 * Returns null when there is no usable phone number.
 */
function whatsappOrderLink(order: Order): string | null {
  const digits = String(order.phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  let international: string;
  if (digits.startsWith("216")) international = digits;
  else if (digits.startsWith("00")) international = digits.slice(2);
  else if (digits.startsWith("0")) international = `216${digits.slice(1)}`;
  else international = `216${digits}`;
  const message = encodeURIComponent(
    i18n.t("admin.whatsapp_order_message", {
      name: order.customerName || "",
      id: order.id,
      total: formatPrice(order.total),
      defaultValue: "Bonjour {{name}}, au sujet de votre commande B&B Market n°{{id}} ({{total}}).",
    }),
  );
  return `https://wa.me/${international}?text=${message}`;
}

async function jsonFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...options });
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export default function AdminMarket() {
  const { user, isLoading, logoutMutation } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [tab, setTab] = useState<"overview" | "products" | "categories" | "homepage" | "orders" | "delivery" | "social">("overview");
  const [categoryName, setCategoryName] = useState("");
  const [productForm, setProductForm] = useState({ name: "", description: "", category: "", quantity: "0", price: "0" });
  const [promotionForm, setPromotionForm] = useState<PromotionFormValues>(EMPTY_PROMOTION_FORM);
  const [productImage, setProductImage] = useState<File | null>(null);
  const [socialDrafts, setSocialDrafts] = useState<Record<SocialPlatform, string>>({ instagram: "", facebook: "", tiktok: "" });
  const socialDirtyRef = useRef<Set<SocialPlatform>>(new Set());
  const [socialPreview, setSocialPreview] = useState<SocialPlatform | null>(null);
  // Which product's edit form is open, if any. Null keeps at most one open, so
  // two rows never hold conflicting drafts of the same field.
  const [editingProductId, setEditingProductId] = useState<number | null>(null);

  const isAdmin = !!user && (ADMIN_EMAILS.includes(user.email?.toLowerCase?.() || "") || user.role === "admin" || user.role === "superadmin");

  useEffect(() => {
    if (!isLoading && !user) setLocation("/login");
    else if (!isLoading && user && !isAdmin) setLocation("/");
  }, [isLoading, user, isAdmin, setLocation]);

  // The three count-only product queries that used to feed the overview's `Stat`
  // cards are gone. The analytics summary reports the same totals as part of a
  // single aggregate response, and `categories` is still needed here for the product
  // form's category picker. The catalogue tab keeps its own paginated `useProducts`.
  const categories = useQuery<Category[]>({ queryKey: ["/api/categories"], queryFn: () => jsonFetch("/api/categories") });
  const orders = useQuery<Order[]>({ queryKey: ["/api/orders"], queryFn: () => jsonFetch("/api/orders"), enabled: isAdmin });
  const socialMedia = useQuery<SocialMediaEmbed[]>({
    queryKey: ["/api/social-media"],
    queryFn: () => jsonFetch("/api/social-media"),
    enabled: isAdmin,
  });

  // Seed the inputs with saved values, but never clobber a field the admin is editing.
  useEffect(() => {
    if (!socialMedia.data) return;
    setSocialDrafts((current) => {
      const next = { ...current };
      for (const platform of SOCIAL_PLATFORMS) {
        if (socialDirtyRef.current.has(platform)) continue;
        const row = socialMedia.data.find((item) => item.platform === platform);
        next[platform] = row?.url?.trim() || "";
      }
      return next;
    });
  }, [socialMedia.data]);

  const saveSocialLink = useMutation({
    mutationFn: ({ platform, url }: { platform: SocialPlatform; url: string }) =>
      jsonFetch<SocialMediaEmbed>("/api/social-media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, url }),
      }),
    onSuccess: (_data, variables) => {
      socialDirtyRef.current.delete(variables.platform);
      setSocialPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/social-media"] });
      toast({
        title: t(variables.url ? "admin.social_link_saved" : "admin.social_link_removed", { platform: PLATFORM_LABEL[variables.platform] }),
        description: t(
          variables.url ? "admin.social_link_saved_desc" : "admin.social_link_removed_desc",
          variables.url
            ? "Le lien est maintenant affiché sur le site."
            : "Aucun lien ne sera affiché pour cette plateforme.",
        ),
      });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: t("admin.error_title", "Erreur"), description: e.message }),
  });

  const removeSocialLink = useMutation({
    mutationFn: (platform: SocialPlatform) => jsonFetch<void>(`/api/social-media/${platform}`, { method: "DELETE" }),
    onSuccess: (_data, platform) => {
      socialDirtyRef.current.delete(platform);
      queryClient.invalidateQueries({ queryKey: ["/api/social-media"] });
      setSocialDrafts((current) => ({ ...current, [platform]: "" }));
      setSocialPreview(null);
      toast({ title: t("admin.social_link_deleted", { platform: PLATFORM_LABEL[platform] }) });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: t("admin.error_title", "Erreur"), description: e.message }),
  });

  const createCategory = useMutation({
    mutationFn: () => jsonFetch<Category>("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: categoryName }) }),
    onSuccess: () => { setCategoryName(""); queryClient.invalidateQueries({ queryKey: ["/api/categories"] }); toast({ title: t("admin.category_added") }); },
    onError: (e: Error) => toast({ variant: "destructive", title: t("admin.error_title", "Erreur"), description: e.message }),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: number) => jsonFetch<void>(`/api/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/categories"] }),
  });

  const createProduct = useMutation({
    mutationFn: async () => {
      if (!productImage) throw new Error(t("admin.product_image_required", "Ajoutez une image du produit."));
      const fd = new FormData();
      Object.entries(productForm).forEach(([k, v]) => fd.append(k, v));
      // Promotion fields ride along on the same multipart body. Empty strings are
      // sent rather than omitted so "no promotion" is explicit; the route maps
      // "" to NULL and storage stores SQL NULL.
      Object.entries(promotionForm).forEach(([k, v]) => fd.append(k, v));
      fd.append("image", productImage);
      return jsonFetch<Product>("/api/products", { method: "POST", body: fd });
    },
    onSuccess: () => {
      setProductForm({ name: "", description: "", category: "", quantity: "0", price: "0" });
      setPromotionForm(EMPTY_PROMOTION_FORM);
      setProductImage(null);
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: t("admin.product_added", "Produit ajouté") });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: t("admin.product_not_added", "Produit non ajouté"), description: e.message }),
  });

  /**
   * Edit an existing product, including its promotion.
   *
   * The three promotion keys are always sent together, even when the admin only
   * touched the regular price. Sending `promoPrice` alone would leave a stale
   * `promoEnd` on a row whose discount had just been changed, and the server
   * clears all three whenever any one of them is present.
   */
  const updateProduct = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      jsonFetch<Product>(`/api/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setEditingProductId(null);
      toast({ title: t("admin.product_updated", "Produit mis à jour") });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: t("admin.product_update_failed", "Mise à jour impossible"), description: e.message }),
  });

  const deleteProduct = useMutation({
    mutationFn: (id: number) => jsonFetch<void>(`/api/products/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/products"] }),
  });

  const updateStock = useMutation({
    mutationFn: ({ id, quantity }: { id: number; quantity: number }) => jsonFetch<Product>(`/api/products/${id}/stock`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/products"] }),
  });

  const updateOrderStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => jsonFetch<Order>(`/api/orders/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/orders"] }),
  });

  const deliverySettings = useQuery({
    queryKey: ["/api/delivery-settings"],
    queryFn: () => jsonFetch<DeliverySettings>("/api/delivery-settings"),
  });

  const saveDeliverySettings = useMutation({
    mutationFn: (payload: DeliverySettings) => jsonFetch<DeliverySettings>("/api/delivery-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    onSuccess: (saved) => {
      // Keep the form and the public checkout in sync with what was stored.
      queryClient.setQueryData(["/api/delivery-settings"], saved);
      queryClient.invalidateQueries({ queryKey: ["/api/delivery-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: t("admin.delivery_saved") });
    },
    onError: (error: any) => toast({ variant: "destructive", title: t("admin.save_failed", "Échec de l'enregistrement"), description: error?.message || t("admin.retry", "Veuillez réessayer.") }),
  });

  // The overview's counts used to be assembled here from the full product, order and
  // category responses, which meant four extra requests and a revenue figure that
  // summed every order row the browser had been sent. `AdminAnalytics` gets the same
  // numbers - plus a date range - from one server-side aggregate, so this memo is
  // gone rather than kept as a second, slightly different definition of "revenue".

  if (isLoading || !user || !isAdmin) return <div className="min-h-screen grid place-items-center bg-background"><div className="font-bold">{t("admin.loading_dots")}</div></div>;

  const nav = [
    ["overview", t("admin.nav_overview"), BarChart3],
    ["products", t("admin.nav_products"), ShoppingBag],
    ["categories", t("admin.nav_categories"), FolderPlus],
    ["homepage", t("admin.nav_homepage"), LayoutGrid],
    ["orders", t("admin.nav_orders"), ClipboardList],
    ["delivery", t("admin.nav_delivery"), Truck],
    ["social", t("admin.nav_social"), Share2],
  ] as const;

  return (
    <div className="min-h-screen bg-[#f6f8f7] dark:bg-slate-950 text-foreground">
      <div className="grid lg:grid-cols-[250px_1fr] min-h-screen">
        <aside className="bg-[#063f2e] text-white p-5 lg:sticky lg:top-0 lg:h-screen">
          <button onClick={() => setLocation("/")} className="bg-white rounded-2xl p-2 mb-8"><img src={logo} alt="B&B Market" className="h-14 w-auto" /></button>
          <div className="space-y-2">
            {nav.map(([key, label, Icon]) => (
              <button key={key} onClick={() => setTab(key)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-start font-bold transition ${tab === key ? "bg-[#ff6200]" : "hover:bg-white/10"}`}>
                <Icon className="w-5 h-5" /> {label}
              </button>
            ))}
          </div>
          <div className="mt-8 pt-6 border-t border-white/15 text-sm text-white/70 break-all">{user.email}</div>
          <button onClick={() => logoutMutation.mutate(undefined, { onSuccess: () => setLocation("/") })} className="mt-4 flex items-center gap-2 text-sm font-bold hover:text-orange-300"><LogOut className="w-4 h-4" /> {t("admin.logout")}</button>
        </aside>

        <main className="p-4 md:p-8 xl:p-10 max-w-[1500px] w-full mx-auto">
          <div className="mb-8"><div className="text-sm font-bold text-[#ff6200] uppercase tracking-widest">{t("admin.title")}</div><h1 className="text-3xl md:text-4xl font-black">{t("admin.brand")}</h1></div>

          {tab === "overview" && (
            <div className="space-y-8">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">{t("analytics.title")}</h2>
                  <p className="text-sm text-muted-foreground">{t("analytics.subtitle")}</p>
                </div>
                <button type="button" onClick={() => setTab("orders")} className="btn-primary flex items-center gap-2">
                  <ClipboardList className="w-4 h-4" />
                  {t("analytics.open_orders")}
                </button>
              </div>
              <AdminAnalytics />
            </div>
          )}

          {tab === "products" && (
            <div className="space-y-7">
              <Panel title={t("admin.product_add")} icon={<PackagePlus className="w-5 h-5" />}>
                <form onSubmit={(e) => { e.preventDefault(); createProduct.mutate(); }} className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <Input required placeholder={t("admin.product_name_placeholder")} value={productForm.name} onChange={v => setProductForm(p => ({ ...p, name: v }))} />
                  <select required value={productForm.category} onChange={e => setProductForm(p => ({ ...p, category: e.target.value }))} className="field">
                    <option value="">{t("admin.products_choose_category")}</option>{(categories.data || []).filter(c => c.active).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                  <Input required type="number" step="0.001" min="0" placeholder={t("admin.product_price_placeholder")} value={productForm.price} onChange={v => setProductForm(p => ({ ...p, price: v }))} />
                  <Input required type="number" min="0" placeholder={t("admin.product_stock_placeholder")} value={productForm.quantity} onChange={v => setProductForm(p => ({ ...p, quantity: v }))} />
                  <input required type="file" accept="image/*" onChange={e => setProductImage(e.target.files?.[0] || null)} aria-label={t("admin.product_image_aria")} className="field file:me-3 file:border-0 file:rounded-lg file:px-3 file:py-1 file:font-bold" />
                  <textarea required placeholder={t("admin.product_description_placeholder")} value={productForm.description} onChange={e => setProductForm(p => ({ ...p, description: e.target.value }))} className="field md:col-span-2 xl:col-span-3 min-h-24" />
                  {/* Live preview + shared validation, identical to the edit form. */}
                  <PromotionFields
                    regularPrice={productForm.price}
                    values={promotionForm}
                    onChange={setPromotionForm}
                    idPrefix="create"
                  />
                  <button disabled={createProduct.isPending} className="btn-primary md:col-span-2 xl:col-span-1">{createProduct.isPending ? t("admin.product_adding") : t("admin.product_add_btn")}</button>
                </form>
              </Panel>
              <AdminProductsPanel
                categoryOptions={(categories.data || []).filter(c => c.active).map(c => c.name)}
                onDelete={id => deleteProduct.mutate(id)}
                onStock={(id, quantity) => updateStock.mutate({ id, quantity })}
                onEdit={(id, payload) => updateProduct.mutate({ id, payload })}
                editingProductId={editingProductId}
                onStartEdit={setEditingProductId}
                onCancelEdit={() => setEditingProductId(null)}
                saving={updateProduct.isPending}
              />
            </div>
          )}

          {tab === "categories" && (
            <Panel title={t("admin.category_manage")}>
              <form onSubmit={(e) => { e.preventDefault(); if (categoryName.trim()) createCategory.mutate(); }} className="flex flex-col sm:flex-row gap-3 mb-7">
                <input value={categoryName} onChange={e => setCategoryName(e.target.value)} placeholder={t("admin.category_placeholder")} className="field flex-1" />
                <button className="btn-primary" disabled={createCategory.isPending}>{t("admin.category_add")}</button>
              </form>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(categories.data || []).map(category => <div key={category.id} className="flex items-center justify-between p-4 rounded-2xl border bg-background"><div><div className="font-black">{category.name}</div><div className="text-xs text-muted-foreground">/{category.slug}</div></div><button onClick={() => deleteCategory.mutate(category.id)} className="p-2 rounded-xl hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button></div>)}
              </div>
            </Panel>
          )}

          {tab === "homepage" && <HomepageSectionsPanel />}

          {tab === "orders" && <Panel title={t("admin.orders_all")}><OrdersTable orders={orders.data || []} onStatus={(id, status) => updateOrderStatus.mutate({ id, status })} /></Panel>}

          {tab === "delivery" && (
      deliverySettings.data
        ? <DeliverySettingsPanel settings={deliverySettings.data} onSave={(next) => saveDeliverySettings.mutate(next)} saving={saveDeliverySettings.isPending} />
        : <div className="py-10 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
    )}

    {tab === "social" && (
            <div className="space-y-6">
              <Panel title={t("admin.nav_social")} icon={<Share2 className="w-5 h-5" />}>
                <p className="text-sm text-muted-foreground -mt-3 mb-6">
                  {t("admin.social_intro")}
                </p>
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {SOCIAL_PLATFORMS.map((platform) => {
                    const saved = (socialMedia.data || []).find((item) => item.platform === platform)?.url?.trim() || "";
                    const draft = socialDrafts[platform] ?? "";
                    const isDirty = draft !== saved;
                    const isSaving = saveSocialLink.isPending && saveSocialLink.variables?.platform === platform;
                    const isRemoving = removeSocialLink.isPending && removeSocialLink.variables === platform;
                    const previewUrl = socialPreview === platform ? draft.trim() : "";
                    const canPreview = /^https?:\/\//i.test(draft.trim());
                    return (
                      <div key={platform} className="border border-border rounded-2xl p-5 bg-background flex flex-col">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                            {platformIcon(platform, "w-5 h-5")}
                          </div>
                          <div className="min-w-0">
                            <div className="font-black leading-tight">{PLATFORM_LABEL[platform]}</div>
                            <div className={`text-xs font-bold ${saved ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                              {saved ? t("admin.social_link_active") : t("admin.social_no_link")}
                            </div>
                          </div>
                        </div>

                        <label className="text-xs font-bold text-muted-foreground mb-1.5" htmlFor={`social-${platform}`}>
                          {t(PLATFORM_FIELD[platform])}
                        </label>
                        <input
                          id={`social-${platform}`}
                          type="url"
                          inputMode="url"
                          placeholder="https://"
                          value={draft}
                          onChange={(e) => {
                            socialDirtyRef.current.add(platform);
                            setSocialDrafts((current) => ({ ...current, [platform]: e.target.value }));
                          }}
                          className="field !text-sm"
                        />
                        <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">{t(PLATFORM_HINT[platform])}</p>

                        <div className="flex flex-wrap gap-2 mt-4">
                          <button
                            onClick={() => saveSocialLink.mutate({ platform, url: draft.trim() })}
                            disabled={isSaving || !isDirty}
                            className="btn-primary !py-2 !px-4 !text-sm flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {t("admin.social_save")}
                          </button>
                          <button
                            onClick={() => setSocialPreview(socialPreview === platform ? null : platform)}
                            disabled={!canPreview}
                            title={canPreview ? t("admin.social_preview_hover") : t("admin.social_preview_need_url")}
                            className="px-4 py-2 rounded-xl border border-border text-sm font-bold hover:border-[#ff6200]/50 hover:text-[#ff6200] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            <Eye className="w-4 h-4" /> {t("admin.social_preview_btn")}
                          </button>
                          <button
                            onClick={() => removeSocialLink.mutate(platform)}
                            disabled={isRemoving || !saved}
                            title={saved ? t("admin.social_delete_hover") : t("admin.social_delete_none")}
                            className="p-2 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label={t("admin.social_delete_aria", { platform: PLATFORM_LABEL[platform] })}
                          >
                            {isRemoving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </button>
                        </div>

                        {previewUrl ? (
                          <div className="mt-4 pt-4 border-t border-border">
                            <div className="text-xs font-bold text-muted-foreground mb-2">{t("admin.social_preview_label")}</div>
                            <div className="rounded-xl border border-dashed border-border bg-card/50 p-3 flex justify-center max-h-[340px] overflow-hidden">
                              <SocialEmbed key={previewUrl} platform={platform} url={previewUrl} />
                            </div>
                            <a
                              href={previewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-block text-[11px] text-muted-foreground hover:text-[#ff6200] underline break-all"
                            >
                              {t("admin.social_open_new")}
                            </a>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </div>
          )}
        </main>
      </div>
      <style>{`.field{width:100%;border:1px solid hsl(var(--border));background:hsl(var(--background));border-radius:14px;padding:12px 14px;outline:none}.field:focus{box-shadow:0 0 0 3px rgb(255 98 0 / .15);border-color:#ff6200}.btn-primary{background:#ff6200;color:white;border-radius:14px;padding:12px 18px;font-weight:900}.btn-primary:disabled{opacity:.55}`}</style>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return <section className="bg-white dark:bg-slate-900 border border-border rounded-3xl p-5 md:p-7 shadow-sm"><div className="flex items-center gap-2 mb-6">{icon}<h2 className="text-xl font-black">{title}</h2></div>{children}</section>;
}
function Input({ value, onChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onChange: (value: string) => void }) { return <input {...props} value={value} onChange={e => onChange(e.target.value)} className="field" />; }

/**
 * One row of the admin catalogue.
 *
 * The stock input is local state keyed on the product id so it resets when
 * paging to a different product set, and it is not remounted per keystroke.
 */
function AdminProductRow({ product, onDelete, onStock, onEdit, editing, onStartEdit, onCancelEdit, saving }: {
  product: Product;
  onDelete: () => void;
  onStock: (q: number) => void;
  onEdit: (payload: Record<string, unknown>) => void;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [stock, setStock] = useState(String(product.quantity ?? 0));
  const current = Number(product.quantity ?? 0);

  // Edit draft. Seeded from the row, so opening the form always shows what is
  // actually stored rather than a stale previous edit of the same product.
  const [draft, setDraft] = useState({
    name: product.name,
    price: String(product.price ?? 0),
    quantity: String(product.quantity ?? 0),
    category: product.category,
  });
  const [promo, setPromo] = useState<PromotionFormValues>(() => promotionValuesFromProduct(product));

  // `product` is a fresh object after every query invalidation; when the row is
  // not being edited, keep the draft in step with the server.
  useEffect(() => {
    if (editing) return;
    setDraft({ name: product.name, price: String(product.price ?? 0), quantity: String(product.quantity ?? 0), category: product.category });
    setPromo(promotionValuesFromProduct(product));
  }, [product, editing]);

  const promotion = resolvePromotion(product);
  const promoErrors = validatePromotion({ price: draft.price, ...promo });

  const save = () => {
    if (promoErrors.length) return;
    onEdit({
      name: draft.name,
      price: draft.price,
      quantity: Number(draft.quantity) || 0,
      category: draft.category,
      // Always all three: the server clears a stale bound when a promo changes.
      promoPrice: promo.promoPrice === "" ? null : Number(promo.promoPrice),
      promoStart: promo.promoStart ? new Date(promo.promoStart).toISOString() : null,
      promoEnd: promo.promoEnd ? new Date(promo.promoEnd).toISOString() : null,
    });
  };

  return <div className="border rounded-2xl p-4 bg-background">
    <div className="flex gap-4"><img src={product.imageUrl} alt={product.name} className="w-20 h-20 rounded-xl object-cover bg-muted" /><div className="min-w-0 flex-1"><div className="font-black truncate">{product.name}</div><div className="text-xs text-muted-foreground">{product.category}</div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {/* Same price renderer the storefront uses, so the admin cannot see a
              different number from a customer. */}
          <PromoPrice product={product} size="sm" showBadge={false} />
          <PromotionStatusBadge status={promotion.status} />
          {promotion.status !== "active" && promotion.status !== "none" && (
            <span className="text-xs font-bold text-muted-foreground line-through">
              {formatPrice(product.promoPrice)}
            </span>
          )}
        </div>
      </div>
      {current <= 0
        ? <span className="self-start px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-100 text-red-700">{t("admin.products_stock_out")}</span>
        : current <= PRODUCT_LOW_STOCK_THRESHOLD
          ? <span className="self-start px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800">{t("admin.products_stock_low")}</span>
          : <span className="self-start px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700">{t("admin.product_in_stock", { count: current })}</span>}
    </div>

    {editing ? (
      <div className="mt-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{t("admin.name")}</label>
            <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} className="field mt-1" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{t("admin.price_with_unit", "Prix normal (DT)")}</label>
            <input type="number" step="0.001" min="0" value={draft.price} onChange={e => setDraft(d => ({ ...d, price: e.target.value }))} className="field mt-1" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{t("admin.products_stock")}</label>
            <input type="number" min="0" value={draft.quantity} onChange={e => setDraft(d => ({ ...d, quantity: e.target.value }))} className="field mt-1" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{t("admin.products_category")}</label>
            <input value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} className="field mt-1" />
          </div>
        </div>
        <PromotionFields regularPrice={draft.price} values={promo} onChange={setPromo} idPrefix={`edit-${product.id}`} />
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onCancelEdit} className="px-4 py-2 rounded-xl border border-border text-sm font-bold">{t("admin.cancel")}</button>
          <button onClick={save} disabled={saving || promoErrors.length > 0} className="btn-primary disabled:opacity-50">
            {saving ? t("admin.saving") : t("admin.save")}
          </button>
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-2 mt-4">
        <input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} className="field !py-2"/>
        <button onClick={() => onStock(Math.max(0, Number(stock) || 0))} className="px-3 py-2 rounded-xl bg-[#063f2e] text-white text-sm font-bold">{t("admin.products_stock")}</button>
        <button onClick={onStartEdit} className="px-3 py-2 rounded-xl bg-primary/10 text-primary text-sm font-bold">{t("admin.edit")}</button>
        <button onClick={onDelete} className="p-2.5 rounded-xl bg-red-50 text-red-600"><Trash2 className="w-4 h-4" /></button>
      </div>
    )}
  </div>;
}

const ADMIN_PAGE_SIZES = [25, 50, 100] as const;

const ADMIN_SORT_KEYS: Record<ProductSort, string> = {
  newest: "admin.sort_newest",
  name_asc: "admin.sort_name_asc",
  price_asc: "admin.sort_price_asc",
  price_desc: "admin.sort_price_desc",
  stock_asc: "admin.sort_stock_asc",
  stock_desc: "admin.sort_stock_desc",
};

const ADMIN_STOCK_KEYS: Record<ProductStockFilter, string> = {
  all: "admin.stock_all",
  in: "admin.stock_in",
  low: "admin.products_stock_low",
  out: "admin.products_stock_out",
};

const ADMIN_SORTS: ProductSort[] = ["newest", "name_asc", "price_asc", "price_desc", "stock_asc", "stock_desc"];

/** Stable empty result so a failed or in-flight query never renders `undefined`. */
const EMPTY_PRODUCT_LIST: ProductListResponse = { items: [], page: 1, limit: 25, total: 0, totalPages: 0 };

/**
 * Admin catalogue.
 *
 * The page, search, category, stock filter, sort and page size are all sent to
 * the server; this component renders at most `limit` rows. It previously fetched
 * every product and rendered them all, which is what makes an admin panel
 * unusable past a few hundred rows.
 */
function AdminProductsPanel({ categoryOptions, onDelete, onStock, onEdit, editingProductId, onStartEdit, onCancelEdit, saving }: {
  categoryOptions: string[];
  onDelete: (id: number) => void;
  onStock: (id: number, quantity: number) => void;
  onEdit: (id: number, payload: Record<string, unknown>) => void;
  editingProductId: number | null;
  onStartEdit: (id: number) => void;
  onCancelEdit: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<number>(25);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [stock, setStock] = useState<ProductStockFilter>("all");
  const [sort, setSort] = useState<ProductSort>("newest");

  // The query lives here, next to the controls that shape it. The page never
  // holds more than `limit` products, so the panel cost is independent of
  // catalogue size.
  const { data, isFetching } = useProducts({ page, limit, search, category, stock, sort });
  const result = data ?? EMPTY_PRODUCT_LIST;

  // Debounce the search box so typing does not fire a query per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Any change to the result set invalidates the current page number.
  useEffect(() => { setPage(1); }, [search, category, stock, sort, limit]);

  const total = result.total;
  const totalPages = result.totalPages;

  // Deleting the last row of the final page leaves us past the end. Clamp back
  // into range so the panel does not sit on an empty page.
  useEffect(() => {
    if (totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [totalPages, page]);
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return <Panel title={t("admin.nav_products")}>
    <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-3 mb-5">
      <div className="md:col-span-2 xl:col-span-1"><label className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{t("admin.products_search")}</label>
        <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder={t("admin.product_name_placeholder")} className="field mt-1" />
      </div>
      <div><label className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{t("admin.products_category")}</label>
        <select value={category} onChange={e => setCategory(e.target.value)} className="field mt-1">
          <option value="">{t("admin.products_all")}</option>
          {(categoryOptions || []).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div><label className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{t("admin.products_stock")}</label>
        <select value={stock} onChange={e => setStock(e.target.value as ProductStockFilter)} className="field mt-1">
          {(Object.entries(ADMIN_STOCK_KEYS) as [ProductStockFilter, string][]).map(([v, key]) => <option key={v} value={v}>{t(key)}</option>)}
        </select>
      </div>
      <div><label className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{t("admin.products_sort")}</label>
        <select value={sort} onChange={e => setSort(e.target.value as ProductSort)} className="field mt-1">
          {ADMIN_SORTS.map(v => <option key={v} value={v}>{t(ADMIN_SORT_KEYS[v])}</option>)}
        </select>
      </div>
      <div><label className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{t("admin.products_per_page")}</label>
        <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="field mt-1">
          {ADMIN_PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 mb-5 text-sm text-muted-foreground">
      <span>{total === 0 ? t("admin.products_none") : t("admin.products_range", { from, to, total })}</span>
      {isFetching && <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"><Loader2 className="w-3.5 h-3.5 animate-spin" />{t("admin.loading")}</span>}
    </div>

    {result.items.length === 0 ? (
      <p className="text-sm text-muted-foreground py-10 text-center">{t("admin.products_no_match")}</p>
    ) : (
      <div className={`grid md:grid-cols-2 xl:grid-cols-3 gap-4 transition-opacity ${isFetching ? "opacity-60" : ""}`}>
        {result.items.map(product => (
          <AdminProductRow
            key={product.id}
            product={product}
            onDelete={() => onDelete(product.id)}
            onStock={q => onStock(product.id, q)}
            onEdit={payload => onEdit(product.id, payload)}
            editing={editingProductId === product.id}
            onStartEdit={() => onStartEdit(product.id)}
            onCancelEdit={onCancelEdit}
            saving={saving}
          />
        ))}
      </div>
    )}

    {totalPages > 1 && <div className="flex flex-wrap items-center justify-center gap-2 mt-8">
      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-2 rounded-xl border border-border text-sm font-bold disabled:opacity-40">{t("admin.products_prev")}</button>
      <span className="px-3 py-2 text-sm font-bold">{t("admin.pagination", { page, total: totalPages })}</span>
      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-2 rounded-xl border border-border text-sm font-bold disabled:opacity-40">{t("admin.products_next")}</button>
    </div>}
  </Panel>;
}


const FULFILLMENT_KEY: Record<FulfillmentMethod, string> = {
  delivery: "admin.delivery_home",
  pickup: "admin.delivery_pickup",
};

/** Legacy orders predate the fulfillment column, so fall back gracefully. */
function orderFulfillment(order: Order): FulfillmentMethod {
  return order.fulfillmentMethod === "pickup" ? "pickup" : "delivery";
}
function orderFee(order: Order): number {
  const fee = Number(order.deliveryFee ?? 0) || 0;
  if (Number.isFinite(fee) && fee > 0) return fee;
  // Orders created before the fee column existed have none stored.
  return Math.max(0, Number(order.total || 0) - Number(order.subtotal || 0));
}

function OrderThumb({ item, size = 48 }: { item: OrderItem; size?: number }) {
  const box = { width: size, height: size };
  if (item.imageUrl) {
    return <img src={item.imageUrl} alt={item.name} title={item.name} loading="lazy" style={box} className="rounded-xl object-cover bg-muted border border-border shrink-0" />;
  }
  return <div style={box} aria-hidden className="rounded-xl bg-muted border border-border shrink-0 flex items-center justify-center"><PackagePlus className="w-5 h-5 text-muted-foreground opacity-60" /></div>;
}

function OrderLineItem({ item }: { item: OrderItem }) {
  const { t } = useTranslation();
  return <div className="flex items-center gap-3">
    <OrderThumb item={item} />
    <div className="min-w-0 flex-1">
      <div className="font-bold text-sm leading-tight">{item.quantity} × {item.name}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{t("admin.price_per_unit", "{{price}} / unité", { price: formatPrice(item.price) })}</div>
    </div>
    <div className="text-end font-black whitespace-nowrap">{formatPrice(item.price * item.quantity)}</div>
  </div>;
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return <div className="flex items-start gap-3 py-2">
    <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">{label}</div>
      <div className="text-sm break-words">{value || "—"}</div>
    </div>
  </div>;
}

function OrderDetailsDialog({ order, onClose, onStatus }: { order: Order | null; onClose: () => void; onStatus: (id: number, status: string) => void }) {
  const { t, i18n } = useTranslation();
  const items = parseOrderItems(order?.itemsJson);
  const subtotal = Number(order?.subtotal ?? 0);
  const total = Number(order?.total ?? 0);
  // Pre-delivery-settings orders have no stored fee; derive it from the totals.
  const deliveryFee = order ? orderFee(order) : 0;
  const fulfillment = order ? orderFulfillment(order) : "delivery";
  const whatsapp = order ? whatsappOrderLink(order) : null;

  return <Dialog open={!!order} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      {order && <>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Hash className="w-5 h-5" />{t("admin.order_no", { id: order.id })}</DialogTitle>
          <DialogDescription>{t("admin.order_customer_hint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-x-6 divide-y sm:divide-y-0">
            <DetailRow icon={<Clock className="w-4 h-4" />} label={t("admin.order_date")} value={formatOrderDate(order.createdAt, i18n.language)} />
            <DetailRow icon={<Truck className="w-4 h-4" />} label={t("admin.status_current")} value={<span className="font-bold">{statusLabel(order.status, t)}</span>} />
            <DetailRow icon={<Hash className="w-4 h-4" />} label={t("admin.orders_customer")} value={order.customerName} />
            <DetailRow icon={<Phone className="w-4 h-4" />} label={t("admin.order_phone")} value={order.phone} />
            <DetailRow icon={<Mail className="w-4 h-4" />} label={t("admin.order_email")} value={order.email} />
            <DetailRow icon={<MapPin className="w-4 h-4" />} label={fulfillment === "pickup" ? t("admin.order_address_pickup") : t("admin.order_address_delivery")} value={order.address} />
            <DetailRow icon={<StickyNote className="w-4 h-4" />} label={t("admin.order_notes")} value={order.notes} />
            <DetailRow icon={<CreditCard className="w-4 h-4" />} label={t("admin.order_payment_method")} value={paymentLabel(order.paymentMethod, t)} />
            <DetailRow icon={<Truck className="w-4 h-4" />} label={t("admin.order_pickup_method")} value={t(FULFILLMENT_KEY[fulfillment])} />
          </div>

          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-muted-foreground mb-3">{t("admin.order_no_items", { count: items.length })}</h3>
            {items.length === 0
              ? <p className="text-sm text-muted-foreground">{t("admin.order_no_items_empty")}</p>
              : <div className="space-y-3">{items.map((item, index) => <OrderLineItem key={`${item.id}-${index}`} item={item} />)}</div>}
          </div>

          <div className="border-t pt-4 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">{t("admin.orders_subtotal")}</span><span className="font-bold">{formatPrice(subtotal)}</span></div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("admin.orders_delivery_fee")}</span>
              <span className="font-bold">{fulfillment === "pickup" ? formatPrice(0) : formatPrice(deliveryFee)}</span>
            </div>
            <div className="flex justify-between text-base"><span className="font-black">{t("admin.orders_total")}</span><span className="font-black text-[#ff6200]">{formatPrice(total)}</span></div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="flex-1">
              <label className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground" htmlFor={`order-status-${order.id}`}>{t("admin.orders_change_status")}</label>
              <select id={`order-status-${order.id}`} value={order.status} onChange={e => onStatus(order.id, e.target.value)} className="field mt-1">
                {STATUS_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
              </select>
            </div>
            {whatsapp && <a href={whatsapp} target="_blank" rel="noreferrer noopener" className="btn-primary inline-flex items-center justify-center gap-2 whitespace-nowrap">
              <FaWhatsapp className="w-5 h-5" />{t("admin.order_whatsapp")}
            </a>}
          </div>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}

function Toggle({ checked, onChange, label, hint, icon }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; icon: React.ReactNode }) {
  return <div className="flex items-center gap-4 p-4 rounded-2xl border border-border bg-background">
    <span className="text-muted-foreground">{icon}</span>
    <div className="flex-1 min-w-0">
      <div className="font-bold">{label}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
    </div>
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={`relative w-14 h-8 rounded-full transition-colors shrink-0 ${checked ? "bg-[#ff6200]" : "bg-slate-300 dark:bg-slate-700"}`}>
      <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${checked ? "left-7" : "left-1"}`} />
    </button>
  </div>;
}

/** A homepage section as the admin API returns it. */
type HomepageSectionRow = {
  id: number;
  titleFr: string;
  titleEn: string | null;
  titleAr: string | null;
  type: HomepageSectionType;
  category: string | null;
  maxPrice: number | null;
  maxProducts: number;
  displayOrder: number;
  enabled: boolean;
  tileImageUrl: string | null;
  tileTitleFr: string | null;
  tileTitleEn: string | null;
  tileTitleAr: string | null;
  tileSubtitleFr: string | null;
  tileSubtitleEn: string | null;
  tileSubtitleAr: string | null;
  tileCtaLabelFr: string | null;
  tileCtaLabelEn: string | null;
  tileCtaLabelAr: string | null;
  tileHref: string | null;
  /** Products the public homepage shows for this shelf right now. */
  visibleProductCount?: number;
  /** Products the shelf would hold if no shelf above it had taken them. */
  matchingProductCount?: number;
};

/**
 * Every numeric field is a string in the form.
 *
 * Same reason as the delivery settings panel: a controlled number input reports
 * `""` for a cleared box, and keeping that as a string means the admin can clear
 * a value without the component having to guess what "empty" means for each one.
 * The draft is converted to the API's shape (numbers, real nulls) in one place -
 * `toSectionPayload` - so no field is coerced twice.
 */
type HomepageSectionDraft = {
  titleFr: string;
  titleEn: string;
  titleAr: string;
  type: HomepageSectionType;
  category: string;
  maxPrice: string;
  maxProducts: string;
  displayOrder: string;
  tileImageUrl: string;
  tileTitleFr: string;
  tileTitleEn: string;
  tileTitleAr: string;
  tileSubtitleFr: string;
  tileSubtitleEn: string;
  tileSubtitleAr: string;
  tileCtaLabelFr: string;
  tileCtaLabelEn: string;
  tileCtaLabelAr: string;
  tileHref: string;
};

const EMPTY_SECTION_DRAFT: HomepageSectionDraft = {
  titleFr: "",
  titleEn: "",
  titleAr: "",
  type: "newest",
  category: "",
  maxPrice: "",
  maxProducts: String(HOMEPAGE_SECTION_DEFAULT_PRODUCTS),
  displayOrder: "",
  tileImageUrl: "",
  tileTitleFr: "",
  tileTitleEn: "",
  tileTitleAr: "",
  tileSubtitleFr: "",
  tileSubtitleEn: "",
  tileSubtitleAr: "",
  tileCtaLabelFr: "",
  tileCtaLabelEn: "",
  tileCtaLabelAr: "",
  tileHref: "",
};

/**
 * Which field each shelf type actually needs.
 *
 * `category` and `price_under` are the only two that take an extra input, so the
 * form hides the rest rather than showing a category picker on a "newest" shelf
 * and inviting the admin to fill in a field that is then ignored. The server
 * rejects a mismatched pair regardless; hiding it just means the mistake is harder
 * to make.
 */
const HOMEPAGE_TYPE_LABEL_KEYS: Record<HomepageSectionType, string> = {
  newest: "admin.homepage_type_newest",
  best_sellers: "admin.homepage_type_best_sellers",
  low_stock: "admin.homepage_type_low_stock",
  promotions: "admin.homepage_type_promotions",
  category: "admin.homepage_type_category",
  price_under: "admin.homepage_type_price_under",
};

/**
 * The language tabs, and which draft field each one edits.
 *
 * A lookup table rather than an if/else per language means a fourth locale would
 * need one row here and one set of columns, not a new block of JSX. The tab
 * labels are endonyms ("Français", "English", "العربية") in every locale so an
 * admin who lands in the wrong language can still recognise their own.
 */
const HOMEPAGE_LANG_TAB_KEYS: Record<HomepageLocale, string> = {
  fr: "admin.homepage_lang_fr",
  en: "admin.homepage_lang_en",
  ar: "admin.homepage_lang_ar",
};

const HOMEPAGE_TITLE_FIELDS: Record<HomepageLocale, keyof HomepageSectionDraft> = {
  fr: "titleFr",
  en: "titleEn",
  ar: "titleAr",
};

const HOMEPAGE_TILE_TITLE_FIELDS: Record<HomepageLocale, keyof HomepageSectionDraft> = {
  fr: "tileTitleFr",
  en: "tileTitleEn",
  ar: "tileTitleAr",
};

const HOMEPAGE_TILE_SUBTITLE_FIELDS: Record<HomepageLocale, keyof HomepageSectionDraft> = {
  fr: "tileSubtitleFr",
  en: "tileSubtitleEn",
  ar: "tileSubtitleAr",
};

const HOMEPAGE_TILE_CTA_FIELDS: Record<HomepageLocale, keyof HomepageSectionDraft> = {
  fr: "tileCtaLabelFr",
  en: "tileCtaLabelEn",
  ar: "tileCtaLabelAr",
};

function toSectionDraft(section: HomepageSectionRow): HomepageSectionDraft {
  return {
    titleFr: section.titleFr,
    titleEn: section.titleEn ?? "",
    titleAr: section.titleAr ?? "",
    type: section.type,
    category: section.category ?? "",
    maxPrice: section.maxPrice === null || section.maxPrice === undefined ? "" : String(section.maxPrice),
    maxProducts: String(section.maxProducts),
    displayOrder: String(section.displayOrder),
    tileImageUrl: section.tileImageUrl ?? "",
    tileTitleFr: section.tileTitleFr ?? "",
    tileTitleEn: section.tileTitleEn ?? "",
    tileTitleAr: section.tileTitleAr ?? "",
    tileSubtitleFr: section.tileSubtitleFr ?? "",
    tileSubtitleEn: section.tileSubtitleEn ?? "",
    tileSubtitleAr: section.tileSubtitleAr ?? "",
    tileCtaLabelFr: section.tileCtaLabelFr ?? "",
    tileCtaLabelEn: section.tileCtaLabelEn ?? "",
    tileCtaLabelAr: section.tileCtaLabelAr ?? "",
    tileHref: section.tileHref ?? "",
  };
}

/**
 * Draft -> API payload.
 *
 * Empty strings become `null` rather than being omitted, and the two numbers that
 * are genuinely optional become `undefined`. That distinction matters: a shelf
 * switched to `price_under` and left without a ceiling is rejected by the server,
 * but one switched back to `newest` still keeps its old ceiling stored, harmless
 * because the type no longer reads it.
 */
function toSectionPayload(draft: HomepageSectionDraft) {
  const text = (value: string) => value.trim() || null;
  const number = (value: string) => (value.trim() === "" ? undefined : Number(value));
  return {
    // Only French is required; every other language is allowed to be empty and
    // is stored as NULL, which the reader treats as "fall back to French".
    titleFr: draft.titleFr.trim(),
    titleEn: text(draft.titleEn),
    titleAr: text(draft.titleAr),
    type: draft.type,
    category: text(draft.category),
    maxPrice: number(draft.maxPrice) ?? null,
    maxProducts: Number(draft.maxProducts) || HOMEPAGE_SECTION_DEFAULT_PRODUCTS,
    displayOrder: number(draft.displayOrder) ?? 0,
    tileImageUrl: text(draft.tileImageUrl),
    tileTitleFr: text(draft.tileTitleFr),
    tileTitleEn: text(draft.tileTitleEn),
    tileTitleAr: text(draft.tileTitleAr),
    tileSubtitleFr: text(draft.tileSubtitleFr),
    tileSubtitleEn: text(draft.tileSubtitleEn),
    tileSubtitleAr: text(draft.tileSubtitleAr),
    tileCtaLabelFr: text(draft.tileCtaLabelFr),
    tileCtaLabelEn: text(draft.tileCtaLabelEn),
    tileCtaLabelAr: text(draft.tileCtaLabelAr),
    tileHref: text(draft.tileHref),
  };
}

/**
 * Pull the readable message out of an API error.
 *
 * `jsonFetch` rejects with the raw response text, and every route here answers
 * with `{ message }`, so the rejection is a JSON string rather than a sentence.
 * Showing it verbatim would put `{"message":"Prix maximum requis..."}` in a toast.
 */
function sectionErrorMessage(error: unknown, t: TFunction): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.message === "string") {
      const message: string = parsed.message;
      // The server validates in the reader's language it cannot know, so it
      // returns `admin.homepage_error_*` keys. Real driver/proxy messages are
      // passed through untouched.
      return message.startsWith("admin.") ? t(message) : message;
    }
  } catch {
    // Not JSON - a plain-text error (a 500 from a proxy, say) is already readable.
  }
  return raw || t("admin.homepage_error_generic");
}

/**
 * The shelf tile image: pick a file, see it, replace it or remove it.
 *
 * The file is uploaded as soon as it is chosen and only the returned URL is kept
 * in the draft, so the section itself is still saved as plain JSON through the
 * same create/update routes as before. `value` may equally be a URL typed in
 * before uploads existed; it is previewed and kept the same way.
 *
 * The type and size checks here only spare the admin a wasted upload. The server
 * repeats them and is the one that decides.
 */
function TileImageField({
  value,
  onChange,
  onUploadingChange,
}: {
  value: string;
  onChange: (url: string) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  // The picked file, shown from memory while it uploads so the preview is instant.
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [value, localPreview]);
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  const fail = (description: string) =>
    toast({ variant: "destructive", title: t("admin.homepage_error_image_upload"), description });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (
      !(HOMEPAGE_TILE_IMAGE_MIME_TYPES as readonly string[]).includes(file.type) ||
      !(HOMEPAGE_TILE_IMAGE_EXTENSIONS as readonly string[]).includes(extension)
    ) {
      return fail(t("admin.homepage_error_image_type"));
    }
    if (file.size > HOMEPAGE_TILE_IMAGE_MAX_BYTES) return fail(t("admin.homepage_error_image_too_large"));

    setLocalPreview(URL.createObjectURL(file));
    setUploading(true);
    onUploadingChange(true);
    try {
      const body = new FormData();
      body.append("image", file);
      const { url } = await jsonFetch<{ url: string }>("/api/homepage-sections/tile-image", { method: "POST", body });
      onChange(url);
    } catch (error) {
      toast({ variant: "destructive", title: t("admin.homepage_error_image_upload"), description: sectionErrorMessage(error, t) });
    } finally {
      // On failure this falls back to whatever image the section had before.
      setLocalPreview(null);
      setUploading(false);
      onUploadingChange(false);
    }
  };

  const preview = localPreview ?? value.trim();
  const choose = () => inputRef.current?.click();

  return (
    <div>
      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("admin.homepage_tile_image")}</span>
      <input
        ref={inputRef}
        type="file"
        accept={HOMEPAGE_TILE_IMAGE_MIME_TYPES.join(",")}
        className="hidden"
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          // Cleared so picking the same file again still fires a change.
          event.target.value = "";
        }}
      />

      {preview ? (
        <div className="mt-1 flex flex-wrap items-center gap-4">
          <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-secondary">
            {broken ? (
              <div className="flex h-full w-full items-center justify-center p-2 text-center text-[11px] text-muted-foreground">
                {t("admin.homepage_tile_image_broken")}
              </div>
            ) : (
              <img src={preview} alt={t("admin.homepage_tile_image_preview")} className="h-full w-full object-cover" onError={() => setBroken(true)} />
            )}
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <button type="button" onClick={choose} disabled={uploading} className="px-3 py-2 rounded-xl border border-border hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50">
              {t("admin.homepage_tile_image_replace")}
            </button>
            <button type="button" onClick={() => onChange("")} disabled={uploading} className="px-3 py-2 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50">
              {t("admin.homepage_tile_image_remove")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={choose} className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm font-bold hover:bg-black/5 dark:hover:bg-white/10">
          <ImagePlus className="w-4 h-4" /> {t("admin.homepage_tile_image_choose")}
        </button>
      )}
      <p className="text-xs text-muted-foreground mt-2">
        {t("admin.homepage_tile_image_formats", { size: HOMEPAGE_TILE_IMAGE_MAX_BYTES / (1024 * 1024) })}
      </p>
    </div>
  );
}

function HomepageSectionsPanel() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [draft, setDraft] = useState<HomepageSectionDraft>(EMPTY_SECTION_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  // The shelf awaiting delete confirmation, or null when the dialog is closed.
  const [pendingDelete, setPendingDelete] = useState<HomepageSectionRow | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  // Open the form on the language the admin is actually using, so the obvious
  // thing to edit is the one on screen.
  const [activeLang, setActiveLang] = useState<HomepageLocale>(() => normalizeHomepageLocale(i18n.language));

  const sections = useQuery<HomepageSectionRow[]>({
    queryKey: ["/api/admin/homepage-sections"],
    queryFn: () => jsonFetch("/api/admin/homepage-sections"),
  });

  // The same category list the product form offers, so a category shelf is
  // matched against a name products can actually carry. A value already stored
  // on the shelf being edited is kept as an option even if that category has
  // since been removed, so opening the form never silently changes it.
  const categories = useQuery<Category[]>({ queryKey: ["/api/categories"], queryFn: () => jsonFetch("/api/categories") });
  const activeCategoryNames = (categories.data || []).filter((category) => category.active).map((category) => category.name);
  const categoryOptions =
    draft.category && !activeCategoryNames.includes(draft.category) ? [draft.category, ...activeCategoryNames] : activeCategoryNames;

  /**
   * Both caches, not just this one.
   *
   * The admin list and the homepage read *different* endpoints (one carries the
   * products, one does not), so their query keys are unrelated strings and a
   * prefix invalidation only refreshes the key it was given. Saving a shelf has to
   * invalidate both, or the change appears to save and then not appear on the
   * site.
   */
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/homepage-sections"] });
    queryClient.invalidateQueries({ queryKey: ["/api/homepage-sections"] });
  };

  /**
   * Say what actually happened to the shelf, not just that the row was written.
   *
   * A shelf with no products is hidden from the homepage on purpose, so "saved"
   * alone would leave the admin looking for a section that is not going to
   * appear. The refreshed admin list carries the count the homepage really shows,
   * so the toast is decided from that rather than guessed.
   */
  const announceSaved = async (id: number, savedTitle: string) => {
    queryClient.invalidateQueries({ queryKey: ["/api/homepage-sections"] });
    let row: HomepageSectionRow | undefined;
    try {
      const list = await queryClient.fetchQuery<HomepageSectionRow[]>({
        queryKey: ["/api/admin/homepage-sections"],
        queryFn: () => jsonFetch("/api/admin/homepage-sections"),
        staleTime: 0,
      });
      row = list.find((item) => item.id === id);
    } catch {
      // The save itself succeeded; fall through to the plain confirmation.
    }
    if (row && !row.enabled) {
      toast({ title: savedTitle, description: t("admin.homepage_saved_disabled") });
    } else if (row && row.visibleProductCount === 0) {
      toast({
        title: row.matchingProductCount ? t("admin.homepage_saved_duplicates") : t("admin.homepage_saved_no_match"),
        description: t("admin.homepage_saved_hidden_hint"),
      });
    } else {
      toast({ title: savedTitle });
    }
  };

  const createSection = useMutation({
    mutationFn: (payload: ReturnType<typeof toSectionPayload>) =>
      jsonFetch<HomepageSectionRow>("/api/homepage-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: async (saved) => {
      setDraft(EMPTY_SECTION_DRAFT);
      await announceSaved(saved.id, t("admin.homepage_created"));
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: t("admin.homepage_save_failed"), description: sectionErrorMessage(error, t) }),
  });

  const updateSection = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ReturnType<typeof toSectionPayload> }) =>
      jsonFetch<HomepageSectionRow>(`/api/homepage-sections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: async (saved) => {
      setEditingId(null);
      await announceSaved(saved.id, t("admin.homepage_updated"));
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: t("admin.homepage_save_failed"), description: sectionErrorMessage(error, t) }),
  });

  const deleteSection = useMutation({
    mutationFn: (id: number) => jsonFetch<void>(`/api/homepage-sections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast({ title: t("admin.homepage_deleted") });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: t("admin.homepage_save_failed"), description: sectionErrorMessage(error, t) }),
  });

  /**
   * Enabled/disabled is a PATCH of one field rather than its own endpoint.
   *
   * It is the same update an edit makes, so a shelf cannot end up in a state the
   * PATCH route would reject: toggling goes through the identical merged-row
   * validation as the form.
   */
  const toggleSection = useMutation({
    mutationFn: ({ section, enabled }: { section: HomepageSectionRow; enabled: boolean }) =>
      jsonFetch<HomepageSectionRow>(`/api/homepage-sections/${section.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => invalidate(),
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: t("admin.homepage_save_failed"), description: sectionErrorMessage(error, t) }),
  });

  /**
   * Move a shelf one position and persist the whole order.
   *
   * Sending the full id list rather than a single "new position" number means the
   * server is the only thing that decides what display orders mean, and two admins
   * reordering at once cannot interleave two half-applied orders. Positions are
   * written as multiples of 10 server-side, so an insert later only shifts one row.
   */
  const moveSection = useMutation({
    mutationFn: ({ orderedIds }: { orderedIds: number[] }) =>
      jsonFetch<HomepageSectionRow[]>("/api/homepage-sections/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: orderedIds }),
      }),
    onSuccess: () => invalidate(),
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: t("admin.homepage_save_failed"), description: sectionErrorMessage(error, t) }),
  });

  const rows = sections.data || [];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload = toSectionPayload(draft);
    // Validate client-side in the admin's language so the usual mistakes never
    // surface as a server round trip. The server still re-checks everything.
    const invalid =
      (!payload.titleFr && "admin.homepage_error_title_required") ||
      (payload.type === "category" && !payload.category && "admin.homepage_error_category_required") ||
      (payload.type === "price_under" && !(Number(payload.maxPrice) > 0) && "admin.homepage_error_price_required") ||
      (payload.tileHref &&
        !payload.tileHref.startsWith("/") &&
        !/^https?:\/\//i.test(payload.tileHref) &&
        "admin.homepage_error_href_invalid");
    if (invalid) {
      toast({ variant: "destructive", title: t("admin.homepage_save_failed"), description: t(invalid) });
      return;
    }
    if (editingId === null) {
      createSection.mutate(payload);
    } else {
      updateSection.mutate({ id: editingId, payload });
    }
  };

  const startEdit = (section: HomepageSectionRow) => {
    setEditingId(section.id);
    setDraft(toSectionDraft(section));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(EMPTY_SECTION_DRAFT);
  };

  const shift = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const ordered = rows.map((row) => row.id);
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    moveSection.mutate({ orderedIds: ordered });
  };

  const field = (key: keyof HomepageSectionDraft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  // Saving mid-upload would store the section without the image being sent.
  const busy = createSection.isPending || updateSection.isPending || uploadingImage;
  const editingSection = editingId === null ? null : rows.find((row) => row.id === editingId) || null;

  return (
    <div className="space-y-7">
      <Panel title={editingId === null ? t("admin.homepage_add") : t("admin.homepage_edit")} icon={<LayoutGrid className="w-5 h-5" />}>
        <form onSubmit={submit} className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="md:col-span-2 xl:col-span-3 p-4 rounded-2xl border border-border bg-background/60">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{t("admin.homepage_languages")}</p>
            <p className="text-xs text-muted-foreground mb-4">{t("admin.homepage_languages_hint")}</p>

            <div role="tablist" aria-label={t("admin.homepage_languages")} className="flex flex-wrap gap-2 mb-4">
              {HOMEPAGE_LOCALES.map((lang) => {
                // A language other than French with no title of its own will fall
                // back to the French heading at runtime; the dot flags that so the
                // admin can tell "translated" from "inherited" at a glance.
                const inherited = lang !== "fr" && !draft[HOMEPAGE_TITLE_FIELDS[lang]].trim();
                return (
                  <button
                    key={lang}
                    type="button"
                    role="tab"
                    aria-selected={activeLang === lang}
                    onClick={() => setActiveLang(lang)}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                      activeLang === lang
                        ? "bg-[#ff6200] text-white border-[#ff6200]"
                        : "border-border hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                  >
                    {t(HOMEPAGE_LANG_TAB_KEYS[lang])}
                    {inherited && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />}
                  </button>
                );
              })}
            </div>

            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              <label className="block md:col-span-2 xl:col-span-3">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  {t("admin.homepage_field_title")}
                  {activeLang === "fr" && <span className="text-[#ff6200]"> *</span>}
                </span>
                <Input
                  required={activeLang === "fr"}
                  dir={activeLang === "ar" ? "rtl" : "ltr"}
                  value={draft[HOMEPAGE_TITLE_FIELDS[activeLang]]}
                  onChange={field(HOMEPAGE_TITLE_FIELDS[activeLang])}
                  placeholder={t("admin.homepage_title_placeholder")}
                  className="mt-1"
                />
              </label>

              <label className="block">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("admin.homepage_tile_title")}</span>
                <Input dir={activeLang === "ar" ? "rtl" : "ltr"} value={draft[HOMEPAGE_TILE_TITLE_FIELDS[activeLang]]} onChange={field(HOMEPAGE_TILE_TITLE_FIELDS[activeLang])} className="mt-1" />
              </label>

              <label className="block">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("admin.homepage_tile_subtitle")}</span>
                <Input dir={activeLang === "ar" ? "rtl" : "ltr"} value={draft[HOMEPAGE_TILE_SUBTITLE_FIELDS[activeLang]]} onChange={field(HOMEPAGE_TILE_SUBTITLE_FIELDS[activeLang])} className="mt-1" />
              </label>

              <label className="block">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("admin.homepage_tile_cta")}</span>
                <Input dir={activeLang === "ar" ? "rtl" : "ltr"} value={draft[HOMEPAGE_TILE_CTA_FIELDS[activeLang]]} onChange={field(HOMEPAGE_TILE_CTA_FIELDS[activeLang])} className="mt-1" />
              </label>
            </div>

            <p className="text-xs text-muted-foreground mt-3">{t("admin.homepage_lang_hint")}</p>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("admin.homepage_field_type")}</span>
            <select className="field mt-1" value={draft.type} onChange={e => field("type")(e.target.value)}>
              {HOMEPAGE_SECTION_TYPES.map((value) => (
                <option key={value} value={value}>{t(HOMEPAGE_TYPE_LABEL_KEYS[value])}</option>
              ))}
            </select>
          </label>

          {draft.type === "category" && (
            <label className="block">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("admin.homepage_field_category")}</span>
              <select className="field mt-1" value={draft.category} onChange={e => field("category")(e.target.value)}>
                <option value="">{t("admin.homepage_pick_category")}</option>
                {categoryOptions.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          )}

          {draft.type === "price_under" && (
            <label className="block">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("admin.homepage_field_max_price")}</span>
              <Input
                type="number"
                min={0}
                step="0.001"
                value={draft.maxPrice}
                onChange={field("maxPrice")}
                placeholder={t("admin.homepage_max_price_placeholder")}
                className="mt-1"
              />
            </label>
          )}

          <label className="block">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("admin.homepage_field_max_products")}</span>
            <Input
              type="number"
              min={HOMEPAGE_SECTION_MIN_PRODUCTS}
              max={HOMEPAGE_SECTION_MAX_PRODUCTS}
              value={draft.maxProducts}
              onChange={field("maxProducts")}
              className="mt-1"
            />
            <span className="text-xs text-muted-foreground mt-1 block">
              {t("admin.homepage_max_products_hint", {
                min: HOMEPAGE_SECTION_MIN_PRODUCTS,
                max: HOMEPAGE_SECTION_MAX_PRODUCTS,
              })}
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("admin.homepage_field_order")}</span>
            <Input type="number" min={0} value={draft.displayOrder} onChange={field("displayOrder")} placeholder={t("admin.homepage_order_auto")} className="mt-1" />
          </label>

          <div className="md:col-span-2 xl:col-span-3 mt-2 p-4 rounded-2xl border border-dashed border-border">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">{t("admin.homepage_tile_optional")}</p>
            <p className="text-xs text-muted-foreground mb-4">{t("admin.homepage_tile_hint")}</p>
            <div className="grid md:grid-cols-2 gap-4">
              <TileImageField value={draft.tileImageUrl} onChange={field("tileImageUrl")} onUploadingChange={setUploadingImage} />
              <label className="block">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{t("admin.homepage_tile_href")}</span>
                <Input dir="ltr" value={draft.tileHref} onChange={field("tileHref")} placeholder="/products?promo=active" className="mt-1" />
              </label>
            </div>
            <p className="text-xs text-muted-foreground mt-3">{t("admin.homepage_tile_media_hint")}</p>
          </div>

          <div className="md:col-span-2 xl:col-span-3 flex flex-wrap gap-3 pt-2">
            <button type="submit" className="btn-primary flex items-center gap-2" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId === null ? t("admin.homepage_add") : t("admin.homepage_save")}
            </button>
            {editingId !== null && (
              <button type="button" onClick={cancelEdit} className="px-4 py-3 rounded-2xl border border-border font-bold inline-flex items-center gap-2">
                <RotateCcw className="w-4 h-4" /> {t("admin.homepage_cancel")}
              </button>
            )}
          </div>
        </form>
      </Panel>

      <Panel title={t("admin.homepage_manage")}>
        <p className="text-sm text-muted-foreground -mt-3 mb-6">{t("admin.homepage_intro")}</p>
        {sections.isLoading ? (
          <div className="py-10 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t("admin.homepage_empty")}
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((section, index) => (
              <div key={section.id} className={`p-4 rounded-2xl border border-border bg-background ${section.enabled ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => shift(index, -1)}
                      disabled={index === 0 || moveSection.isPending}
                      aria-label={t("admin.homepage_move_up")}
                      className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => shift(index, 1)}
                      disabled={index === rows.length - 1 || moveSection.isPending}
                      aria-label={t("admin.homepage_move_down")}
                      className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex-1 min-w-[12rem]">
                    <div className="font-black break-words">{sectionTitle(section, i18n.language)}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(HOMEPAGE_TYPE_LABEL_KEYS[section.type])}
                      {section.type === "category" && section.category ? ` · ${section.category}` : ""}
                      {section.type === "price_under" && section.maxPrice !== null
                        ? ` · ≤ ${formatMoney(Number(section.maxPrice), i18n.language)}`
                        : ""}
                      {` · ${t("admin.homepage_products_count", { count: section.maxProducts })}`}
                    </div>
                  </div>

                  {section.enabled && section.visibleProductCount === 0 ? (
                    <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
                      {t("admin.homepage_hidden")}
                    </span>
                  ) : (
                    <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${section.enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-slate-500/10 text-muted-foreground"}`}>
                      {section.enabled ? t("admin.homepage_enabled") : t("admin.homepage_disabled")}
                    </span>
                  )}

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={section.enabled}
                      onClick={() => toggleSection.mutate({ section, enabled: !section.enabled })}
                      aria-label={t("admin.homepage_enabled")}
                      className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${section.enabled ? "bg-[#ff6200]" : "bg-slate-300 dark:bg-slate-700"}`}
                    >
                      <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${section.enabled ? "left-[1.4rem]" : "left-0.5"}`} />
                    </button>
                    <button type="button" onClick={() => startEdit(section)} aria-label={t("admin.homepage_edit")} className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(section)}
                      aria-label={t("admin.homepage_delete")}
                      className="p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {section.enabled && section.visibleProductCount === 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-bold mt-3">
                    {section.matchingProductCount ? t("admin.homepage_hidden_duplicates") : t("admin.homepage_hidden_no_match")}
                  </p>
                )}

                {editingId === section.id && (
                  <p className="text-xs text-[#ff6200] font-bold mt-3">
                    {t("admin.homepage_editing_below", { title: sectionTitle(editingSection ?? section, i18n.language) })}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Deleting a shelf removes it from the live homepage at once and cannot
          be undone, so it is confirmed rather than fired from a single click. */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.homepage_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.homepage_delete_confirm_desc", { title: pendingDelete ? sectionTitle(pendingDelete, i18n.language) : "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.homepage_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (pendingDelete) deleteSection.mutate(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              {t("admin.homepage_delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DeliverySettingsPanel({ settings, onSave, saving }: { settings: DeliverySettings; onSave: (next: DeliverySettings) => void; saving: boolean }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<DeliverySettings>(settings);
  const [feeInput, setFeeInput] = useState(String(settings.deliveryFee ?? 0));
  const [thresholdInput, setThresholdInput] = useState(String(settings.freeDeliveryThreshold ?? 0));

  // Re-sync the inputs whenever the server data changes.
  useEffect(() => {
    setForm(settings);
    setFeeInput(String(settings.deliveryFee ?? 0));
    setThresholdInput(String(settings.freeDeliveryThreshold ?? 0));
  }, [settings]);

  const bothOff = !form.pickupEnabled && !form.deliveryEnabled;
  const feeNumber = Number(feeInput) || 0;
  const thresholdNumber = Number(thresholdInput) || 0;
  const invalidFee = feeInput.trim() !== "" && (!Number.isFinite(feeNumber) || feeNumber < 0);
  const invalidThreshold = thresholdInput.trim() !== "" && (!Number.isFinite(thresholdNumber) || thresholdNumber < 0);
  const canSave = !bothOff && !invalidFee && !invalidThreshold && !saving;

  return <div className="space-y-7">
    <Panel title={t("admin.nav_delivery")} icon={<Truck className="w-5 h-5" />}>
      <p className="text-sm text-muted-foreground mb-6">
        {t("admin.delivery_hint_check")}
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <Toggle checked={form.pickupEnabled} onChange={v => setForm(f => ({ ...f, pickupEnabled: v }))} icon={<ShoppingBag className="w-5 h-5" />}
          label={t("admin.delivery_pickup")} hint={t("admin.delivery_hint_pickup")} />
        <Toggle checked={form.deliveryEnabled} onChange={v => setForm(f => ({ ...f, deliveryEnabled: v }))} icon={<Truck className="w-5 h-5" />}
          label={t("admin.delivery_home")} hint={t("admin.delivery_hint_home")} />
      </div>

      {bothOff && <div className="mt-4 p-4 rounded-2xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-sm font-bold text-red-700 dark:text-red-400">
        {t("admin.delivery_hint_thumb")}
      </div>}

      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <div>
          <label className="text-xs uppercase tracking-wider font-bold text-muted-foreground" htmlFor="ds-fee">{t("admin.delivery_fee_label")}</label>
          <Input id="ds-fee" type="number" min="0" step="0.001" value={feeInput} onChange={v => setFeeInput(v)} disabled={!form.deliveryEnabled} />
          {invalidFee && <div className="text-xs text-red-600 mt-1">{t("admin.delivery_invalid_amount")}</div>}
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider font-bold text-muted-foreground" htmlFor="ds-threshold">{t("admin.delivery_free_from")}</label>
          <Input id="ds-threshold" type="number" min="0" step="0.001" value={thresholdInput} onChange={v => setThresholdInput(v)} disabled={!form.deliveryEnabled} />
          {invalidThreshold && <div className="text-xs text-red-600 mt-1">{t("admin.delivery_invalid_amount")}</div>}
          {!invalidThreshold && thresholdNumber > 0 && <div className="text-xs text-muted-foreground mt-1">{t("admin.delivery_threshold_zero")}</div>}
        </div>
      </div>

      <div className="mt-6">
        <label className="text-xs uppercase tracking-wider font-bold text-muted-foreground" htmlFor="ds-note">{t("admin.delivery_note")}</label>
        <textarea id="ds-note" rows={3} value={form.deliveryNote ?? ""} onChange={e => setForm(f => ({ ...f, deliveryNote: e.target.value }))}
          placeholder={t("admin.delivery_note_placeholder")} className="field mt-1" />
        <div className="text-xs text-muted-foreground mt-1">{t("admin.delivery_shown_checkout")}</div>
      </div>

      <div className="flex items-center gap-4 mt-7">
        <button onClick={() => onSave({ ...form, deliveryFee: feeNumber, freeDeliveryThreshold: thresholdNumber })} disabled={!canSave} className="btn-primary inline-flex items-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t("admin.delivery_save")}
        </button>
        <button onClick={() => { setForm(settings); setFeeInput(String(settings.deliveryFee ?? 0)); setThresholdInput(String(settings.freeDeliveryThreshold ?? 0)); }} className="px-4 py-2 rounded-xl border border-border font-bold text-sm">
          {t("admin.cancel")}
        </button>
      </div>
    </Panel>

    <Panel title={t("admin.delivery_preview_title")} icon={<Eye className="w-5 h-5" />}>
      <p className="text-sm text-muted-foreground mb-4">{t("admin.delivery_preview", { amount: formatPrice(50) })}</p>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span>{t("admin.delivery_pickup")}</span><span className="font-bold">{form.pickupEnabled ? "0.000 DT" : t("admin.delivery_unavailable")}</span></div>
        <div className="flex justify-between"><span>{t("admin.delivery_home")}</span><span className="font-bold">{!form.deliveryEnabled ? t("admin.delivery_unavailable") : formatPrice(computeDeliveryFee({ ...form, deliveryFee: feeNumber, freeDeliveryThreshold: thresholdNumber }, "delivery", 50))}</span></div>
        <div className="flex justify-between"><span>{t("admin.delivery_preview_row_threshold", { amount: formatPrice(thresholdNumber > 0 ? thresholdNumber : 100) })}</span><span className="font-bold">{!form.deliveryEnabled || thresholdNumber <= 0 ? "—" : formatPrice(computeDeliveryFee({ ...form, deliveryFee: feeNumber, freeDeliveryThreshold: thresholdNumber }, "delivery", thresholdNumber))}</span></div>
      </div>
    </Panel>
  </div>;
}

function OrdersTable({ orders, onStatus }: { orders: Order[]; onStatus: (id: number, status: string) => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Order | null>(null);
  if (!orders.length) return <div className="py-10 text-center text-muted-foreground"><Boxes className="w-10 h-10 mx-auto mb-3 opacity-40" />{t("admin.orders_empty")}</div>;
  return <>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-start border-b"><th className="py-3 pe-4">#</th><th className="py-3 pe-4">{t("admin.orders_customer")}</th><th className="py-3 pe-4">{t("admin.orders_items")}</th><th className="py-3 pe-4">{t("admin.orders_fulfilment")}</th><th className="py-3 pe-4">{t("admin.orders_delivery")}</th><th className="py-3 pe-4">{t("admin.orders_total")}</th><th className="py-3 pe-4">{t("admin.orders_payment")}</th><th className="py-3 pe-4">{t("admin.orders_status")}</th><th className="py-3">{t("admin.orders_details")}</th></tr></thead><tbody>{orders.map(order => {
    const items = parseOrderItems(order.itemsJson);
    const fulfillment = orderFulfillment(order);
    const fee = orderFee(order);
    return <tr key={order.id} className="border-b last:border-0 align-top"><td className="py-4 pe-4 font-black">#{order.id}</td><td className="py-4 pe-4"><div className="font-bold">{order.customerName}</div><div className="text-xs text-muted-foreground">{order.phone}</div>{fulfillment === "delivery" && order.address && <div className="text-xs mt-1 max-w-56">{order.address}</div>}</td><td className="py-4 pe-4"><div className="flex flex-col gap-2 min-w-56 max-w-72">{items.map((item, index) => <div key={`${item.id}-${index}`} className="flex items-center gap-2.5"><OrderThumb item={item} size={48} /><div className="min-w-0"><div className="font-bold text-sm leading-tight">{item.quantity} × {item.name}</div><div className="text-xs text-muted-foreground mt-0.5">{formatPrice(item.price * item.quantity)}</div></div></div>)}</div></td><td className="py-4 pe-4 whitespace-nowrap"><span className="inline-flex items-center gap-1.5 text-xs font-bold">{fulfillment === "pickup" ? <ShoppingBag className="w-3.5 h-3.5" /> : <Truck className="w-3.5 h-3.5" />}{t(FULFILLMENT_KEY[fulfillment])}</span></td><td className="py-4 pe-4 text-xs whitespace-nowrap">{fulfillment === "pickup" ? "—" : (fee > 0 ? <span className="font-bold">{formatPrice(fee)}</span> : <span className="text-emerald-600 font-bold">{t("admin.delivery_free")}</span>)}</td><td className="py-4 pe-4 font-black whitespace-nowrap">{formatPrice(order.total)}</td><td className="py-4 pe-4 text-xs">{paymentLabel(order.paymentMethod, t)}</td><td className="py-4 pe-4"><select value={order.status} onChange={e => onStatus(order.id, e.target.value)} aria-label={t("admin.order_status_aria", { id: order.id })} className="field !py-2 min-w-36">{STATUS_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}</select></td><td className="py-4"><button type="button" onClick={() => setSelected(order)} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-border hover:bg-muted transition-colors text-sm font-bold whitespace-nowrap"><Eye className="w-4 h-4" />{t("admin.orders_open")}</button></td></tr>;
  })}</tbody></table></div>
    <OrderDetailsDialog order={selected} onClose={() => setSelected(null)} onStatus={onStatus} />
  </>;
}
