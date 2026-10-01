import { createContext, ReactNode, useContext } from "react";
import {
    useQuery,
    useMutation,
    UseMutationResult,
} from "@tanstack/react-query";
import { User, InsertUser, LoginCredentials } from "@shared/schema";
import { apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import i18n from "@/lib/i18n";

type AuthContextType = {
    user: User | null;
    isLoading: boolean;
    error: Error | null;
    loginMutation: UseMutationResult<User, Error, LoginCredentials>;
    logoutMutation: UseMutationResult<void, Error, void>;
    registerMutation: UseMutationResult<User, Error, InsertUser>;
};

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const { toast } = useToast();
    const {
        data: user,
        error,
        isLoading,
    } = useQuery<User | null, Error>({
        queryKey: ["/api/user"],
        queryFn: async () => {
            try {
                const res = await fetch("/api/user", { credentials: "include" });
                if (res.status === 401) return null;
                if (!res.ok) throw new Error("Failed to fetch user");
                return await res.json();
            } catch (e) {
                return null;
            }
        },
    });

    const loginMutation = useMutation({
        mutationFn: async (credentials: LoginCredentials) => {
            const res = await apiRequest("POST", "/api/login", credentials);
            return await res.json();
        },
        onSuccess: (user: User) => {
            queryClient.setQueryData(["/api/user"], user);
        },
        onError: (error: Error) => {
            toast({
                title: i18n.t("auth.login_failed", "Échec de la connexion"),
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const registerMutation = useMutation({
        mutationFn: async (credentials: InsertUser) => {
            const res = await apiRequest("POST", "/api/register", credentials);
            return await res.json();
        },
        onSuccess: (user: User) => {
            queryClient.setQueryData(["/api/user"], user);
        },
        onError: (error: Error) => {
            toast({
                title: i18n.t("auth.registration_failed", "Échec de l'inscription"),
                description: error.message,
                variant: "destructive",
            });
        },
    });

    const logoutMutation = useMutation({
        mutationFn: async () => {
            await apiRequest("POST", "/api/logout");
        },
        onSuccess: () => {
            queryClient.setQueryData(["/api/user"], null);
        },
        onError: (error: Error) => {
            toast({
                title: i18n.t("auth.logout_failed", "Échec de la déconnexion"),
                description: error.message,
                variant: "destructive",
            });
        },
    });

    return (
        <AuthContext.Provider
            value={{
                user: user ?? null,
                isLoading,
                error,
                loginMutation,
                logoutMutation,
                registerMutation,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
