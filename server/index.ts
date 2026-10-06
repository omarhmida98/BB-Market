import "./env.js";
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes.js";
import { createServer } from "http";
import { setupCronJobs } from "./cron.js";
import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "./paths.js";

const app = express();
const httpServer = createServer(app);
const isProduction = process.env.NODE_ENV === "production";

// Never advertise the framework.
app.disable("x-powered-by");

/**
 * Security headers (helmet), tuned for this app's real third parties.
 *
 * The Content-Security-Policy is written out in full rather than left to the
 * defaults, because the storefront legitimately loads from several external
 * origins and a blind default would break them:
 *   - Google Identity Services (sign-in) + Google Analytics (gtag, with an
 *     inline bootstrap snippet in index.html, hence 'unsafe-inline' on scripts);
 *   - Google Fonts (stylesheet on googleapis, font files on gstatic);
 *   - Instagram / TikTok embed scripts, and Instagram / TikTok / Facebook
 *     embed iframes;
 *   - product images from Cloudinary, from the local /uploads path, and from the
 *     social CDNs — covered by `img-src https:` plus data:/blob: for previews.
 *
 * `object-src 'none'`, `base-uri 'self'` and `frame-ancestors 'self'` close the
 * dangerous defaults (plugins, <base> hijacking, clickjacking) without touching
 * any of the above. `upgrade-insecure-requests` and HSTS are production-only so
 * they never force https on http://localhost during development.
 */
const cspDirectives: Record<string, string[]> = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'self'"],
  scriptSrc: [
    "'self'",
    "'unsafe-inline'",
    "https://accounts.google.com",
    "https://apis.google.com",
    "https://www.googletagmanager.com",
    "https://www.gstatic.com",
    "https://www.instagram.com",
    "https://www.tiktok.com",
    "https://connect.facebook.net",
  ],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:", "blob:", "https:"],
  connectSrc: [
    "'self'",
    "https://accounts.google.com",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://region1.google-analytics.com",
    "https://api.cloudinary.com",
  ],
  frameSrc: [
    "'self'",
    "https://accounts.google.com",
    "https://www.instagram.com",
    "https://www.tiktok.com",
    "https://www.facebook.com",
  ],
  workerSrc: ["'self'", "blob:"],
  manifestSrc: ["'self'"],
  mediaSrc: ["'self'", "https:", "data:"],
};
if (isProduction) cspDirectives.upgradeInsecureRequests = [];

app.use(
  helmet({
    contentSecurityPolicy: { useDefaults: false, directives: cspDirectives },
    // OAuth sign-in opens a Google popup that talks back via postMessage; the
    // strict `same-origin` COOP would sever that channel. `allow-popups` keeps
    // the isolation while letting the popup flow work.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    // Third-party embeds are not COEP-compatible, so leave COEP off.
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // HSTS only in production: on localhost it would pin the browser to https.
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
  }),
);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  // The response body is deliberately NOT logged. These lines are the request
  // audit trail, and /api responses include sanitized user records, message
  // bodies and password-reset codes — dumping them to stdout would write
  // tokens and customer data into the server log for anyone with log access.
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);
  setupCronJobs();

  // ---------------------------------------------------------------------------
  // Static frontend (production only)
  // ---------------------------------------------------------------------------
  // Nginx serves the built SPA in production (see deploy/nginx/bb-market.conf),
  // which is the preferred setup. This fallback keeps `npm start` usable on its
  // own: without it a bare production start answers 404 on "/" because the API
  // has no route for it. In dev the client is served by Vite on :5173 and this
  // block stays off, so the dev proxy keeps working.
  const spaIndex = path.join(PROJECT_ROOT, "dist", "public", "index.html");
  if (process.env.NODE_ENV === "production" && fs.existsSync(spaIndex)) {
    const spaRoot = path.dirname(spaIndex);
    console.log(`[STATIC_SPA] Serving built client`);
    app.use(express.static(spaRoot, { index: false }));

    // History fallback: wouter routes such as /checkout or /admin are
    // client-side only, so they must resolve to index.html rather than 404.
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/auth")) return next();
      res.sendFile(spaIndex);
    });
  } else {
    console.log(
      "[STATIC_SPA] Built client not served by Express; " +
        (process.env.NODE_ENV === "production"
          ? "run `npm run build` first."
          : "dev mode: Vite serves the client on :5173."),
    );
  }

  // Reached for every rejection thrown out of an async route handler (see
  // `forwardAsyncErrors`), so this can now see driver errors that used to take the
  // process down instead. A 500's message is the database's or the driver's, not
  // ours: it can name columns, constraints and values, so only the status crosses
  // the wire and the detail goes to the log.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    console.error("[ERROR] Unhandled request error:", err);
    if (res.headersSent) return;
    res.status(status).json({
      message: status >= 500 ? "Internal Server Error" : err.message || "Request failed",
    });
  });

  const port = Number(process.env.PORT ?? 5000);
  // Bind to loopback by default so only Nginx can reach the API. The previous
  // hardcoded 0.0.0.0 exposed an unauthenticated-by-proxy port to the world on
  // any VPS without a correctly configured firewall. Set HOST=0.0.0.0 to
  // restore the old behaviour.
  const host = process.env.HOST ?? "127.0.0.1";
  httpServer.listen({ port, host }, () => {
    log(`API server listening on port ${port} (bound to ${host})`);
  });
})();
