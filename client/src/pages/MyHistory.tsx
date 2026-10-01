import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SiteBackground } from "@/components/SiteBackground";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { 
  Loader2, Clock, LogOut, MessagesSquare, CheckCircle, 
  Package, Trash2, KeyRound, History, User, ChevronLeft, UserPlus 
} from "lucide-react";

const activityTypeConfig: Record<string, { icon: any; labelKey: string; color: string }> = {
  login: { icon: LogOut, labelKey: "login", color: "text-green-500 bg-green-500/10 border-green-500/20" },
  logout: { icon: LogOut, labelKey: "logout", color: "text-red-400 bg-red-500/10 border-red-500/20" },
  register: { icon: UserPlus, labelKey: "register", color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
  quote_request: { icon: MessagesSquare, labelKey: "quote_request", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  status_change: { icon: CheckCircle, labelKey: "status_change", color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
  product_create: { icon: Package, labelKey: "product_create", color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
  product_delete: { icon: Trash2, labelKey: "product_delete", color: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
  password_change: { icon: KeyRound, labelKey: "password_change", color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20" },
  profile_update: { icon: User, labelKey: "profile_update", color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" },
};

export default function MyHistory() {
  const { t, i18n } = useTranslation();
  const { user, isLoading: loadingUser } = useAuth();
  const [, setLocation] = useLocation();

  const { data: activities, isLoading } = useQuery<any[]>({
    queryKey: ["/api/user/my-activities"],
    enabled: !!user,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
  const dateLocale = i18n.language.startsWith("ar") ? "ar-TN" : i18n.language.startsWith("en") ? "en-US" : "fr-FR";

  if (loadingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <SiteBackground />
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    setLocation("/login?redirect=/my-history");
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
              {t("history.back_home")}
            </button>
            <h1 className="text-4xl font-display font-bold mb-4">{t("history.title")}</h1>
            <p className="text-blue-100 text-lg">
              {t("history.description")}
            </p>
          </motion.div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {isLoading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
          </div>
        ) : !activities || activities.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-24 bg-white/70 backdrop-blur-md rounded-[2.5rem] border border-slate-100 shadow-xl"
          >
            <div className="bg-primary/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-primary">
              <History className="h-10 w-10" />
            </div>
            <h3 className="text-2xl font-display font-bold text-slate-900 mb-2">{t("history.empty_title")}</h3>
            <p className="text-slate-500 text-lg">
              {t("history.empty_description")}
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Stats summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-slate-100 p-5 text-center shadow-sm">
                <p className="text-2xl font-black text-slate-900">{activities.length}</p>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">{t("history.total")}</p>
              </div>
              <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-slate-100 p-5 text-center shadow-sm">
                <p className="text-2xl font-black text-green-600">{activities.filter(a => a.type === "login").length}</p>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">{t("history.logins")}</p>
              </div>
              <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-slate-100 p-5 text-center shadow-sm">
                <p className="text-2xl font-black text-blue-600">{activities.filter(a => a.type === "quote_request").length}</p>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">{t("history.quotes")}</p>
              </div>
              <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-slate-100 p-5 text-center shadow-sm">
                <p className="text-2xl font-black text-cyan-600">{activities.filter(a => a.type === "password_change").length}</p>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">{t("history.password")}</p>
              </div>
            </div>

            {/* Activity list */}
            <div className="bg-white/80 backdrop-blur-md rounded-[2.5rem] border border-slate-100 shadow-xl overflow-hidden">
              <div className="p-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                    <History className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">{t("history.recent_activities")}</h3>
                    <p className="text-sm text-slate-500">{t("history.chronological_list")}</p>
                  </div>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {activities.map((activity, index) => {
                  const cfg = activityTypeConfig[activity.type] || { 
                    icon: Clock, 
                    labelKey: activity.type, 
                    color: "text-slate-500 bg-slate-100 border-slate-200" 
                  };
                  const Icon = cfg.icon;

                  return (
                    <motion.div
                      key={activity.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03 }}
                      className="flex items-start gap-4 p-5 hover:bg-slate-50/50 transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${cfg.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900">{t(`history.activities.${cfg.labelKey}`, { defaultValue: cfg.labelKey })}</p>
                        <p className="text-sm text-slate-500 mt-0.5">{activity.details || ""}</p>
                      </div>
                      <div className="text-end shrink-0">
                        <p className="text-sm font-medium text-slate-600 whitespace-nowrap">
                          {activity.createdAt ? new Date(activity.createdAt).toLocaleDateString(dateLocale, {
                            day: '2-digit',
                            month: 'short',
                          }) : "—"}
                        </p>
                        <p className="text-[11px] text-slate-400 whitespace-nowrap">
                          {activity.createdAt ? new Date(activity.createdAt).toLocaleTimeString(dateLocale, {
                            hour: '2-digit',
                            minute: '2-digit'
                          }) : ""}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <Footer />
    </div>
  );
}

