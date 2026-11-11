/**
 * Starts every service in one terminal:
 *   API for the mobile app (3000), Admin app (3002) and, in development, the dev OAuth provider (4000).
 * The Expo app is started separately: cd mobile && npm start
 */
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import config from "../lib/config.ts";
import * as db from "../db/index.ts";

const root = path.join(import.meta.dirname, "..");

interface Service {
    name: string;
    color: number;
    script: string;
}

// Apply migrations once before the apps start using the shared database file.
db.open();
db.close();

const services: Service[] = [
    { name: "api", color: 36, script: "backend/src/main.ts" },
    { name: "admin", color: 35, script: "apps/admin/server.ts" }
];
if (config.oauth.mock.enabled) {
    services.push({ name: "oauth", color: 32, script: "mock-oauth/server.ts" });
}

const children: ChildProcess[] = [];
let shuttingDown = false;

function prefix(service: Service, chunk: Buffer): string {
    const label = `\x1b[${service.color}m[${service.name.padEnd(5)}]\x1b[0m `;
    return (
        chunk
            .toString()
            .split(/\r?\n/)
            .filter((line) => line.length)
            .map((line) => label + line)
            .join("\n") + "\n"
    );
}

for (const service of services) {
    const child = spawn(
        process.execPath,
        ["--disable-warning=ExperimentalWarning", "--import", "./scripts/child-guard.ts", service.script],
        {
            cwd: root,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe", "ipc"]
        }
    );
    child.stdout!.on("data", (chunk) => process.stdout.write(prefix(service, chunk)));
    child.stderr!.on("data", (chunk) => process.stderr.write(prefix(service, chunk)));
    child.on("exit", (code) => {
        if (!shuttingDown) {
            console.error(`[${service.name}] exited with code ${code}. Stopping everything.`);
            shutdown(code || 1);
        }
    });
    children.push(child);
}

function shutdown(code = 0): void {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) if (child.exitCode === null) child.kill();
    setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

setTimeout(() => {
    console.log(`
  RideShare is starting:
    API               ${config.urls.api}   (docs: ${config.urls.api}/docs)
    Admin app         ${config.urls.admin}
    ${config.oauth.mock.enabled ? `Dev OAuth         ${config.urls.mockOAuth}` : ""}
  Sign-in: ${config.identity.provider === "auth0" ? `Auth0 (${config.identity.issuer})` : "Dev sign-in (set AUTH0_* in .env for Auth0)"}
  Android app: install the APK (phone on the same Wi-Fi as ${config.devHost}), or cd mobile && npm run web
`);
}, 800);
