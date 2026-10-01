import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { OAuth2Client } from "google-auth-library";
import { Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage.js";
import { User as SelectUser } from "shared/schema.js";
import { sendWelcomeEmail } from "./email.js";
import { resolvePublicRegistrationRole } from "./roles.js";

const scryptAsync = promisify(scrypt);
const MemoryStore = createMemoryStore(session);

export async function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(supplied: string, stored: string | null | undefined) {
    if (typeof stored !== "string" || stored.length === 0) {
        console.error(`[DEBUG-AUTH] Mot de passe stocké invalide ou absent`);
        return false;
    }

    try {
        console.log(`[DEBUG-AUTH] Comparaison: Fourni (${supplied.length} chars) vs Stocké (${stored.length} chars)`);
        const [hashed, salt] = stored.split(".");
        if (!hashed || !salt || hashed.length !== 128) {
            console.error(`[DEBUG-AUTH] Format invalide !`);
            return false;
        }
        const hashedBuf = Buffer.from(hashed, "hex");
        if (hashedBuf.length !== 64) {
            console.error(`[DEBUG-AUTH] Hash invalide !`);
            return false;
        }
        const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
        const match = timingSafeEqual(hashedBuf, suppliedBuf);
        console.log(`[DEBUG-AUTH] Result: ${match ? 'MATCH' : 'NO_MATCH'}`);
        return match;
    } catch (err) {
        console.error(`[DEBUG-AUTH] Erreur lors de la comparaison des mots de passe:`, err);
        return false;
    }
}

export function setupAuth(app: Express) {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

    function sanitizeUser(user: SelectUser) {
        // Never send password hashes to the client
        // (keep it minimal: only remove password, but add hasPassword flag)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, ...safe } = user as any;
        // Indiquer si l'utilisateur a un mot de passe défini (utile pour les comptes Google)
        safe.hasPassword = !!password && password.length > 0;
        return safe;
    }

    // Fail fast: there is no safe default for a session signing secret.
    // Never log the value, only whether it was provided.
    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) {
        throw new Error(
            "SESSION_SECRET is required. Set it in .env for local development " +
            "(see .env.example) or in the production environment.",
        );
    }

    // Behind exactly one reverse proxy (Nginx on the OVH VPS), trust a single hop.
    //
    // Why this matters: the session cookie is `secure` in production, which means
    // Express only accepts it when `req.secure` is true. `req.secure` is derived
    // from the `X-Forwarded-Proto` header, and Express only honours that header
    // when `trust proxy` is enabled. Without this, login silently fails behind
    // HTTPS: the cookie is never issued.
    //
    // The value 1 means "trust the first proxy hop" (Nginx). Using `true` instead
    // would let a client spoof X-Forwarded-Proto and bypass the secure flag, so
    // it is deliberately NOT used.
    //
    // Development keeps `trust proxy` off: on localhost there is no proxy and
    // `req.secure` is already false, which is exactly what a dev cookie wants.
    if (app.get("env") === "production") {
        app.set("trust proxy", 1);
    } else {
        app.set("trust proxy", false);
    }

    const sessionSettings: session.SessionOptions = {
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        store: new MemoryStore({
            checkPeriod: 86400000,
        }),
        cookie: {
            // Stays `true` in production so the cookie is only ever sent over HTTPS.
            // Behind Nginx this works because of the `trust proxy` setting above.
            secure: app.get("env") === "production",
            // `sameSite: "lax"` still permits the top-level navigation that a
            // Google OAuth redirect performs, while blocking cross-site POSTs.
            sameSite: "lax",
            httpOnly: true,
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        }
    };

    app.use(session(sessionSettings));
    app.use(passport.initialize());
    app.use(passport.session());

    passport.use(
        new LocalStrategy(async (usernameOrEmail, password, done) => {
            try {
                console.log(`[DEBUG-AUTH] Tentative de connexion pour identifiant: "${usernameOrEmail}"`);

                // Try finding by username first
                let user = await storage.getUserByUsername(usernameOrEmail);
                if (user) console.log(`[DEBUG-AUTH] Utilisateur trouvé par username: ${user.username}`);

                // If not found, try finding by email
                if (!user) {
                    user = await storage.getUserByEmail(usernameOrEmail);
                    if (user) console.log(`[DEBUG-AUTH] Utilisateur trouvé par email: ${user.email} (Username: ${user.username})`);
                }

                if (!user) {
                    console.warn(`[DEBUG-AUTH] Aucun utilisateur trouvé avec l'identifiant: "${usernameOrEmail}"`);
                    return done(null, false);
                }

                const isMatch = await comparePasswords(password, user.password);
                if (!isMatch) {
                    console.warn(`[DEBUG-AUTH] Mot de passe incorrect pour: ${user.username}`);
                    return done(null, false);
                }

                // The role is whatever the database says it is. It is deliberately
                // not re-derived here from an email allowlist: this strategy runs on
                // the public /api/login endpoint, so any promotion logic placed here
                // would be reachable by anyone who can authenticate.
                console.log(`[DEBUG-AUTH] Connexion réussie pour: ${user.username}`);
                return done(null, user);
            } catch (err) {
                console.error(`[DEBUG-AUTH] Erreur fatale dans LocalStrategy:`, err);
                return done(err);
            }
        }),
    );

    passport.serializeUser((user, done) => done(null, (user as SelectUser).id));
    passport.deserializeUser(async (id: number, done) => {
        try {
            const user = await storage.getUser(id);
            done(null, user);
        } catch (err) {
            done(err);
        }
    });

    app.post("/api/register", async (req, res, next) => {
        try {
            const allUsers = await storage.getUsers();

            const existingUser = await storage.getUserByUsername(req.body.username);
            if (existingUser) {
                return res.status(400).send("Username already exists");
            }

            const existingEmail = await storage.getUserByEmail(req.body.email);
            if (existingEmail) {
                return res.status(400).send("Email already exists");
            }

            const hashedPassword = await hashPassword(req.body.password);
            // Role policy lives in server/roles.ts. In production this is always
            // the customer role: no public, unauthenticated endpoint may hand out
            // admin or superadmin, and this endpoint never verifies ownership of
            // the submitted email address, so an email allowlist here would let
            // anyone claim an owner's address and take over the store.
            const normalizedEmail = String(req.body.email || "").toLowerCase();
            const role = resolvePublicRegistrationRole({ isFirstUser: allUsers.length === 0 });

            const user = await storage.createUser({
                username: req.body.username,
                email: req.body.email,
                fullName: req.body.fullName || null,
                phone: req.body.phone || null,
                password: hashedPassword,
                role: role,
            });

            // Envoyer l'email de bienvenue
            sendWelcomeEmail(user.email, user.username).catch(err => {
                console.error("[ERROR] Erreur envoi email bienvenue:", err);
            });

            req.login(user, (err) => {
                if (err) return next(err);
                // Track registration
                storage.createUserActivity(user.id as number, "register", "Création de compte").catch(console.error);
                res.status(201).json(sanitizeUser(user as any));
            });
        } catch (err) {
            next(err);
        }
    });

    app.post("/api/login", (req, res, next) => {
        console.log(`[DEBUG-AUTH] Requête POST /api/login reçue pour: ${req.body.username}`);
        passport.authenticate("local", (err: any, user: SelectUser | false) => {
            if (err) {
                console.error(`[DEBUG-AUTH] Erreur Passport sur /api/login:`, err);
                return res.status(401).send("Invalid username or password");
            }
            if (!user) return res.status(401).send("Invalid username or password");
            req.login(user, (err) => {
                if (err) {
                    console.error(`[DEBUG-AUTH] Erreur req.login sur /api/login:`, err);
                    return res.status(500).send("Unable to create session");
                }
                storage.createUserActivity(user.id, "login", "Connexion au compte").catch(console.error);
                res.json(sanitizeUser(user));
            });
        })(req, res, next);
    });

    app.post("/api/auth/google", async (req, res, next) => {
        if (!googleClient || !googleClientId) {
            return res.status(503).send("La connexion Google n'est pas configurée.");
        }

        try {
            const credential = req.body?.credential;
            if (typeof credential !== "string") {
                return res.status(400).send("Jeton Google manquant.");
            }

            const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: googleClientId });
            const payload = ticket.getPayload();
            if (!payload) {
                return res.status(401).send("Jeton Google invalide.");
            }

            const email = payload.email?.toLowerCase();

            if (!email || !payload.email_verified) {
                return res.status(401).send("Adresse Google non vérifiée.");
            }

            let user = await storage.getUserByEmail(email);
            if (!user) {
                const baseUsername = (email.split("@")[0] || "client")
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, "")
                    .slice(0, 24) || "client";
                let username = baseUsername;
                let suffix = 1;

                while (await storage.getUserByUsername(username)) {
                    suffix += 1;
                    username = `${baseUsername}-${suffix}`;
                }

                user = await storage.createUser({
                    username,
                    email,
                    fullName: payload.name || undefined,
                    password: await hashPassword(randomBytes(32).toString("hex")),
                    role: "client",
                });
            }

            // Stocker/mettre à jour le googleId pour l'utilisateur
            const googleId = payload.sub;
            if (googleId && (!user.googleId || user.googleId !== googleId)) {
                await storage.updateUserGoogleId(user.id, googleId);
                user.googleId = googleId;
            }

            // Auto-provisioned Google accounts are always customers. A superadmin
            // signs in with the role stored in the database, which is set by
            // server/seed-admin.ts or by POST /api/admin/users.
            req.login(user, (error) => {
                if (error) return next(error);
                res.json(sanitizeUser(user as SelectUser));
            });
        } catch (error) {
            console.error("[AUTH] Échec de la connexion Google:", error);
            res.status(401).send("Connexion Google refusée.");
        }
    });

    app.post("/api/logout", (req, res, next) => {
        const user = req.user as any;
        req.logout(async (err) => {
            if (err) return next(err);
            if (user) {
                try {
                    await storage.createUserActivity(user.id, "logout", "Déconnexion du compte");
                } catch (e) {
                    console.error("[ERROR] Failed to log logout activity:", e);
                }
            }
            res.sendStatus(200);
        });
    });

    app.get("/api/user", (req, res) => {
        if (!req.isAuthenticated()) return res.json(null);
        res.json(sanitizeUser(req.user as any));
    });
}
