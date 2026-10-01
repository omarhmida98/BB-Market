import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locate the workspace root.
 *
 * The compiled server runs from `dist/server/`, so any path built with
 * `path.resolve(__dirname, "..")` silently points inside `dist/` once built and
 * then gets wiped by the next `npm run build`. Everything that must survive a
 * deploy (uploads, attached_assets, the SQLite file in dev) therefore has to be
 * resolved from the real project root instead of from `__dirname`.
 *
 * The root is the closest ancestor directory that contains a `package.json`
 * with workspaces configured, which is what distinguishes the repo root from
 * `dist/`, from a build container and from `node_modules`.
 */
function findProjectRoot(): string {
  const explicit = process.env.PROJECT_ROOT;
  if (explicit) {
    return path.resolve(explicit);
  }

  let dir = __dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, "utf8"));
        // The monorepo root is the only package.json declaring `workspaces`.
        // Matching on `name` instead would stop at server/ and client/, whose
        // relative layout differs from the root.
        if (parsed.workspaces) return dir;
      } catch {
        // Unreadable package.json: keep looking.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return process.cwd();
}

export const PROJECT_ROOT = findProjectRoot();

/**
 * Directory holding user-uploaded images.
 *
 * Defaults to `<project root>/public/uploads`, which sits OUTSIDE `dist/` on
 * purpose: `npm run build` empties `dist/`, so serving uploads from there would
 * delete every image an admin had uploaded. Override with UPLOADS_DIR.
 */
export function resolveUploadsDir(): string {
  if (process.env.UPLOADS_DIR) {
    return path.resolve(process.env.UPLOADS_DIR);
  }
  return path.join(PROJECT_ROOT, "public", "uploads");
}

/** Directory holding the legacy static asset images shipped with the repo. */
export function resolveAssetsDir(): string {
  const candidates = [
    path.join(PROJECT_ROOT, "attached_assets"),
    path.join(__dirname, "attached_assets"),
    "/app/attached_assets",
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}
