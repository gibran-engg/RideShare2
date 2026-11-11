/**
 * Deletes the local database and uploaded documents so a demo starts clean.
 * Run `npm run db:reset`, which also reloads the demo accounts.
 */
import fs from "node:fs";
import config from "../lib/config.ts";

if (config.isProduction) {
    console.error("Refusing to reset data in production.");
    process.exit(1);
}

for (const file of [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`]) {
    try {
        fs.rmSync(file, { force: true });
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EBUSY" || code === "EPERM") {
            console.error(`${file} is in use. Stop the servers (Ctrl+C in the "npm run dev" terminal) and try again.`);
            process.exit(1);
        }
        throw err;
    }
}
fs.rmSync(config.uploadDir, { recursive: true, force: true });
console.log("Cleared the database and uploaded documents.");
