import { CredentialResponse, GoogleLogin } from "@react-oauth/google";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type GoogleSignInButtonProps = {
  onAuthenticated: () => void;
};

export function GoogleSignInButton({ onAuthenticated }: GoogleSignInButtonProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);

  const handleSuccess = async (response: CredentialResponse) => {
    if (!response.credential) {
      toast({ variant: "destructive", title: t("auth.google_error_title", "Connexion Google impossible") });
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiRequest("POST", "/api/auth/google", { credential: response.credential });
      const user = await result.json();
      queryClient.setQueryData(["/api/user"], user);
      onAuthenticated();
    } catch (error) {
      toast({
        variant: "destructive",
        title: t("auth.google_error_title", "Connexion Google impossible"),
        description: error instanceof Error ? error.message : t("auth.google_error_retry", "Veuillez réessayer."),
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-10 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <GoogleLogin onSuccess={handleSuccess} onError={() => toast({ variant: "destructive", title: t("auth.google_error_cancelled", "Connexion Google annulée") })} />
    </div>
  );
}
