import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SiteBackground } from "@/components/SiteBackground";
import { useSelection } from "@/hooks/use-selection";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, ShoppingBag, CheckCircle2, Truck, Store, MapPin } from "lucide-react";
import {
  DEFAULT_DELIVERY_SETTINGS,
  computeDeliveryFee,
  type DeliverySettings,
  type FulfillmentMethod,
} from "@shared/schema";
import { formatMoney } from "@/lib/format";

const FULFILLMENT_OPTIONS: { value: FulfillmentMethod; icon: typeof Truck }[] = [
  { value: "delivery", icon: Truck },
  { value: "pickup", icon: Store },
];

export default function Checkout() {
  const { selection, totalItems, clearSelection } = useSelection();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod>("delivery");
  const [touchedFulfillment, setTouchedFulfillment] = useState(false);
  const [form, setForm] = useState({
    customerName: user?.fullName || user?.username || "",
    email: user?.email || "",
    phone: user?.phone || "",
    address: "",
    notes: "",
    paymentMethod: "cash_on_delivery",
  });

  const deliverySettings = useQuery<DeliverySettings>({
    queryKey: ["/api/delivery-settings"],
    queryFn: async () => {
      const res = await fetch("/api/delivery-settings", { credentials: "include" });
      if (!res.ok) throw new Error("delivery-settings");
      return res.json();
    },
    // Public config: keep it fresh enough that an admin change shows up on the next visit.
    staleTime: 60_000,
  });

  // Fall back to the shared defaults if the request is still in flight or failed,
  // so the page is never blocked on configuration.
  const settings = deliverySettings.data ?? DEFAULT_DELIVERY_SETTINGS;
  const deliveryEnabled = settings.deliveryEnabled;
  const pickupEnabled = settings.pickupEnabled;
  const noMethodAvailable = !deliveryEnabled && !pickupEnabled;

  const subtotal = useMemo(
    () => selection.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0),
    [selection],
  );

  // Preview only — the server recomputes this and the client never sends a fee or total.
  const deliveryFee = useMemo(
    () => computeDeliveryFee(settings, fulfillmentMethod, subtotal),
    [settings, fulfillmentMethod, subtotal],
  );
  const grandTotal = subtotal + deliveryFee;
  const threshold = Number(settings.freeDeliveryThreshold || 0);
  const missingForFree = threshold > 0 && subtotal < threshold ? threshold - subtotal : 0;

  // Keep the selection valid when the admin disables the chosen method.
  useEffect(() => {
    if (noMethodAvailable) return;
    if (fulfillmentMethod === "delivery" && !deliveryEnabled && pickupEnabled) setFulfillmentMethod("pickup");
    if (fulfillmentMethod === "pickup" && !pickupEnabled && deliveryEnabled) setFulfillmentMethod("delivery");
  }, [deliveryEnabled, pickupEnabled, noMethodAvailable, fulfillmentMethod]);

  // On first load, land on a method that is actually available.
  useEffect(() => {
    if (touchedFulfillment || deliverySettings.isLoading) return;
    if (!deliveryEnabled && pickupEnabled) setFulfillmentMethod("pickup");
    if (!pickupEnabled && deliveryEnabled) setFulfillmentMethod("delivery");
  }, [deliveryEnabled, pickupEnabled, deliverySettings.isLoading, touchedFulfillment]);

  const update = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const isDelivery = fulfillmentMethod === "delivery";
  const addressMissing = isDelivery && !form.address.trim();
  const canSubmit = !!selection.length && !noMethodAvailable && !addressMissing;

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!selection.length) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          customerName: form.customerName,
          email: form.email || null,
          phone: form.phone,
          // An address is only meaningful for home delivery.
          address: isDelivery ? form.address : null,
          notes: form.notes || null,
          paymentMethod: form.paymentMethod,
          fulfillmentMethod,
          items: selection.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: Number(item.price || 0),
            imageUrl: item.imageUrl,
          })),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const order = await response.json();
      setOrderId(order.id);
      clearSelection();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: t("checkout.error_title"),
        description: error?.message || t("checkout.error_retry"),
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (orderId) {
    return (
      <div className="min-h-screen relative">
        <SiteBackground />
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 pt-36 pb-20">
          <div className="bg-white/90 dark:bg-slate-900/90 rounded-3xl border p-10 text-center shadow-xl">
            <CheckCircle2 className="w-16 h-16 text-emerald-600 mx-auto mb-5" />
            <h1 className="text-3xl font-black mb-3">{t("checkout.success_title")}</h1>
            <p className="text-slate-500 mb-2">{t("checkout.success_message")}</p>
            <p className="text-slate-500 mb-6">
              {t(isDelivery ? "checkout.success_hint_delivery" : "checkout.success_hint_pickup")}
            </p>
            <p className="font-bold text-primary mb-8">{t("checkout.order_ref", { id: orderId })}</p>
            <Button onClick={() => setLocation("/products")} className="rounded-xl px-8">
              {t("checkout.continue_shopping")}
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      <SiteBackground />
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 pt-32 pb-20">
        <div className="mb-8">
          <h1 className="text-4xl font-black">{t("checkout.title")}</h1>
          <p className="text-slate-500 mt-2">{t("checkout.subtitle")}</p>
        </div>

        {!selection.length ? (
          <div className="bg-white/80 dark:bg-slate-900/80 rounded-3xl border p-12 text-center">
            <ShoppingBag className="w-12 h-12 mx-auto text-slate-300 mb-4" />
            <h2 className="text-xl font-bold mb-4">{t("checkout.empty_title")}</h2>
            <Button onClick={() => setLocation("/products")}>{t("checkout.see_products")}</Button>
          </div>
        ) : (
          <form onSubmit={submitOrder} className="grid lg:grid-cols-[1fr_380px] gap-8 items-start">
            <div className="space-y-6">
              <section className="bg-white/85 dark:bg-slate-900/85 rounded-3xl border p-6 md:p-8 shadow-sm space-y-5">
                <h2 className="text-xl font-black">{t("checkout.contact")}</h2>
                <div className="grid md:grid-cols-2 gap-4">
                  <input
                    required
                    value={form.customerName}
                    onChange={(e) => update("customerName", e.target.value)}
                    placeholder={t("checkout.full_name")}
                    aria-label={t("checkout.full_name")}
                    className="rounded-xl border bg-transparent px-4 py-3"
                  />
                  <input
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder={t("checkout.email")}
                    aria-label={t("checkout.email")}
                    type="email"
                    className="rounded-xl border bg-transparent px-4 py-3"
                  />
                  <input
                    required
                    value={form.phone}
                    onChange={(e) => update("phone", e.target.value)}
                    placeholder={t("checkout.phone")}
                    aria-label={t("checkout.phone")}
                    className="rounded-xl border bg-transparent px-4 py-3"
                  />
                  <select
                    value={form.paymentMethod}
                    onChange={(e) => update("paymentMethod", e.target.value)}
                    aria-label={t("checkout.payment_method")}
                    className="rounded-xl border bg-transparent px-4 py-3"
                  >
                    <option value="cash_on_delivery">{t("checkout.payment_cash_on_delivery")}</option>
                    <option value="pickup">{t("checkout.payment_pickup")}</option>
                    <option value="whatsapp">{t("checkout.payment_whatsapp")}</option>
                  </select>
                </div>
                <textarea
                  value={form.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  placeholder={t("checkout.notes_placeholder")}
                  aria-label={t("checkout.notes")}
                  rows={3}
                  className="w-full rounded-xl border bg-transparent px-4 py-3"
                />
              </section>

              <section className="bg-white/85 dark:bg-slate-900/85 rounded-3xl border p-6 md:p-8 shadow-sm space-y-5">
                <div>
                  <h2 className="text-xl font-black">{t("checkout.fulfillment_title")}</h2>
                  <p className="text-slate-500 text-sm mt-1">{t("checkout.fulfillment_hint")}</p>
                </div>

                {noMethodAvailable ? (
                  <div className="rounded-2xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 text-sm font-bold text-red-700 dark:text-red-400">
                    {t("checkout.methods_unavailable")}
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-4" role="radiogroup" aria-label={t("checkout.fulfillment_title")}>
                    {FULFILLMENT_OPTIONS.map(({ value, icon: Icon }) => {
                      const enabled = value === "delivery" ? deliveryEnabled : pickupEnabled;
                      const selected = fulfillmentMethod === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={!enabled}
                          onClick={() => {
                            setTouchedFulfillment(true);
                            setFulfillmentMethod(value);
                          }}
                          className={`text-start rounded-2xl border p-4 transition disabled:opacity-50 disabled:cursor-not-allowed ${
                            selected
                              ? "border-[#ff6200] ring-2 ring-[#ff6200]/30 bg-[#ff6200]/5"
                              : "border-border hover:border-[#ff6200]/50"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Icon className={`w-5 h-5 ${selected ? "text-[#ff6200]" : "text-muted-foreground"}`} />
                            <span className="font-black">
                              {t(value === "delivery" ? "checkout.method_delivery" : "checkout.method_pickup")}
                            </span>
                            {!enabled && (
                              <span className="ms-auto text-xs font-bold text-muted-foreground">
                                {t("checkout.unavailable")}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5">
                            {t(value === "delivery" ? "checkout.method_delivery_desc" : "checkout.method_pickup_desc")}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}

                {isDelivery ? (
                  <div>
                    <label htmlFor="checkout-address" className="block text-sm font-black mb-1.5">
                      {t("checkout.address")}
                    </label>
                    <textarea
                      id="checkout-address"
                      required
                      value={form.address}
                      onChange={(e) => update("address", e.target.value)}
                      placeholder={t("checkout.address_placeholder")}
                      rows={3}
                      className="w-full rounded-xl border bg-transparent px-4 py-3"
                    />
                    {addressMissing && (
                      <p className="text-xs text-red-600 mt-1">{t("checkout.address_required")}</p>
                    )}
                    {settings.deliveryNote && (
                      <div className="mt-3 rounded-xl bg-muted/60 p-3 text-xs flex gap-2">
                        <Truck className="w-4 h-4 shrink-0 text-[#ff6200]" />
                        <span>
                          <span className="font-black">{t("checkout.delivery_note")}: </span>
                          {settings.deliveryNote}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  !noMethodAvailable && (
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      {t("checkout.address_hidden_pickup")}
                    </p>
                  )
                )}
              </section>
            </div>

            <aside className="bg-white/90 dark:bg-slate-900/90 rounded-3xl border p-6 shadow-sm h-fit lg:sticky lg:top-28">
              <h2 className="text-xl font-black mb-5">{t("checkout.summary")}</h2>
              <div className="space-y-4 max-h-[320px] overflow-auto pe-1">
                {selection.map((item) => (
                  <div key={`${item.id}-${item.type}`} className="flex gap-3">
                    <div className="w-14 h-14 rounded-xl bg-slate-100 overflow-hidden shrink-0">
                      {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm truncate">{item.name}</div>
                      <div className="text-xs text-slate-500">
                        {item.quantity} × {formatMoney(item.price ?? 0, i18n.language)}
                      </div>
                    </div>
                    <div className="text-sm font-black">{formatMoney(Number(item.price || 0) * item.quantity, i18n.language)}</div>
                  </div>
                ))}
              </div>

              <div className="border-t mt-5 pt-5 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">
                    {t("checkout.items_count")} ({totalItems})
                  </span>
                  <span className="font-bold">{formatMoney(subtotal, i18n.language)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">{t("checkout.delivery_fee")}</span>
                  {isDelivery ? (
                    deliveryFee > 0 ? (
                      <span className="font-bold">{formatMoney(deliveryFee, i18n.language)}</span>
                    ) : (
                      <span className="font-bold text-emerald-600">{t("checkout.free")}</span>
                    )
                  ) : (
                    <span className="text-slate-400">{t("checkout.free")}</span>
                  )}
                </div>
                {isDelivery && missingForFree > 0 && (
                  <div className="text-xs font-bold text-[#ff6200]">
                    {t("checkout.free_hint", { amount: formatMoney(missingForFree, i18n.language) })}
                  </div>
                )}
                {isDelivery && threshold > 0 && missingForFree === 0 && (
                  <div className="text-xs font-bold text-emerald-600">{t("checkout.free_unlocked")}</div>
                )}
                <div className="flex justify-between text-xl font-black pt-1">
                  <span>{t("checkout.total")}</span>
                  <span className="text-primary">{formatMoney(grandTotal, i18n.language)}</span>
                </div>
              </div>

              <Button
                disabled={submitting || !canSubmit}
                className="w-full h-13 rounded-xl mt-6 font-black"
                type="submit"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {t("checkout.sending")}
                  </>
                ) : (
                  t("checkout.confirm")
                )}
              </Button>
            </aside>
          </form>
        )}
      </main>
      <Footer />
    </div>
  );
}
