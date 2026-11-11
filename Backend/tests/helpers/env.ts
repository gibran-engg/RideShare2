/**
 * Isolated test environment: temp database and uploads, separate ports.
 * Must be imported before anything from lib/ or services/ (ES modules evaluate in import order).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";

if (!process.env.RIDESHARE_TEST_DIR) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rideshare-test-"));
    Object.assign(process.env, {
        RIDESHARE_TEST_DIR: dir,
        NODE_ENV: "test",
        DATABASE_PATH: path.join(dir, "test.db"),
        UPLOAD_DIR: path.join(dir, "uploads"),
        SESSION_SECRET: "test-secret",
        PAYMENT_WEBHOOK_SECRET: "test-webhook-secret",
        MOCK_OAUTH_ENABLED: "true",
        // Tests sign in through the dev provider, which stands in for Auth0.
        AUTH0_DOMAIN: "",
        AUTH0_AUDIENCE: "",
        AUTH0_APP_CLIENT_ID: "",
        AUTH0_ADMIN_CLIENT_ID: "",
        AUTH0_ADMIN_CLIENT_SECRET: "",
        MAPTILER_KEY: "",
        // Never call the public OSM servers from tests; routing falls back to an estimate.
        OSRM_URL: "http://127.0.0.1:9",
        NOMINATIM_URL: "http://127.0.0.1:9",
        DEV_HOST: "127.0.0.1",
        API_PORT: "4600",
        ADMIN_APP_PORT: "4602",
        MOCK_OAUTH_PORT: "4603",
        // No Vite in tests: payment checkouts return to the API instead of the web app.
        WEB_URL: "http://127.0.0.1:4600"
    });
}

let starting: Promise<Server[]> | undefined;
let users = 0;

async function listenAll(): Promise<Server[]> {
    const { default: config } = await import("../../lib/config.ts");
    const listen = (app: { listen: (port: number, cb: () => void) => Server }, port: number) =>
        new Promise<Server>((resolve) => {
            const server = app.listen(port, () => resolve(server));
        });
    const [backend, admin, mockOAuth] = await Promise.all([
        import("../../backend/src/main.ts"),
        import("../../apps/admin/server.ts"),
        import("../../mock-oauth/server.ts")
    ]);
    return Promise.all([
        backend.start(config.ports.api),
        listen(admin.default, config.ports.admin),
        listen(mockOAuth.default, config.ports.mockOAuth)
    ]);
}

/**
 * Start every app in this process and return their URLs. Test files run in one process and may
 * call this at the same time, so they share one start-up; the last stopServers() closes them.
 */
export async function startServers() {
    users += 1;
    starting ??= listenAll();
    await starting;
    const { default: config } = await import("../../lib/config.ts");
    return config.urls;
}

export async function stopServers(): Promise<void> {
    users -= 1;
    if (users > 0 || !starting) return;
    const servers = await starting;
    starting = undefined;
    for (const server of servers) {
        server.closeAllConnections();
        server.close();
    }
}
