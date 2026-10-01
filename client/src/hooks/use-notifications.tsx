import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";

export type NotificationItem = {
  id: number;
  type: string;
  title: string;
  description: string;
  createdAt: Date | string | null;
  read: boolean;
  link: string;
};

type NotificationsResponse = {
  count: number;
  items: NotificationItem[];
};

export function useNotifications() {
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery<NotificationsResponse>({
    queryKey: ["/api/notifications", user?.id, user?.role],
    queryFn: async () => {
      const response = await fetch("/api/notifications", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch notifications");
      return await response.json();
    },
    enabled: !!user,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  return {
    count: data?.count ?? 0,
    items: data?.items ?? [],
    isLoading,
    error,
  };
}

