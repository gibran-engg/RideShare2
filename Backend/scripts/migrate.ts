/** Applies pending database migrations (the apps also do this when they start). */
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import config from "../lib/config.ts";
import * as db from "../db/index.ts";

function versionOnDisk(): number {
    if (!fs.existsSync(config.databasePath)) return 0;
    const conn = new DatabaseSync(config.databasePath, { readOnly: true });
    try {
        return (conn.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    } finally {
        conn.close();
    }
}

const before = versionOnDisk();
const after = db.schemaVersion(db.open());
db.close();
console.log(
    before === after
        ? `Database is up to date (schema version ${after}).`
        : `Migrated ${config.databasePath} from schema version ${before} to ${after}.`
);
