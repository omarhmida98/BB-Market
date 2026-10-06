import { useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SiteBackground } from "@/components/SiteBackground";
import { useAuth } from "@/hooks/use-auth";
import { useMyOrders } from "@/hooks/use-my-orders";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  LogOut,
  User,
  Mail,
  Phone,
  Package,
  ShoppingBag,
  ChevronRight,
  MapPin,
  Store,
  CalendarDays,
  Settings,
  History,
  ChevronLeft,
} from "lucide-react";
import { OrderStatusBadge } from "@/components/OrderStatusTimeline";
import { WishlistSection } from "@/components/WishlistSection";
import { NotificationsSection } from "@/components/NotificationsSection";
import { Button } from "@/components/ui/button";
import { formatDate as formatDateUtil, formatMoney as formatMoneyUtil } from "@/lib/format";

/**
 * Customer account: identity summary plus order history.
 *
 * Only orders owned by the signed-in customer are ever requested — the server
 * filters on `user_id` in SQL — so there is nothing to filter here and no way to
 * ask for "someone else's" order from this page.
 */
export default function Account() {
  const { t, i18n } = useTranslation();
  const { user, isLoading: loadingUser, logoutMutation } = useAuth();
  const [, setLocation] = useLocation();
  const { data: orders, isLoading: loadingOrders } = useMyOrders();

  const formatDate = (iso: string | null) =>
    iso
      ? formatDateUtil(iso, i18n.language, { day: "2-digit", month: "short", year: "numeric" })
      : "—";

  const formatMoney = (value: number) => formatMoneyUtil(value, i18n.language);

  // Redirect in an effect rather than during render: a navigation is a side
  // effect, and doing it inline re-renders the component before React has
  // finished rendering it. `loadingUser` guards the window where the session is
  // still being fetched and `user` is briefly null, which would otherwise bounce
  // a signed-in customer to the login page on every hard refresh.
  useEffect(() => {
    if (!loadingUser && !user) setLocation("/login?redirect=/account");
  }, [loadingUser, user, setLocation]);

  if (loadingUser || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <SiteBackground />
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  const handleLogout = () => {
    logoutMutation.mutate(undefined, { onSuccess: () => setLocation("/") });
  };

  const orderCount = orders?.length ?? 0;

  return (
    <div className="min-h-screen font-sans relative">
      <SiteBackground />
      <Navbar />

      <div className="pt-32 pb-12 bg-primary text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl"
          >
            <button
              onClick={() => setLocation("/")}
              className="inline-flex items-center gap-2 text-blue-100 hover:text-white transition-colors mb-6 text-sm font-bold"
            >
              <ChevronLeft className="w-4 h-4" />
              {t("account.back_home", "Retour à l'accueil")}
            </button>
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-white">
                <User className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-4xl font-display font-bold mb-2">
                  {t("account.title", "Mon compte")}
                </h1>
                <p className="text-blue-100 text-lg">
                  {t("account.subtitle", "Vos informations et vos commandes")}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
        {/* ---------------------------------------------------------------
            Profile summary
            Phone is conditional: Google-only accounts often have none, and
            showing an empty row would imply a field the customer cannot fill
            in from this page (it lives on the profile page).
            --------------------------------------------------------------- */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-[2.5rem] border border-border bg-card/80 backdrop-blur-md shadow-xl overflow-hidden"
        >
          <div className="p-6 border-b border-border flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <User className="w-5 h-5" />
              </div>
              <h2 className="font-display font-bold text-lg">
                {t("account.profile", "Profil")}
              </h2>
            </div>
            <Button
              onClick={handleLogout}
              variant="outline"
              disabled={logoutMutation.isPending}
              className="rounded-xl font-bold"
              data-testid="account-logout"
            >
              {logoutMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin me-2" />
              ) : (
                <LogOut className="w-4 h-4 me-2" />
              )}
              {t("auth.logout", "Déconnexion")}
            </Button>
          </div>

          <div className="p-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ProfileField
              icon={<User className="w-4 h-4" />}
              label={t("account.field_name", "Nom")}
              value={user.fullName || user.username}
            />
            <ProfileField
              icon={<Mail className="w-4 h-4" />}
              label={t("account.field_email", "Email")}
              value={user.email}
            />
            {user.phone ? (
              <ProfileField
                icon={<Phone className="w-4 h-4" />}
                label={t("account.field_phone", "Téléphone")}
                value={user.phone}
              />
            ) : null}
          </div>

          <div className="px-6 pb-6">
            <button
              onClick={() => setLocation("/profile")}
              className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
            >
              <Settings className="w-4 h-4" />
              {t("account.edit_profile", "Modifier mon profil")}
            </button>
          </div>
        </motion.section>

        {/* -------------------------------------------------------- favourites */}
        {/* Between the profile card and the orders: it answers "what was I
            saving up for?", which is what a returning customer wants first, and
            it keeps the two live-data sections (favourites, catalogue) away from
            the order history, which is snapshot data. */}
        <WishlistSection />

        {/* --------------------------------------------------------- orders */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-[2.5rem] border border-border bg-card/80 backdrop-blur-md shadow-xl overflow-hidden"
        >
          <div className="p-6 border-b border-border flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <History className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display font-bold text-lg">
                  {t("account.orders.title", "Mes commandes")}
                </h2>
                {!loadingOrders && orderCount > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("account.orders.count", { count: orderCount })}
                  </p>
                )}
              </div>
            </div>
          </div>

          {loadingOrders ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="py-20 px-6 text-center" data-testid="orders-empty">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6 text-primary">
                <ShoppingBag className="h-10 w-10" />
              </div>
              <h3 className="text-2xl font-display font-bold text-foreground mb-2">
                {t("account.orders.empty_title", "Aucune commande")}
              </h3>
              <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                {t(
                  "account.orders.empty_description",
                  "Vous n'avez pas encore commandé. Votre historique apparaîtra ici après votre première commande.",
                )}
              </p>
              <Button
                onClick={() => setLocation("/products")}
                className="rounded-xl font-bold"
                data-testid="orders-empty-cta"
              >
                <Package className="w-4 h-4 me-2" />
                {t("account.orders.browse", "Découvrir nos produits")}
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border" data-testid="orders-list">
              {orders.map((order, index) => {
                const isPickup = order.fulfillmentMethod === "pickup";
                return (
                  <motion.li
                    key={order.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <button
                      onClick={() => setLocation(`/account/orders/${order.id}`)}
                      className="w-full text-start p-5 sm:p-6 hover:bg-secondary/40 transition-colors"
                      data-testid="order-row"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-black text-primary" data-testid="order-number">
                              {order.orderNumber}
                            </span>
                            <OrderStatusBadge
                              status={order.status}
                              fulfillmentMethod={order.fulfillmentMethod}
                            />
                          </div>
                          <div className="flex items-center gap-4 mt-2 flex-wrap text-sm text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <CalendarDays className="w-4 h-4" />
                              {formatDate(order.createdAt)}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              {isPickup ? <Store className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                              {isPickup
                                ? t("account.fulfillment.pickup", "Retrait en magasin")
                                : t("account.fulfillment.delivery", "Livraison à domicile")}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Package className="w-4 h-4" />
                              {t("account.orders.item_count", { count: order.itemCount })}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <span className="font-black text-primary text-lg whitespace-nowrap">
                            {formatMoney(order.total)}
                          </span>
                          <ChevronRight className="w-5 h-5 text-muted-foreground rtl:rotate-180" />
                        </div>
                      </div>

                      {order.items.length > 0 && (
                        <div className="flex items-center gap-2 mt-4">
                          {order.items.map((item, itemIndex) => (
                            <div
                              key={`${item.id}-${itemIndex}`}
                              className="relative w-12 h-12 rounded-xl overflow-hidden bg-secondary border border-border shrink-0"
                              title={`${item.name} × ${item.quantity}`}
                            >
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt={item.name}
                                  loading="lazy"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                  <Package className="w-5 h-5" />
                                </div>
                              )}
                              {item.quantity > 1 && (
                                <span className="absolute bottom-0 end-0 bg-primary text-primary-foreground text-[10px] font-black px-1.5 rounded-ss">
                                  ×{item.quantity}
                                </span>
                              )}
                            </div>
                          ))}
                          {order.itemCount > order.items.length && (
                            <span className="text-xs font-bold text-muted-foreground ps-1">
                              +{order.itemCount - order.items.length}
                            </span>
                          )}
                        </div>
                      )}

                      <span className="sr-only">
                        {t("account.orders.view_details", "Voir les détails")}
                      </span>
                    </button>
                  </motion.li>
                );
              })}
            </ul>
          )}
        </motion.section>

        {/* ---------------------------------------------------- notifications
            Below the orders: each entry is an event in the life of one of the
            orders listed just above, and links back to that order's page. */}
        <NotificationsSection />
      </div>

      <Footer />
    </div>
  );
}

function ProfileField({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="bg-secondary/50 rounded-xl p-4" data-testid="profile-field">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <p className="font-bold mt-1.5 truncate" title={value ?? undefined}>
        {value || "—"}
      </p>
    </div>
  );
}