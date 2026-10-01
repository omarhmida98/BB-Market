import { useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SiteBackground } from "@/components/SiteBackground";
import { useAuth } from "@/hooks/use-auth";
import { useMyOrder, MyOrderNotFoundError } from "@/hooks/use-my-orders";
import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  ChevronLeft,
  Package,
  MapPin,
  Store,
  CalendarDays,
  CreditCard,
  StickyNote,
  Tag,
  PackageX,
} from "lucide-react";
import { OrderStatusTimeline, OrderStatusBadge } from "@/components/OrderStatusTimeline";
import { ReorderButton } from "@/components/ReorderButton";
import { OrderWhatsAppButton } from "@/components/OrderWhatsAppButton";
import { Button } from "@/components/ui/button";

/**
 * One customer's order, in full.
 *
 * Every number here comes from the order's own stored snapshot. No product is
 * re-read: if a product has since been renamed, repriced, promoted or deleted,
 * this page must still show the name and the price the customer was actually
 * billed. That is the whole point of the snapshot, and re-fetching here would
 * quietly rewrite history.
 *
 * This page is read-only. Status changes are an admin action; there is
 * deliberately no control here that could move an order forward.
 */
export default function OrderDetail() {
  const { t, i18n } = useTranslation();
  const { user, isLoading: loadingUser } = useAuth();
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);
  const validId = Number.isInteger(orderId) && orderId > 0;

  const { data: order, isLoading, error } = useMyOrder(validId ? orderId : null);

  const dateLocale =
    i18n.language.startsWith("ar") ? "ar-TN" : i18n.language.startsWith("en") ? "en-US" : "fr-FR";

  const formatMoney = (value: number) => `${Number(value || 0).toFixed(3)} DT`;
  const formatDateTime = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(dateLocale, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  // Same reasoning as Account.tsx: redirect from an effect, and wait for the
  // session to resolve first so a signed-in customer is not bounced to /login on
  // a refresh.
  useEffect(() => {
    if (!loadingUser && !user) setLocation(`/login?redirect=/account/orders/${params.id}`);
  }, [loadingUser, user, params.id, setLocation]);

  if (loadingUser || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <SiteBackground />
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!validId || error instanceof MyOrderNotFoundError) {
    return <OrderNotFound />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen font-sans relative">
        <SiteBackground />
        <Navbar />
        <div className="pt-40 pb-24 flex justify-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!order) {
    return <OrderNotFound />;
  }

  const isPickup = order.fulfillmentMethod === "pickup";

  return (
    <div className="min-h-screen font-sans relative">
      <SiteBackground />
      <Navbar />

      <div className="pt-32 pb-8 bg-primary text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => setLocation("/account")}
            className="inline-flex items-center gap-2 text-blue-100 hover:text-white transition-colors mb-4 text-sm font-bold"
          >
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
            {t("account.orders.back", "Retour à mes commandes")}
          </motion.button>
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-3xl sm:text-4xl font-display font-bold" data-testid="detail-order-number">
              {order.orderNumber}
            </h1>
            <OrderStatusBadge status={order.status} fulfillmentMethod={order.fulfillmentMethod} />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        {/* ------------------------------------------------------- timeline */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-[2.5rem] border border-border bg-card/80 backdrop-blur-md shadow-xl p-6"
        >
          <h2 className="font-display font-bold text-lg mb-5">
            {t("account.detail.timeline", "Suivi de la commande")}
          </h2>
          <OrderStatusTimeline
            status={order.status}
            fulfillmentMethod={order.fulfillmentMethod}
          />
        </motion.section>

        <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr] items-start">
          {/* --------------------------------------------------------- items */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="rounded-[2.5rem] border border-border bg-card/80 backdrop-blur-md shadow-xl overflow-hidden"
          >
            <div className="p-6 border-b border-border">
              <h2 className="font-display font-bold text-lg">
                {t("account.detail.items", "Articles commandés")}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t("account.detail.items_hint", { count: order.itemCount })}
              </p>
            </div>

            <ul className="divide-y divide-border" data-testid="detail-items">
              {order.items.map((item, index) => (
                <motion.li
                  key={`${item.id}-${index}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="p-5 flex gap-4"
                >
                  <div className="w-20 h-20 rounded-2xl overflow-hidden bg-secondary border border-border shrink-0">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Package className="h-7 w-7" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-bold" data-testid="detail-item-name">
                      {item.name}
                    </p>

                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-2">
                      <span className="text-sm text-muted-foreground">
                        {t("account.detail.unit_price", "Prix unitaire")}
                      </span>
                      <span
                        className="font-bold"
                        data-testid="detail-item-unit-price"
                      >
                        {formatMoney(item.price)}
                      </span>
                      {item.promoApplied && (
                        <>
                          <span
                            className="text-sm text-muted-foreground line-through"
                            data-testid="detail-item-original-price"
                          >
                            {formatMoney(item.originalPrice)}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500 text-white text-[11px] font-bold"
                            data-testid="detail-item-promo"
                          >
                            <Tag className="w-3 h-3" />
                            {t("account.detail.promo_applied", "Promotion")}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-baseline justify-between gap-2 mt-2">
                      <span className="text-sm text-muted-foreground">
                        {t("account.detail.quantity", "Quantité")}:{" "}
                        <span className="font-bold text-foreground">{item.quantity}</span>
                      </span>
                      <span className="font-black text-primary" data-testid="detail-item-line-total">
                        {formatMoney(item.lineTotal)}
                      </span>
                    </div>
                  </div>
                </motion.li>
              ))}
            </ul>

            {/* ------------------------------------------------------ totals */}
            <div className="bg-secondary/40 p-6 space-y-3">
              <TotalRow
                label={t("account.detail.subtotal", "Sous-total")}
                value={formatMoney(order.subtotal)}
                testId="detail-subtotal"
              />
              <TotalRow
                label={
                  isPickup
                    ? t("account.detail.pickup_fee", "Frais de retrait")
                    : t("account.detail.delivery_fee", "Frais de livraison")
                }
                value={order.deliveryFee > 0 ? formatMoney(order.deliveryFee) : t("account.detail.free", "Gratuit")}
                testId="detail-delivery-fee"
              />
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <span className="font-black">{t("account.detail.total", "Total")}</span>
                <span className="font-black text-primary text-xl" data-testid="detail-total">
                  {formatMoney(order.total)}
                </span>
              </div>
            </div>
          </motion.section>

          {/* ------------------------------------------------------- side */}
          <motion.aside
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-6"
          >
            <section className="rounded-[2rem] border border-border bg-card/80 backdrop-blur-md shadow-xl p-6 space-y-4">
              <InfoRow
                icon={<CalendarDays className="w-4 h-4" />}
                label={t("account.detail.date", "Date")}
                value={formatDateTime(order.createdAt)}
              />
              <InfoRow
                icon={isPickup ? <Store className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                label={t("account.detail.fulfillment", "Mode de retrait")}
                value={
                  isPickup
                    ? t("account.fulfillment.pickup", "Retrait en magasin")
                    : t("account.fulfillment.delivery", "Livraison à domicile")
                }
              />
              <InfoRow
                icon={<CreditCard className="w-4 h-4" />}
                label={t("account.detail.payment", "Paiement")}
                value={t(`account.payment.${order.paymentMethod}`, {
                  defaultValue: order.paymentMethod,
                })}
              />

              {order.address && !isPickup && (
                <InfoRow
                  icon={<MapPin className="w-4 h-4" />}
                  label={t("account.detail.address", "Adresse de livraison")}
                  value={order.address}
                />
              )}

              {order.notes && (
                <InfoRow
                  icon={<StickyNote className="w-4 h-4" />}
                  label={t("account.detail.notes", "Vos notes")}
                  value={order.notes}
                />
              )}
            </section>

            <section className="rounded-[2rem] border border-border bg-card/80 backdrop-blur-md shadow-xl p-6 space-y-3">
              <OrderWhatsAppButton order={order} />
              {order.status !== "cancelled" && <ReorderButton order={order} className="w-full justify-center" />}
            </section>
          </motion.aside>
        </div>
      </div>

      <Footer />
    </div>
  );
}

function TotalRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-primary mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="font-semibold mt-0.5 break-words">{value}</p>
      </div>
    </div>
  );
}

/**
 * Shown for a malformed id and for someone else's order alike. The server
 * answers 404 in both cases on purpose, so the page cannot tell the customer
 * whether an order id they typed exists in the store.
 */
function OrderNotFound() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen font-sans relative">
      <SiteBackground />
      <Navbar />
      <div className="pt-40 pb-24 px-4">
        <div
          className="max-w-md mx-auto text-center bg-card/80 backdrop-blur-md rounded-[2.5rem] border border-border shadow-xl py-16 px-8"
          data-testid="order-not-found"
        >
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-6 text-muted-foreground">
            <PackageX className="h-10 w-10" />
          </div>
          <h1 className="text-2xl font-display font-bold mb-2">
            {t("account.detail.not_found", "Commande introuvable")}
          </h1>
          <p className="text-muted-foreground mb-8">
            {t(
              "account.detail.not_found_hint",
              "Cette commande n'existe pas ou n'est pas rattachée à votre compte.",
            )}
          </p>
          <Button onClick={() => setLocation("/account")} className="rounded-xl font-bold">
            {t("account.orders.back", "Retour à mes commandes")}
          </Button>
        </div>
      </div>
      <Footer />
    </div>
  );
}