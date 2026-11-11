import * as db from "../../db/index.ts";
import type { MessageRow } from "../../lib/types.ts";

export function insert(rideId: number, senderId: number, body: string): number {
    return Number(
        db.get().prepare("INSERT INTO ride_messages (ride_id, sender_id, body) VALUES (?, ?, ?)").run(rideId, senderId, body)
            .lastInsertRowid
    );
}

export function get(id: number): MessageRow | null {
    return (db.get().prepare("SELECT * FROM ride_messages WHERE id = ?").get(id) as MessageRow | undefined) ?? null;
}

/** A ride's messages, oldest first; only those after `afterId` when given. */
export function forRide(rideId: number, afterId = 0): MessageRow[] {
    return db
        .get()
        .prepare("SELECT * FROM ride_messages WHERE ride_id = ? AND id > ? ORDER BY id LIMIT 500")
        .all(rideId, afterId) as unknown as MessageRow[];
}

/** Changes whenever a message is added to the ride (part of the live-update fingerprint). */
export function lastId(rideId: number): number {
    const row = db.get().prepare("SELECT COALESCE(MAX(id), 0) AS id FROM ride_messages WHERE ride_id = ?").get(rideId) as { id: number };
    return row.id;
}
