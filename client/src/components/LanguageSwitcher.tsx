import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function LanguageSwitcher() {
    const { i18n } = useTranslation();

    const languages = [
        { code: "fr", name: "Français", flag: "/flags/france.jpg" },
        { code: "en", name: "English", flag: "/flags/angleterre.jpg" },
        { code: "ar", name: "العربية", flag: "/flags/tunisia.jpg" },
    ];

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="w-12 h-12 rounded-full flex items-center justify-center overflow-hidden border-2 border-primary/10 hover:border-primary/50 transition-all duration-300">
                    {(() => {
                        const current = languages.find((l) => i18n.language?.startsWith(l.code)) || languages[0];
                        return (
                            <img
                                src={current.flag}
                                alt={current.name}
                                className="w-8 h-8 rounded-full object-cover shadow-sm bg-slate-100"
                                onError={(e) => {
                                    // Fallback for missing images
                                    (e.target as HTMLImageElement).src = "https://flagcdn.com/w80/" + (current.code === "en" ? "gb" : current.code === "ar" ? "tn" : "fr") + ".png";
                                }}
                            />
                        );
                    })()}
                    <span className="sr-only">Toggle language</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl p-1 min-w-[180px] max-h-[250px] overflow-y-auto animate-in fade-in zoom-in duration-200 shadow-lg border border-slate-200 bg-white dark:bg-gray-800">
                {languages.map((lang) => (
                    <DropdownMenuItem
                        key={lang.code}
                        onClick={() => i18n.changeLanguage(lang.code)}
                        className={`flex items-center gap-3 cursor-pointer rounded-lg p-2 transition-colors ${i18n.language.startsWith(lang.code) ? "bg-primary/10 text-primary" : "hover:bg-slate-100"}`}
                    >
                        <img
                            src={lang.flag}
                            alt={lang.name}
                            className="w-6 h-6 rounded-full object-cover border border-slate-200"
                        />
                        <span className="font-semibold text-sm">{lang.name}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
