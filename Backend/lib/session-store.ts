import session from "express-session";
import type { SessionData } from "express-session";
import config from "./config.ts";
import * as db from "../db/index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

type Callback = (err?: unknown, value?: SessionData | null) => void;

/** express-session store backed by the shared SQLite database. */
class SqliteStore extends session.Store {
    private pruneTimer: NodeJS.Timeout;

    constructor() {
        super();
        this.pruneTimer = setInterval(() => this.prune(), 15 * 60 * 1000);
        this.pruneTimer.unref();
    }

    private expiry(sess: SessionData): number {
        const expires = sess?.cookie?.expires;
        return expires ? new Date(expires).getTime() : Date.now() + DAY_MS;
    }

    override get(sid: string, callback: Callback): void {
        try {
            const row = db.get().prepare("SELECT sess, expires FROM sessions WHERE sid = ?").get(sid) as
                { sess: string; expires: number } | undefined;
            if (!row || row.expires < Date.now()) return callback(null, null);
            callback(null, JSON.parse(row.sess) as SessionData);
        } catch (err) {
            callback(err);
        }
    }

    override set(sid: string, sess: SessionData, callback: (err?: unknown) => void = () => {}): void {
        try {
            db.get()
                .prepare(
                    `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
                     ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`
                )
                .run(sid, JSON.stringify(sess), this.expiry(sess));
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    override touch(sid: string, sess: SessionData, callback: (err?: unknown) => void = () => {}): void {
        try {
            db.get().prepare("UPDATE sessions SET expires = ? WHERE sid = ?").run(this.expiry(sess), sid);
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    override destroy(sid: string, callback: (err?: unknown) => void = () => {}): void {
        try {
            db.get().prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
            callback(null);
        } catch (err) {
            callback(err);
        }
    }

    prune(): void {
        try {
            db.get().prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
        } catch (err) {
            console.error("Session prune failed:", (err as Error).message);
        }
    }
}

/**
 * Apps on localhost share cookies across ports, so each app must use its own cookie name.
 * SameSite=Lax still sends the cookie on the provider's top-level redirect back to the callback.
 */
export function sessionMiddleware(cookieName: string) {
    return session({
        name: cookieName,
        secret: config.sessionSecret,
        store: new SqliteStore(),
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: config.isProduction,
            maxAge: 7 * DAY_MS
        }
    });
}
