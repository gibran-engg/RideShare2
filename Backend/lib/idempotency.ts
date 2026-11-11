import * as db from "../db/index.ts";

export interface StoredResponse {
    route: string;
    request_hash: string;
    status_code: number;
    response_body: string;
}

// Keys are remembered for a day, like most payment APIs.
const TTL_MS = 24 * 60 * 60 * 1000;

export function find(userId: number, key: string): StoredResponse | null {
    return (
        (db
            .get()
            .prepare(
                "SELECT route, request_hash, status_code, response_body FROM idempotency_keys WHERE user_id = ? AND key = ? AND created_at > ?"
            )
            .get(userId, key, Date.now() - TTL_MS) as StoredResponse | undefined) ?? null
    );
}

export function save(userId: number, key: string, response: StoredResponse): void {
    const conn = db.get();
    conn.prepare("DELETE FROM idempotency_keys WHERE created_at <= ?").run(Date.now() - TTL_MS);
    conn.prepare(
        `INSERT INTO idempotency_keys (user_id, key, route, request_hash, status_code, response_body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, key) DO NOTHING`
    ).run(userId, key, response.route, response.request_hash, response.status_code, response.response_body, Date.now());
}
