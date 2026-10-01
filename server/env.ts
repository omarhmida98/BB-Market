import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === "production";
const fileName = isProduction ? ".env.prod" : ".env";

/**
 * Resolve the env file to load.
 *
 * The compiled server runs from `dist/server/`, while the un-compiled one runs
 * from `server/`. A plain `path.resolve(__dirname, "../" + fileName)` therefore
 * looks inside `dist/` once built and silently finds nothing, which means a
 * `.env.prod` sitting at the project root is never read in production.
 *
 * Instead we walk up from this module towards the filesystem root and take the
 * first directory that holds BOTH a `package.json` and the env file we want.
 * That anchors resolution to the workspace root in both dev and production.
 *
 * `ENV_FILE` overrides everything for unusual layouts.
 */
function resolveEnvFile(): string | null {
  const explicit = process.env.ENV_FILE;
  if (explicit) {
    return fs.existsSync(explicit) ? explicit : null;
  }

  let dir = __dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envPath = resolveEnvFile();

if (envPath) {
  config({ path: envPath, override: true });
  console.log(`[env] loaded ${envPath}`);
} else {
  // Not fatal: on the OVH server the values are injected by systemd's
  // EnvironmentFile, so there is no env file to read at all.
  console.log(
    `[env] no ${fileName} found; relying on the ambient environment ` +
      `(NODE_ENV=${process.env.NODE_ENV ?? "unset"})`,
  );
}
