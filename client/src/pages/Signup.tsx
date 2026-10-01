import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema, type InsertUser } from "@shared/schema";
import { z } from "zod";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Loader2,
  ShieldCheck,
  Sparkles,
  User,
  Mail,
  Lock,
  Phone,
  UserPlus,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";

import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SiteBackground } from "@/components/SiteBackground";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

type SignupFormValues = InsertUser & { confirmPassword: string };

const benefits = [
  {
    title: "Quote-ready account",
    description: "Save your information and move faster from selection to request.",
    icon: BadgeCheck,
  },
  {
    title: "Better follow-up",
    description: "Keep your orders and conversations connected to one account.",
    icon: BriefcaseBusiness,
  },
  {
    title: "Priority flow",
    description: "A cleaner path for returning customers and business requests.",
    icon: ShieldCheck,
  },
];

export default function Signup() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, registerMutation } = useAuth();
  const [, setLocation] = useLocation();
  const redirectTo = new URLSearchParams(window.location.search).get("redirect") || "/contact";

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(
      insertUserSchema.extend({
        fullName: z.string().min(1, "Nom complet requis"),
        phone: z.string().min(8, "Numéro de téléphone invalide"),
        confirmPassword: z.string().min(1, "Mot de passe requis"),
      }),
    ),
    defaultValues: {
      username: "",
      email: "",
      fullName: "",
      phone: "",
      password: "",
      confirmPassword: "",
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  useEffect(() => {
    if (user) {
      setLocation(redirectTo);
    }
  }, [user, redirectTo, setLocation]);

  const onSubmit = (data: SignupFormValues) => {
    if (data.password !== data.confirmPassword) {
      toast({
        variant: "destructive",
        title: t("auth.signup_error_title"),
        description: t("auth.password_mismatch"),
      });
      return;
    }

    registerMutation.mutate(
      {
        username: data.username,
        email: data.email,
        fullName: data.fullName,
        phone: data.phone,
        password: data.password,
      },
      {
        onSuccess: () => {
          toast({
            title: t("auth.signup_success_title"),
            description: t("auth.signup_success_desc"),
          });
          setLocation(redirectTo);
        },
      },
    );
  };

  const usernameErrorId = useMemo(() => (errors.username ? "signup-username-error" : undefined), [errors.username]);
  const emailErrorId = useMemo(() => (errors.email ? "signup-email-error" : undefined), [errors.email]);
  const passwordErrorId = useMemo(() => (errors.password ? "signup-password-error" : undefined), [errors.password]);
  const confirmErrorId = useMemo(() => (errors.confirmPassword ? "signup-confirm-error" : undefined), [errors.confirmPassword]);

  return (
    <div className="min-h-screen font-sans relative overflow-hidden">
      <SiteBackground />
      <Navbar />

      <div className="relative pt-32 pb-20 lg:pt-36 lg:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-10 xl:gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="space-y-8"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-white/70 backdrop-blur px-4 py-2 text-sm font-semibold text-primary shadow-sm">
                <Sparkles className="h-4 w-4" />
                {t("auth.signup_badge")}
              </div>

              <div className="space-y-5 max-w-xl">
                <h1 className="text-4xl sm:text-5xl xl:text-6xl font-display font-extrabold text-slate-900 leading-[1.05] tracking-tight">
                  {t("auth.signup_title")}
                </h1>
                <p className="text-lg text-slate-600 leading-relaxed max-w-2xl">
                  {t("auth.signup_desc")}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {benefits.map((benefit) => {
                  const Icon = benefit.icon;
                  return (
                    <div
                      key={benefit.title}
                      className="rounded-2xl border border-white/70 bg-white/75 backdrop-blur-md p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
                    >
                      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">{benefit.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{benefit.description}</p>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-sm text-slate-600 max-w-xl">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{t("auth.signup_security_note", "Accounts are created through a clean, secure registration flow.")}</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1, duration: 0.55, ease: "easeOut" }}
              className="relative"
            >
              <div className="absolute -inset-4 rounded-[2.75rem] bg-gradient-to-r from-primary/15 via-sky-400/10 to-cyan-500/10 blur-2xl" />
              <div className="relative overflow-hidden rounded-[2.5rem] border border-white/60 bg-white/85 backdrop-blur-xl shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
                <div className="h-2 bg-gradient-to-r from-primary via-sky-400 to-cyan-400" />

                <div className="p-8 sm:p-10">
                  <div className="mb-8 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary/70">
                        {t("auth.signup_badge")}
                      </p>
                      <h2 className="mt-2 text-2xl font-display font-bold text-slate-900">
                        {t("auth.signup_button")}
                      </h2>
                    </div>

                    <div className="hidden sm:flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/20">
                      <UserPlus className="h-5 w-5" />
                    </div>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">{t("auth.username_label")}</label>
                      <div className="relative">
                        <User className="absolute start-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        <input
                          {...register("username")}
                          autoComplete="username"
                          aria-invalid={!!errors.username}
                          aria-describedby={usernameErrorId}
                          className={`w-full rounded-2xl border bg-slate-50 px-11 pe-5 py-3.5 text-slate-900 transition-all placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10 ${
                            errors.username
                              ? "border-red-300 focus:border-red-400"
                              : "border-slate-200 focus:border-primary"
                          }`}
                          placeholder={t("auth.username_placeholder")}
                        />
                      </div>
                      {errors.username && <p id="signup-username-error" className="text-sm text-red-600">{errors.username.message as string}</p>}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">{t("auth.full_name_label")}</label>
                      <div className="relative">
                        <User className="absolute start-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        <input
                          {...register("fullName")}
                          autoComplete="name"
                          aria-invalid={!!errors.fullName}
                          className={`w-full rounded-2xl border bg-slate-50 px-11 pe-5 py-3.5 text-slate-900 transition-all placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10 ${
                            errors.fullName
                              ? "border-red-300 focus:border-red-400"
                              : "border-slate-200 focus:border-primary"
                          }`}
                          placeholder={t("auth.full_name_placeholder")}
                        />
                      </div>
                      {errors.fullName && <p className="text-sm text-red-600">{errors.fullName.message as string}</p>}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">{t("auth.phone_label")}</label>
                      <div className="relative">
                        <Phone className="absolute start-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        <input
                          {...register("phone")}
                          autoComplete="tel"
                          aria-invalid={!!errors.phone}
                          className={`w-full rounded-2xl border bg-slate-50 px-11 pe-5 py-3.5 text-slate-900 transition-all placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10 ${
                            errors.phone
                              ? "border-red-300 focus:border-red-400"
                              : "border-slate-200 focus:border-primary"
                          }`}
                          placeholder={t("auth.phone_placeholder")}
                        />
                      </div>
                      {errors.phone && <p className="text-sm text-red-600">{errors.phone.message as string}</p>}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">{t("auth.email_label")}</label>
                      <div className="relative">
                        <Mail className="absolute start-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        <input
                          {...register("email")}
                          type="email"
                          autoComplete="email"
                          aria-invalid={!!errors.email}
                          aria-describedby={emailErrorId}
                          className={`w-full rounded-2xl border bg-slate-50 px-11 pe-5 py-3.5 text-slate-900 transition-all placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10 ${
                            errors.email
                              ? "border-red-300 focus:border-red-400"
                              : "border-slate-200 focus:border-primary"
                          }`}
                          placeholder={t("auth.email_placeholder")}
                        />
                      </div>
                      {errors.email && <p id="signup-email-error" className="text-sm text-red-600">{errors.email.message as string}</p>}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">{t("auth.password_label")}</label>
                      <div className="relative">
                        <Lock className="absolute start-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        <input
                          {...register("password")}
                          type="password"
                          autoComplete="new-password"
                          aria-invalid={!!errors.password}
                          aria-describedby={passwordErrorId}
                          className={`w-full rounded-2xl border bg-slate-50 px-11 pe-5 py-3.5 text-slate-900 transition-all placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10 ${
                            errors.password
                              ? "border-red-300 focus:border-red-400"
                              : "border-slate-200 focus:border-primary"
                          }`}
                          placeholder={t("auth.password_placeholder")}
                        />
                      </div>
                      {errors.password && <p id="signup-password-error" className="text-sm text-red-600">{errors.password.message as string}</p>}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">{t("auth.confirm_password_label")}</label>
                      <div className="relative">
                        <Lock className="absolute start-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        <input
                          {...register("confirmPassword")}
                          type="password"
                          autoComplete="new-password"
                          aria-invalid={!!errors.confirmPassword}
                          aria-describedby={confirmErrorId}
                          className={`w-full rounded-2xl border bg-slate-50 px-11 pe-5 py-3.5 text-slate-900 transition-all placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10 ${
                            errors.confirmPassword
                              ? "border-red-300 focus:border-red-400"
                              : "border-slate-200 focus:border-primary"
                          }`}
                          placeholder={t("auth.confirm_password_placeholder")}
                        />
                      </div>
                      {errors.confirmPassword && <p id="signup-confirm-error" className="text-sm text-red-600">{errors.confirmPassword.message as string}</p>}
                    </div>

                    <button
                      type="submit"
                      disabled={registerMutation.isPending}
                      className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-4 font-bold text-white shadow-[0_16px_40px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-0.5 hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-900/10 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                    >
                      {registerMutation.isPending ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" /> {t("auth.signuping")}
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-5 w-5" /> {t("auth.signup_button")}
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </button>

                    <div className="flex items-center gap-3 py-1 text-xs font-medium text-slate-400">
                      <div className="h-px flex-1 bg-slate-200" />
                      <span>ou</span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>

                    <GoogleSignInButton onAuthenticated={() => setLocation(redirectTo)} />

                    <div className="pt-2 text-center text-sm text-slate-600">
                      <span>{t("auth.have_account")}</span>{" "}
                      <Link href="/login" className="font-bold text-primary hover:underline">
                        {t("auth.login")}
                      </Link>
                    </div>
                  </form>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
