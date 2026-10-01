import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import {
  Clock,
  CheckCircle2,
  PackageCheck,
  ShoppingBag,
  Store,
  XCircle,
  Truck,
  CircleDot,
} from "lucide-react";
import { ORDER_STATUS_FLOW, orderFlowIndex, type OrderStatus } from "@shared/orders";
import type { FulfillmentMethod } from "@shared/schema";

/**
 * Visual progress of an order.
 *
 * The one rule that matters: a cancelled order never renders the remaining steps
 * as completed, reached or upcoming. It shows the single cancelled state instead,
 * because "Livrée" with a red badge next to it would be a lie the customer acts
 * on. `cancelled` is therefore not part of `ORDER_STATUS_FLOW` at all.
 *
 * For pickup orders the last step is labelled "Collected" rather than
 * "Delivered", since nothing is ever shipped to the customer.
 */
export function OrderStatusTimeline({
  status,
  fulfillmentMethod,
}: {
  status: OrderStatus | "unknown";
  fulfillmentMethod: FulfillmentMethod;
}) {
  const { t } = useTranslation();
  const isPickup = fulfillmentMethod === "pickup";

  if (status === "cancelled") {
    return (
      <div
        className="flex items-start gap-4 rounded-2xl border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30 p-5"
        data-testid="order-timeline-cancelled"
      >
        <span className="shrink-0 w-11 h-11 rounded-full bg-red-500 text-white flex items-center justify-center">
          <XCircle className="h-6 w-6" />
        </span>
        <div>
          <p className="font-bold text-red-700 dark:text-red-300">
            {t("account.status.cancelled", "Annulée")}
          </p>
          <p className="text-sm text-red-600/90 dark:text-red-400/90 mt-1">
            {t(
              "account.status.cancelled_hint",
              "Cette commande a été annulée. Elle ne sera pas préparée ni livrée.",
            )}
          </p>
        </div>
      </div>
    );
  }

  // An unknown status is not rendered as a step: inventing a position for it
  // would claim progress the store never recorded.
  if (status === "unknown") {
    return (
      <div
        className="flex items-start gap-4 rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30 p-5"
        data-testid="order-timeline-unknown"
      >
        <span className="shrink-0 w-11 h-11 rounded-full bg-amber-500 text-white flex items-center justify-center">
          <CircleDot className="h-6 w-6" />
        </span>
        <div>
          <p className="font-bold text-amber-700 dark:text-amber-300">
            {t("account.status.unknown", "Statut inconnu")}
          </p>
          <p className="text-sm text-amber-700/90 dark:text-amber-400/90 mt-1">
            {t(
              "account.status.unknown_hint",
              "Contactez-nous et nous vous donnerons plus d'informations sur cette commande.",
            )}
          </p>
        </div>
      </div>
    );
  }

  const currentIndex = orderFlowIndex(status);

  const icons = {
    pending: Clock,
    confirmed: CheckCircle2,
    preparing: PackageCheck,
    // Pickup ends at "ready": the step means "waiting to be collected", and the
    // final "delivered" row becomes "collected".
    ready: Store,
    delivered: isPickup ? ShoppingBag : Truck,
  };

  const labelFor = (step: (typeof ORDER_STATUS_FLOW)[number]) => {
    if (step === "ready") {
      return isPickup
        ? t("account.timeline.ready_pickup", "Prête au retrait")
        : t("account.timeline.ready", "Prête");
    }
    if (step === "delivered") {
      return isPickup
        ? t("account.timeline.delivered_pickup", "Collectée")
        : t("account.timeline.delivered", "Livrée");
    }
    return t(`account.timeline.${step}`);
  };

  return (
    <ol className="space-y-0" data-testid="order-timeline">
      {ORDER_STATUS_FLOW.map((step, index) => {
        const Icon = icons[step];
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <motion.li
            key={step}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.06 }}
            className="flex gap-4"
            data-testid={`order-timeline-${step}`}
            data-state={isDone ? "done" : isCurrent ? "current" : "upcoming"}
          >
            <div className="flex flex-col items-center">
              <span
                className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center border-2 transition-colors ${
                  isDone
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : isCurrent
                      ? "bg-primary border-primary text-primary-foreground ring-4 ring-primary/20"
                      : "bg-background border-border text-muted-foreground"
                }`}
              >
                {isDone ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
              </span>
              {index < ORDER_STATUS_FLOW.length - 1 && (
                <span
                  className={`w-0.5 flex-1 min-h-8 my-1 rounded ${
                    isDone ? "bg-emerald-500" : "bg-border"
                  }`}
                  aria-hidden="true"
                />
              )}
            </div>

            <div className="pb-6 pt-2">
              <p
                className={`font-bold ${
                  isCurrent
                    ? "text-primary"
                    : isDone
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground"
                }`}
              >
                {labelFor(step)}
              </p>
              {isCurrent && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t("account.timeline.current_step", "Étape actuelle")}
                </p>
              )}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

/**
 * Compact status pill for list rows.
 *
 * Kept separate from the timeline because a list needs one word, and because a
 * pill can be read at a glance where a five-row timeline cannot.
 */
const STATUS_STYLES: Record<OrderStatus | "unknown", string> = {
  pending: "bg-amber-500 text-white",
  confirmed: "bg-blue-500 text-white",
  preparing: "bg-purple-500 text-white",
  ready: "bg-indigo-500 text-white",
  delivered: "bg-emerald-500 text-white",
  cancelled: "bg-red-500 text-white",
  unknown: "bg-slate-400 text-white",
};

export function OrderStatusBadge({
  status,
  fulfillmentMethod,
}: {
  status: OrderStatus | "unknown";
  fulfillmentMethod?: FulfillmentMethod;
}) {
  const { t } = useTranslation();
  const isPickup = fulfillmentMethod === "pickup";

  const label =
    status === "delivered" && isPickup
      ? t("account.timeline.delivered_pickup", "Collectée")
      : status === "unknown"
        ? t("account.status.unknown", "Statut inconnu")
        : t(`account.status.${status}`);

  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${STATUS_STYLES[status]}`}
      data-testid="order-status-badge"
    >
      {label}
    </span>
  );
}