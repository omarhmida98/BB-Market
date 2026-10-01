import fs from "fs";
import path from "path";

export type JournalEntry = { idx: number; tag: string; when: number };

/** Reads migrations/<dialect>/meta/_journal.json, which is the ordered migration list. */
export function readJournal(migrationsFolder: string): JournalEntry[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    throw new Error(
      `No migration journal found at ${journalPath}.\n` +
      `Run \`npm run db:generate\` to create migrations first.`,
    );
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  return journal.entries.map((e: JournalEntry) => ({
    idx: e.idx,
    tag: e.tag,
    when: e.when,
  }));
}
