import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { bus } from "../../../lib/events.ts";
import * as rides from "../../../services/rides/service.ts";
import * as jwt from "../../../services/auth/jwt.ts";
import * as identity from "../../../services/auth/service.ts";
import * as users from "../../../services/users/service.ts";

const AUTH_TIMEOUT_MS = 5000;
// Changes made by another process (the admin app) don't reach this process's event bus,
// so every socket is also re-checked on this slow timer.
const FALLBACK_CHECK_MS = 10_000;
// Several events from one request (e.g. complete + payment) produce one check.
const EVENT_DEBOUNCE_MS = 50;

interface Client {
    socket: WebSocket & { isAlive?: boolean };
    userId: number;
    last: string;
    /** When the JWT the socket signed in with expires. */
    expiresAt: number;
}

/**
 * Live updates at ws://<api>/ws.
 * The app connects, sends { type: "auth", token } with its JWT access token, and then receives
 * { type: "refresh" } whenever something on its screen changed (ride status, driver position, new
 * requests, approval by an admin). The app then re-fetches what it shows. The socket is closed
 * when the token expires; the app reconnects with a fresh one.
 *
 * Domain events trigger an immediate check; a per-user fingerprint decides who actually changed,
 * so nobody gets a refresh for someone else's ride.
 */
export function attach(server: Server): WebSocketServer {
    const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4 * 1024 });
    const clients = new Set<Client>();

    function check(client: Client): void {
        try {
            if (client.expiresAt <= Date.now()) {
                client.socket.close(4001, "token expired");
                return;
            }
            const current = users.getById(client.userId);
            if (!current || current.status !== "active") {
                client.socket.send(JSON.stringify({ type: "signed-out" }));
                client.socket.close(4003, "signed out");
                return;
            }
            const fingerprint = rides.fingerprint(client.userId);
            if (fingerprint !== client.last) {
                client.last = fingerprint;
                client.socket.send(JSON.stringify({ type: "refresh" }));
            }
        } catch (err) {
            console.error("Live update check failed:", (err as Error).message);
        }
    }

    let pending: NodeJS.Timeout | null = null;
    const unsubscribe = bus.onAny(() => {
        if (pending || clients.size === 0) return;
        pending = setTimeout(() => {
            pending = null;
            for (const client of clients) check(client);
        }, EVENT_DEBOUNCE_MS);
    });

    const fallback = setInterval(() => {
        for (const client of clients) check(client);
    }, FALLBACK_CHECK_MS);
    fallback.unref();

    wss.on("connection", (socket: WebSocket & { isAlive?: boolean }) => {
        let client: Client | null = null;
        let authenticating = false;
        const authTimer = setTimeout(() => socket.close(4001, "auth timeout"), AUTH_TIMEOUT_MS);
        socket.isAlive = true;
        socket.on("pong", () => {
            socket.isAlive = true;
        });

        socket.on("message", async (data) => {
            if (client || authenticating) return;
            let message: { type?: string; token?: string };
            try {
                message = JSON.parse(data.toString());
            } catch {
                return socket.close(4002, "bad message");
            }
            authenticating = true;
            let user;
            let access;
            try {
                access = message.type === "auth" ? await jwt.verifyAccessToken(message.token) : null;
                user = access ? await identity.userFor(access) : null;
            } catch {
                // Sign-in service unreachable: let the app retry.
                return socket.close(1013, "try again later");
            }
            if (!access || !user || user.status !== "active") return socket.close(4003, "unauthorized");
            if (socket.readyState !== socket.OPEN) return;

            clearTimeout(authTimer);
            client = { socket, userId: user.id, last: rides.fingerprint(user.id), expiresAt: access.expiresAt };
            clients.add(client);
            socket.send(JSON.stringify({ type: "ready" }));
        });

        socket.on("close", () => {
            clearTimeout(authTimer);
            if (client) clients.delete(client);
        });
        socket.on("error", () => {});
    });

    // Drop connections that stopped answering (phone went to sleep, lost Wi-Fi).
    const heartbeat = setInterval(() => {
        for (const socket of wss.clients as Set<WebSocket & { isAlive?: boolean }>) {
            if (!socket.isAlive) {
                socket.terminate();
                continue;
            }
            socket.isAlive = false;
            socket.ping();
        }
    }, 30000);
    heartbeat.unref();

    wss.on("close", () => {
        clearInterval(heartbeat);
        clearInterval(fallback);
        if (pending) clearTimeout(pending);
        unsubscribe();
    });

    return wss;
}
