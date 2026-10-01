/**
 * Production entry point.
 *
 * `npm start` must behave like a production start even when the caller forgets
 * to export NODE_ENV, which is easy to do on Windows and when running the
 * command by hand. It matters here because NODE_ENV=production is what turns on
 * secure session cookies, the reverse-proxy trust setting, the refusal to open
 * SQLite, and serving the built client.
 *
 * A dedicated launcher is used instead of `NODE_ENV=production node ...` in the
 * npm script because that env-prefix syntax is not valid in cmd.exe, so it would
 * break `npm start` on Windows.
 *
 * An explicit NODE_ENV from the environment still wins, so `NODE_ENV=test npm
 * start` keeps working.
 */
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

await import("./dist/server/index.js");
