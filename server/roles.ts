/**
 * Single source of truth for role assignment.
 *
 * Why this module exists
 * ----------------------
 * Role promotion used to be decided in five separate places, including a
 * hardcoded list of owner email addresses checked on the public registration
 * endpoint. That combination meant anyone could claim an owner address through
 * an unauthenticated POST and receive `superadmin`, because /api/register never
 * verifies that the caller owns the email address it is given.
 *
 * All promotion now happens in exactly two places:
 *   1. `server/seed-admin.ts`, run from a shell before launch.
 *   2. `POST /api/admin/users`, which requires an authenticated superadmin.
 *
 * Everything reachable without authentication resolves to a non-privileged
 * role, in every environment, with no exceptions.
 */

export type Role = "superadmin" | "admin" | "client";

export const PRIVILEGED_ROLES: ReadonlySet<Role> = new Set<Role>(["superadmin", "admin"]);

export const CUSTOMER_ROLE: Role = "client";

/** Evaluated at call time so tests and scripts can vary NODE_ENV per case. */
export function isProduction(): boolean {
    return process.env.NODE_ENV === "production";
}

/**
 * Developer convenience only: promote the very first account on an empty
 * database to `superadmin`.
 *
 * Hard-disabled in production. The `!isProduction()` check comes first and is
 * not overridable, so setting ALLOW_DEV_FIRST_USER_SUPERADMIN=1 on the VPS
 * cannot re-enable the behaviour.
 */
export function devFirstUserSuperadminEnabled(): boolean {
    if (isProduction()) return false;
    return process.env.ALLOW_DEV_FIRST_USER_SUPERADMIN === "1";
}

/**
 * Role for an account created through an unauthenticated endpoint
 * (POST /api/register, and the Google sign-in account auto-provisioning).
 *
 * Production always returns the customer role. Development returns
 * `superadmin` only for the first account, and only when explicitly opted in.
 */
export function resolvePublicRegistrationRole(options: { isFirstUser: boolean }): Role {
    if (devFirstUserSuperadminEnabled() && options.isFirstUser) {
        return "superadmin";
    }
    return CUSTOMER_ROLE;
}

/**
 * Normalises a role read from the database.
 *
 * A row with a missing role is treated as a customer, never as an admin. The
 * previous behaviour promoted null-role rows to `admin`, which turned any
 * incomplete insert into a privileged account.
 */
export function normaliseStoredRole(role: string | null | undefined): Role {
    if (role === "superadmin" || role === "admin" || role === "client") {
        return role;
    }
    return CUSTOMER_ROLE;
}

export function isPrivilegedRole(role: string | null | undefined): boolean {
    return PRIVILEGED_ROLES.has(normaliseStoredRole(role) as Role);
}
