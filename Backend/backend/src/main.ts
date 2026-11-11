import http from "node:http";
import config from "../../lib/config.ts";
import * as db from "../../db/index.ts";
import { isMain } from "../../lib/is-main.ts";
import app from "./app.ts";
import * as realtime from "./core/realtime.ts";

export { app };

export function start(port: number = config.ports.api): Promise<http.Server> {
    const server = http.createServer(app);
    const wss = realtime.attach(server);
    server.on("close", () => wss.close());
    return new Promise((resolve) => {
        // Listen on all interfaces so a phone on the same Wi-Fi can connect.
        server.listen(port, "0.0.0.0", () => resolve(server));
    });
}

/** Finish in-flight requests, then close the database (Ctrl+C, or the platform stopping us). */
function shutdownOn(server: http.Server): void {
    let stopping = false;
    const stop = (signal: string) => {
        if (stopping) return;
        stopping = true;
        console.log(`${signal} received, shutting down`);
        server.close(() => {
            db.close();
            process.exit(0);
        });
        server.closeIdleConnections();
        setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on("SIGINT", () => stop("SIGINT"));
    process.on("SIGTERM", () => stop("SIGTERM"));
}

if (isMain(import.meta.url)) {
    const server = await start();
    shutdownOn(server);
    console.log(`RideShare API running at ${config.urls.api} (live updates on /ws, docs at ${config.urls.api}/docs)`);
}
