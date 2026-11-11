import * as db from "../../db/index.ts";
import type { SavedPlaceRow } from "../../lib/types.ts";

export function list(userId: number): SavedPlaceRow[] {
    return db.get().prepare("SELECT * FROM saved_places WHERE user_id = ? ORDER BY id").all(userId) as unknown as SavedPlaceRow[];
}

export function byLabel(userId: number, label: string): SavedPlaceRow | null {
    return (
        (db.get().prepare("SELECT * FROM saved_places WHERE user_id = ? AND label = ?").get(userId, label) as SavedPlaceRow | undefined) ??
        null
    );
}

export function upsert(userId: number, place: { label: string; name: string; lat: number; lng: number }): void {
    db.get()
        .prepare(
            `INSERT INTO saved_places (user_id, label, name, lat, lng) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id, label) DO UPDATE SET name = excluded.name, lat = excluded.lat, lng = excluded.lng`
        )
        .run(userId, place.label, place.name, place.lat, place.lng);
}

export function remove(userId: number, id: number): boolean {
    return db.get().prepare("DELETE FROM saved_places WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}
