import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import config from "../lib/config.ts";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "migrations");

let db: DatabaseSync | undefined;

/** Migration files, in order: NNN_name.sql. Their number is the schema version they produce. */
export function migrationFiles(): { version: number; name: string; file: string }[] {
    return fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
        .sort()
        .map((name) => ({ version: Number.parseInt(name.slice(0, 3), 10), name, file: path.join(MIGRATIONS_DIR, name) }));
}

export function schemaVersion(conn: DatabaseSync = get()): number {
    const row = conn.prepare("PRAGMA user_version").get() as { user_version: number };
    return row.user_version;
}

/**
 * Applies pending migrations, each in its own transaction, recording progress in
 * PRAGMA user_version. Safe to call from several processes: BEGIN IMMEDIATE serialises them and
 * the version is re-read inside the transaction.
 */
export function migrate(conn: DatabaseSync = get()): number[] {
    const applied: number[] = [];
    for (const migration of migrationFiles()) {
        if (migration.version <= schemaVersion(conn)) continue;
        conn.exec("BEGIN IMMEDIATE");
        try {
            if (migration.version > schemaVersion(conn)) {
                conn.exec(fs.readFileSync(migration.file, "utf8"));
                conn.exec(`PRAGMA user_version = ${migration.version}`);
                applied.push(migration.version);
            }
            conn.exec("COMMIT");
        } catch (err) {
            conn.exec("ROLLBACK");
            throw new Error(`Migration ${migration.name} failed: ${(err as Error).message}`, { cause: err });
        }
    }
    return applied;
}

export function open(filePath: string = config.databasePath): DatabaseSync {
    if (db) return db;

    if (filePath !== ":memory:") {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    const conn = new DatabaseSync(filePath);
    // Several processes (API, admin app) share this file.
    conn.exec("PRAGMA busy_timeout = 5000;");
    if (filePath !== ":memory:") conn.exec("PRAGMA journal_mode = WAL;");
    conn.exec("PRAGMA foreign_keys = ON;");
    migrate(conn);
    db = conn;
    return db;
}

export function get(): DatabaseSync {
    return db || open();
}

/** Run fn inside a write transaction; rolls back if it throws. Nested calls join the outer one. */
let depth = 0;
export function transaction<T>(fn: (conn: DatabaseSync) => T): T {
    const conn = get();
    if (depth > 0) return fn(conn);
    conn.exec("BEGIN IMMEDIATE");
    depth++;
    try {
        const result = fn(conn);
        conn.exec("COMMIT");
        return result;
    } catch (err) {
        conn.exec("ROLLBACK");
        throw err;
    } finally {
        depth--;
    }
}

export function close(): void {
    if (db) {
        db.close();
        db = undefined;
    }
}
