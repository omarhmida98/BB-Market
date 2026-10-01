// hooks/use-my-orders.ts
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import type { CustomerOrder } from "@shared/orders";

/**
 * The customer's own orders.
 *
 * Ownership is decided by the server: `GET /api/my-orders` filters on `user_id`
 * in SQL, and `GET /api/my-orders/:id` is a single owner-scoped query that
 * answers 404 for someone else's order. Nothing here can widen that, because no
 * user id is ever sent — the session cookie identifies the caller.
 *
 * `enabled: !!user` matters: without it these fire on the public pages too and
 * every anonymous visitor collects a 401.
 */
async function fetchMyOrders(): Promise<CustomerOrder[]> {
  const response = await fetch("/api/my-orders", { credentials: "include" });
  if (response.status === 401) return [];
  if (!response.ok) throw new Error("Failed to fetch orders");
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export function useMyOrders() {
  const { user } = useAuth();
  return useQuery<CustomerOrder[]>({
    queryKey: ["/api/my-orders"],
    queryFn: fetchMyOrders,
    enabled: !!user,
    staleTime: 30000,
  });
}

async function fetchMyOrder(id: number): Promise<CustomerOrder> {
  const response = await fetch(`/api/my-orders/${id}`, { credentials: "include" });
  if (response.status === 404) {
    // Same class of problem as a deleted order: the customer cannot see it. The
    // detail page renders a "not found" state rather than an error toast, so this
    // is a value and not a thrown error.
    throw new MyOrderNotFoundError();
  }
  if (response.status === 401) throw new Error("unauthorized");
  if (!response.ok) throw new Error("Failed to fetch order");
  return response.json();
}

export class MyOrderNotFoundError extends Error {
  constructor() {
    super("Order not found");
    this.name = "MyOrderNotFoundError";
  }
}

export function useMyOrder(id: number | null) {
  const { user } = useAuth();
  return useQuery<CustomerOrder>({
    queryKey: ["/api/my-orders", id],
    queryFn: () => fetchMyOrder(id as number),
    enabled: !!user && !!id,
    retry: false,
  });
}