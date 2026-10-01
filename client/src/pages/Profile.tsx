import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SiteBackground } from "@/components/SiteBackground";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { 
  Loader2, ChevronLeft, User, Mail, Phone, Save, 
  KeyRound, IdCard, Calendar, ShieldCheck, Globe
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter 
} from "@/components/ui/dialog";

export default function Profile() {
  const { user, isLoading: loadingUser } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Profile form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // Password change dialog
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

// Vérifier si l'utilisateur est connecté via Google
  const isGoogleUser = user?.googleId !== null && user?.googleId !== undefined;
  // hasPassword est envoyé par le serveur (car le password est supprimé par sanitizeUser)
   const hasPassword = (user as any)?.hasPassword === true;

  useEffect(() => {
    if (user) {
      setFullName(user.fullName || "");
      setPhone(user.phone || "");
      setEmail(user.email || "");
    }
  }, [user]);

  // Profile update mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: { fullName: string; phone: string; email: string }) => {
      const res = await apiRequest("PATCH", "/api/user/profile", data);
      return res.json();
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(["/api/user"], updatedUser);
      toast({ title: "Profil mis à jour avec succès" });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Erreur", description: error.message });
    },
  });

  // Password change mutation
  const changePasswordMutation = useMutation({
    mutationFn: async (data: { oldPassword: string; newPassword: string }) => {
      await apiRequest("POST", "/api/user/change-password", data);
    },
    onSuccess: () => {
      toast({ title: "Mot de passe modifié avec succès" });
      setPasswordDialogOpen(false);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Erreur", description: error.message });
    },
  });

  // Mutation pour définir un mot de passe pour les utilisateurs Google
  const setPasswordMutation = useMutation({
    mutationFn: async (data: { newPassword: string }) => {
      await apiRequest("POST", "/api/user/set-password", data);
    },
    onSuccess: () => {
      toast({ title: "Mot de passe créé avec succès" });
      setPasswordDialogOpen(false);
      setNewPassword("");
      setConfirmPassword("");
      // Rafraîchir les données utilisateur
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Erreur", description: error.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMutation.mutate({ fullName, phone, email });
  };

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      return toast({ variant: "destructive", title: "Erreur", description: "Les mots de passe ne correspondent pas" });
    }
    if (newPassword.length < 6) {
      return toast({ variant: "destructive", title: "Erreur", description: "Le mot de passe doit contenir au moins 6 caractères" });
    }
    
    if (isGoogleUser && !hasPassword) {
      // L'utilisateur Google n'a pas de mot de passe, on le crée
      setPasswordMutation.mutate({ newPassword });
    } else {
      // L'utilisateur a déjà un mot de passe, on le change
      changePasswordMutation.mutate({ oldPassword, newPassword });
    }
  };

  if (loadingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <SiteBackground />
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    setLocation("/login?redirect=/profile");
    return null;
  }

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
              Retour à l'accueil
            </button>
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-white">
                <User className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-4xl font-display font-bold mb-2">Mon Profil</h1>
                <p className="text-blue-100 text-lg">
                  Gérez vos informations personnelles et votre mot de passe.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-8">
        {/* Google Account Banner */}
        {isGoogleUser && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >       
          </motion.div>
        )}

        {/* Profile Information */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="rounded-[2.5rem] border-slate-100 shadow-xl overflow-hidden bg-white/80 backdrop-blur-md">
            <CardHeader className="border-b border-slate-100 pb-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                  <IdCard className="w-6 h-6" />
                </div>
                <div>
                  <CardTitle className="text-2xl font-display font-bold text-slate-900">
                    Informations personnelles
                  </CardTitle>
                  <CardDescription className="text-slate-500">
                    Mettez à jour vos coordonnées
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  {/* Username (read-only) */}
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-bold">Identifiant</Label>
                    <div className="relative">
                      <User className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        value={user.username}
                        disabled
                        className="ps-10 bg-slate-50 border-slate-200 text-slate-500 cursor-not-allowed"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400">L'identifiant ne peut pas être modifié</p>
                  </div>

                  {/* Full Name */}
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-bold">Nom complet</Label>
                    <div className="relative">
                      <IdCard className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Votre nom complet"
                        className="ps-10 h-12 bg-white border-slate-200 focus:ring-primary/20"
                      />
                    </div>
                  </div>

                  {/* Email */}
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-bold">Email</Label>
                    <div className="relative">
                      <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="votre@email.com"
                        className="ps-10 h-12 bg-white border-slate-200 focus:ring-primary/20"
                      />
                    </div>
                  </div>

                  {/* Phone */}
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-bold">Téléphone</Label>
                    <div className="relative">
                      <Phone className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+212 6 XX XX XX XX"
                        className="ps-10 h-12 bg-white border-slate-200 focus:ring-primary/20"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 pt-4 border-t border-slate-100">
                  <Button
                    type="submit"
                    className="h-12 px-8 font-bold rounded-xl shadow-lg shadow-primary/20"
                    disabled={updateProfileMutation.isPending}
                  >
                    {updateProfileMutation.isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin me-2" />
                    ) : (
                      <Save className="w-5 h-5 me-2" />
                    )}
                    Enregistrer les modifications
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>

{/* Security Section - Password Management (caché pour les utilisateurs Google) */}
        {!isGoogleUser && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="rounded-[2.5rem] border-slate-100 shadow-xl overflow-hidden bg-white/80 backdrop-blur-md">
              <CardHeader className="border-b border-slate-100 pb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                    <KeyRound className="w-6 h-6" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl font-display font-bold text-slate-900">
                      Sécurité
                    </CardTitle>
                    <CardDescription className="text-slate-500">
                      Modifiez votre mot de passe
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-8">
                <Button
                  onClick={() => setPasswordDialogOpen(true)}
                  className="h-12 px-8 font-bold rounded-xl"
                  variant="outline"
                >
                  <KeyRound className="w-5 h-5 me-2" />
                  Changer mon mot de passe
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Account Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="rounded-[2.5rem] border-slate-100 shadow-xl overflow-hidden bg-white/80 backdrop-blur-md">
            <CardHeader className="border-b border-slate-100 pb-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-500">
                  <User className="w-6 h-6" />
                </div>
                <div>
                  <CardTitle className="text-2xl font-display font-bold text-slate-900">
                    Informations du compte
                  </CardTitle>
                  <CardDescription className="text-slate-500">
                    Détails de votre compte
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-8">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="bg-slate-50 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-green-600" />
                    <div>
                      <p className="text-sm font-bold text-slate-700">Rôle</p>
                      <p className="text-sm text-slate-500 capitalize">{user.role || "client"}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <Calendar className="w-5 h-5 text-slate-600" />
                    <div>
                      <p className="text-sm font-bold text-slate-700">Membre depuis</p>
                      <p className="text-sm text-slate-500">
                        {user.id ? `#${user.id}` : "—"}
                      </p>
                    </div>
                  </div>
                </div>
                {isGoogleUser && (
                  <div className="bg-blue-50 rounded-xl p-4 md:col-span-2">
                    <div className="flex items-center gap-3">
                      <Globe className="w-5 h-5 text-blue-600" />
                      <div>
                        <p className="text-sm font-bold text-blue-700">Compte Google</p>
                        <p className="text-sm text-blue-600">
                          Connecté via Google OAuth
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Password Change / Set Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="bg-white rounded-[2rem] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-display font-bold text-slate-900">
              {isGoogleUser && !hasPassword ? "Créer un mot de passe" : "Changer le mot de passe"}
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              {isGoogleUser && !hasPassword 
                ? "Définissez un mot de passe pour vous connecter également avec un identifiant classique."
                : "Entrez votre mot de passe actuel et votre nouveau mot de passe."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePasswordChange} className="space-y-4 py-4">
            {/* Champ ancien mot de passe - caché pour les utilisateurs Google sans mot de passe */}
            {(!isGoogleUser || hasPassword) && (
              <div className="space-y-2">
                <Label className="text-slate-700 font-bold">Mot de passe actuel</Label>
                <Input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  required={!isGoogleUser || hasPassword}
                  placeholder="••••••••"
                  className="h-12 bg-slate-50 border-slate-200"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-slate-700 font-bold">
                {isGoogleUser && !hasPassword ? "Nouveau mot de passe" : "Nouveau mot de passe"}
              </Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="h-12 bg-slate-50 border-slate-200"
              />
              {newPassword.length > 0 && newPassword.length < 6 && (
                <p className="text-xs text-red-500 font-medium">Minimum 6 caractères</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-slate-700 font-bold">Confirmer le nouveau mot de passe</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="h-12 bg-slate-50 border-slate-200"
              />
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <p className="text-xs text-red-500 font-medium">Les mots de passe ne correspondent pas</p>
              )}
            </div>
            <DialogFooter className="pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPasswordDialogOpen(false)}
                className="rounded-xl"
              >
                Annuler
              </Button>
              <Button
                type="submit"
                className="rounded-xl font-bold"
                disabled={
                  (isGoogleUser && !hasPassword 
                    ? setPasswordMutation.isPending 
                    : changePasswordMutation.isPending) ||
                  newPassword !== confirmPassword ||
                  newPassword.length < 6
                }
              >
                {(isGoogleUser && !hasPassword ? setPasswordMutation.isPending : changePasswordMutation.isPending) ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  isGoogleUser && !hasPassword ? "Créer le mot de passe" : "Modifier le mot de passe"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
}