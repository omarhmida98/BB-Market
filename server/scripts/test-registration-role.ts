/**
 * Regression test: a public, unauthenticated registration must never produce a
 * privileged account.
 *
 *   npm run test:auth
 *
 * The bug this guards against
 * ---------------------------
 * Role promotion used to happen in five places, including a hardcoded pair of
 * owner email addresses checked on POST /api/register and again on every read in
 * storage.getUserByEmail. Because /api/register never verifies that the caller
 * owns the email address it is given, anyone could POST their own password for an
 * owner address, log in, and receive `superadmin`.
 *
 * How it is tested
 * ----------------
 * Each integration case runs in a child process with its own throwaway SQLite
 * file, because the database handle and the env are resolved at import time and
 * cannot be re-pointed safely inside one process. The child migrates a genuinely
 * empty database, boots a minimal Express app with the real setupAuth(),
 * performs a real POST /api/register, then reads the role back out of the
 * database to confirm what was actually persisted.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePublicRegistrationRole } from "../roles.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail: string) {
    if (condition) {
        passed += 1;
        console.log(`  PASS  ${name}  ${detail}`);
    } else {
        failed += 1;
        console.log(`  FAIL  ${name}  ${detail}`);
    }
}

// ---------------------------------------------------------------------------
// Policy matrix. roles.ts reads process.env on every call, so one import is
// enough even though the environment changes between cases.
// ---------------------------------------------------------------------------
type PolicyCase = {
    name: string;
    nodeEnv: string | undefined;
    flag: string | undefined;
    isFirstUser: boolean;
    expected: string;
};

const policyCases: PolicyCase[] = [
    { name: "production, flag absent, first user", nodeEnv: "production", flag: undefined, isFirstUser: true, expected: "client" },
    { name: "production, flag ENABLED, first user (must be ignored)", nodeEnv: "production", flag: "1", isFirstUser: true, expected: "client" },
    { name: "production, flag enabled, later user", nodeEnv: "production", flag: "1", isFirstUser: false, expected: "client" },
    { name: "production, flag set to junk, first user", nodeEnv: "production", flag: "true", isFirstUser: true, expected: "client" },
    { name: "development, flag absent, first user", nodeEnv: "development", flag: undefined, isFirstUser: true, expected: "client" },
    { name: "development, flag enabled, first user (opt-in bootstrap)", nodeEnv: "development", flag: "1", isFirstUser: true, expected: "superadmin" },
    { name: "development, flag enabled, second user", nodeEnv: "development", flag: "1", isFirstUser: false, expected: "client" },
    { name: "NODE_ENV unset, flag enabled (treated as dev)", nodeEnv: undefined, flag: "1", isFirstUser: true, expected: "superadmin" },
];

function runPolicyTests() {
    console.log("\n[1] role policy matrix (server/roles.ts)");

    const savedEnv = process.env.NODE_ENV;
    const savedFlag = process.env.ALLOW_DEV_FIRST_USER_SUPERADMIN;
    try {
        for (const c of policyCases) {
            if (c.nodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = c.nodeEnv;
            if (c.flag === undefined) delete process.env.ALLOW_DEV_FIRST_USER_SUPERADMIN;
            else process.env.ALLOW_DEV_FIRST_USER_SUPERADMIN = c.flag;

            const actual = resolvePublicRegistrationRole({ isFirstUser: c.isFirstUser });
            check(c.name, actual === c.expected, `got "${actual}", expected "${c.expected}"`);
        }
    } finally {
        if (savedEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = savedEnv;
        if (savedFlag === undefined) delete process.env.ALLOW_DEV_FIRST_USER_SUPERADMIN;
        else process.env.ALLOW_DEV_FIRST_USER_SUPERADMIN = savedFlag;
    }
}

// ---------------------------------------------------------------------------
// Integration cases: real endpoint, real empty database, child process.
// ---------------------------------------------------------------------------
type IntegrationCase = {
    name: string;
    nodeEnv: string | undefined;
    flag: string | undefined;
    email: string;
    expected: string;
    note?: string;
};

const integrationCases: IntegrationCase[] = [
    {
        name: "PRODUCTION: first public registration on an empty database",
        nodeEnv: "production",
        flag: undefined,
        email: "attacker@evil.example",
        expected: "client",
    },
    {
        name: "PRODUCTION: claiming an owner email by public registration",
        nodeEnv: "production",
        flag: undefined,
        email: "bbmarket26@gmail.com",
        expected: "client",
        note: "(the original takeover vector)",
    },
    {
        name: "PRODUCTION: dev bootstrap flag set, still must not promote",
        nodeEnv: "production",
        flag: "1",
        email: "omar.hmida.lgl@gmail.com",
        expected: "client",
        note: "(production ignores the flag)",
    },
    {
        name: "DEVELOPMENT: flag enabled, first user keeps the bootstrap convenience",
        nodeEnv: "development",
        flag: "1",
        email: "dev-owner@example.com",
        expected: "superadmin",
    },
    {
        name: "DEVELOPMENT: flag absent, first user is a customer",
        nodeEnv: "development",
        flag: undefined,
        email: "dev-stranger@example.com",
        expected: "client",
    },
];

function runIntegrationCase(c: IntegrationCase) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-auth-test-"));
    const dbFile = path.join(tmpDir, "auth-test.db");

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        DATABASE_URL: `file:${dbFile}`,
        SESSION_SECRET: "regression-test-secret",
        // The production cases run in production mode but still use SQLite, which
        // db.ts refuses to open in production unless this flag is set. That guard
        // exists to stop a real deployment from silently writing to a local file;
        // here the "database" is a throwaway file in the temp dir that is deleted
        // immediately afterwards, so the documented escape hatch is appropriate.
        ALLOW_SQLITE_IN_PRODUCTION: "1",
        // Irrelevant to auth, but it writes rows on startup.
        SEED_DEMO_PRODUCTS: "",
    };
    if (c.nodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = c.nodeEnv;
    if (c.flag === undefined) delete env.ALLOW_DEV_FIRST_USER_SUPERADMIN;
    else env.ALLOW_DEV_FIRST_USER_SUPERADMIN = c.flag;

    // `--import tsx` re-registers the TypeScript loader in the child. Spawning
    // the file directly would leave plain node unable to parse this .ts file.
    const result = spawnSync(process.execPath, ["--import", "tsx", __filename, "--child", dbFile], {
        env,
        encoding: "utf8",
        timeout: 180_000,
    });

    const stdout = result.stdout || "";
    const stderr = (result.stderr || "").trim();
    const role = (stdout.match(/^STORED_ROLE=(.*)$/m) || [])[1];

    if (role === undefined) {
        const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ");
        check(c.name, false, `child produced no role (exit ${result.status}): ${tail}`);
    } else {
        check(
            c.name,
            role === c.expected,
            `persisted role of first registrant = "${role}", expected "${c.expected}"` +
                (c.note ? ` ${c.note}` : ""),
        );
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Child process: migrate an empty database, register, print the persisted role.
// ---------------------------------------------------------------------------
async function runChild(dbFile: string) {
    // db.ts imports env.js, which calls dotenv with override:true. Importing it
    // first guarantees our DATABASE_URL is the value that survives.
    await import("../env.js");
    process.env.DATABASE_URL = `file:${dbFile}`;

    const { resolveDbTarget } = await import("../db-target.js");
    const target = resolveDbTarget();
    if (target.dialect !== "sqlite") {
        throw new Error(
            `this test needs SQLite, but DATABASE_URL resolved to "${target.dialect}". ` +
                `A .env containing a PostgreSQL DATABASE_URL will break it.`,
        );
    }

    const Database = (await import("better-sqlite3")).default;
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");

    const sqlite = new Database(target.sqlitePath!);
    migrate(drizzle(sqlite), { migrationsFolder: target.migrationsFolder });
    sqlite.close();

    const express = (await import("express")).default;
    const { setupAuth } = await import("../auth.js");

    const app = express();
    app.use(express.json());
    setupAuth(app);

    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const email = process.env.__TEST_EMAIL ?? "attacker@evil.example";
    const response = await fetch(`http://127.0.0.1:${port}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: `tester-${Date.now()}`,
            email,
            password: "Str0ng-Test-Password!2026",
        }),
    });

    if (response.status !== 201) {
        throw new Error(`registration returned ${response.status}: ${await response.text()}`);
    }

    const { storage } = await import("../storage.js");
    const stored = await storage.getUserByEmail(email);
    console.log(`STORED_ROLE=${stored?.role ?? "none"}`);

    server.close();
    process.exit(0);
}

// ---------------------------------------------------------------------------

if (process.argv.includes("--child")) {
    const dbFile = process.argv[process.argv.indexOf("--child") + 1];
    await runChild(dbFile);
} else {
    console.log("Auth regression suite: public registration must never be privileged");
    runPolicyTests();

    console.log("\n[2] integration: real POST /api/register against a fresh empty database");
    for (const c of integrationCases) {
        process.env.__TEST_EMAIL = c.email;
        runIntegrationCase(c);
    }
    delete process.env.__TEST_EMAIL;

    console.log("\n=================================================");
    console.log(`  ${passed} passed, ${failed} failed`);
    console.log("=================================================");
    process.exit(failed > 0 ? 1 : 0);
}
