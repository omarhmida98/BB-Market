import { useState, useRef, useEffect } from "react";
import { Bell, X, Clock, CheckCircle, MessageSquare } from "lucide-react";
import { useNotifications, type NotificationItem } from "@/hooks/use-notifications";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

export function NotificationDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { count, items } = useNotifications();
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  // Naviguer vers une section de l'admin.
  // NB: wouter retire la query string de la location, donc on utilise aussi un
  // événement DOM personnalisé que la page Admin écoute pour changer de section.
  const navigateAdminSection = (section: string) => {
    window.dispatchEvent(new CustomEvent("admin:navigate", { detail: { section } }));
    setLocation(`/admin?section=${section}`);
  };

  const handleItemClick = (item: NotificationItem) => {
    setIsOpen(false);

    // Admin: naviguer vers la section correspondante selon le type de notification
    if (user?.role === "admin" || user?.role === "superadmin") {
      if (item.type === "message") {
        // Afficher uniquement le message dans une fenêtre modale
        window.dispatchEvent(new CustomEvent("admin:show-message", { detail: { id: item.id } }));
        navigateAdminSection("messages");
      } else if (item.type === "stock_alert" || item.type === "out_of_stock") {
        navigateAdminSection("stock");
      } else if (item.link && item.link !== "#" && item.link !== "/admin") {
        setLocation(item.link);
      } else {
        navigateAdminSection("messages");
      }
      return;
    }

    // Utilisateur classique
    if (item.link && item.link !== "#") {
      setLocation(item.link);
    } else {
      setLocation("/my-history");
    }
  };

  const handleViewAll = () => {
    setIsOpen(false);
    if (user?.role === "admin" || user?.role === "superadmin") {
      // Admins: naviguer vers la section Messages du panneau d'administration
      navigateAdminSection("messages");
    } else {
      setLocation("/my-history");
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "message":
        return <MessageSquare className="w-3.5 h-3.5" />;
      case "status_change":
        return <CheckCircle className="w-3.5 h-3.5" />;
      default:
        return <Clock className="w-3.5 h-3.5" />;
    }
  };

  const getTimeAgo = (dateStr: Date | string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "À l'instant";
    if (diffMins < 60) return `Il y a ${diffMins} min`;
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-muted-foreground hover:text-primary transition-colors rounded-full hover:bg-primary/5"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[9px] font-bold border-2 border-white animate-in zoom-in-50 duration-300">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute end-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-50 animate-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-primary/5 to-transparent">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Notifications</h3>
              <p className="text-[11px] text-slate-500">
                {count > 0 ? `${count} non ${count > 1 ? "lues" : "lue"}` : ""}
              </p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-300 mb-3">
                  <Bell className="w-6 h-6" />
                </div>
                <p className="text-sm font-medium text-slate-500">Aucune notification</p>
                <p className="text-xs text-slate-400 mt-1">Vous serez notifié en cas de nouvelle activité.</p>
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={`${item.type}-${item.id}`}
                  onClick={() => handleItemClick(item)}
                  className={`w-full flex items-start gap-3 px-4 py-3.5 text-start hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-b-0 ${
                    !item.read ? "bg-primary/[0.02]" : ""
                  }`}
                >
                  {/* Icon */}
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    !item.read 
                      ? "bg-primary/10 text-primary" 
                      : "bg-slate-100 text-slate-400"
                  }`}>
                    {getTypeIcon(item.type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!item.read ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}>
                      {item.title}
                    </p>
                    {item.description && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.description}</p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1.5 font-medium">
                      {getTimeAgo(item.createdAt)}
                    </p>
                  </div>

                  {/* Unread dot */}
                  {!item.read && (
                    <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div className="border-t border-slate-100 p-2">
              <button
                onClick={handleViewAll}
                className="w-full py-2.5 text-center text-sm font-bold text-primary hover:bg-primary/5 rounded-xl transition-colors"
              >
               Marquer toutes comme lues
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

