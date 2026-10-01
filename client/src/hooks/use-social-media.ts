import { useQuery } from "@tanstack/react-query";
import type { SocialMediaEmbed, SocialPlatform } from "@shared/schema";

async function fetchSocialMedia(): Promise<SocialMediaEmbed[]> {
  const response = await fetch("/api/social-media");
  if (!response.ok) {
    throw new Error("Failed to fetch social media links");
  }
  return response.json();
}

export function useSocialMedia() {
  return useQuery({
    queryKey: ["/api/social-media"],
    queryFn: fetchSocialMedia,
    // Public page content: keep it fresh but avoid refetching on every focus.
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

/** Resolves the saved URL for a platform, or null when nothing is configured. */
export function useSocialUrl(platform: SocialPlatform): string | null {
  const { data } = useSocialMedia();
  const row = (data || []).find((item) => item.platform === platform);
  const url = row?.url?.trim();
  return url ? url : null;
}
