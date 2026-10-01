export const DEBUG_DB = ["true", "1", "yes", "on"].includes(
  (process.env.DEBUG_DB ?? "").trim().toLowerCase(),
);

export function dbg(...args: unknown[]): void {
  if (DEBUG_DB) console.log(...args);
}
