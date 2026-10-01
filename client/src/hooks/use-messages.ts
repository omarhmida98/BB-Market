import { useMutation } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { InsertMessage } from "@shared/schema";
import i18n from "@/lib/i18n";

export function useSendMessage() {
  return useMutation({
    mutationFn: async (data: InsertMessage) => {
      const res = await fetch(api.messages.create.path, {
        method: api.messages.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error((await res.text()) || i18n.t("contact.login_required", "Veuillez vous connecter pour passer une commande."));
        }
        if (res.status === 400) {
          const error = api.messages.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to send message");
      }

      return api.messages.create.responses[201].parse(await res.json());
    },
  });
}
