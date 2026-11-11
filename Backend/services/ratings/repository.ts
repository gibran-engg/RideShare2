import * as db from "../../db/index.ts";
import type { RatingRow } from "../../lib/types.ts";

export interface NewRating {
    rideId: number;
    raterId: number;
    rateeId: number;
    stars: number;
    tags: string[];
    comment: string | null;
}

/** Returns false if this person already rated this ride. */
export function insert(rating: NewRating): boolean {
    const result = db
        .get()
        .prepare(
            `INSERT INTO ride_ratings (ride_id, rater_id, ratee_id, stars, tags, comment) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(ride_id, rater_id) DO NOTHING`
        )
        .run(rating.rideId, rating.raterId, rating.rateeId, rating.stars, JSON.stringify(rating.tags), rating.comment);
    return result.changes > 0;
}

export function byRater(rideId: number, raterId: number): RatingRow | null {
    return (
        (db.get().prepare("SELECT * FROM ride_ratings WHERE ride_id = ? AND rater_id = ?").get(rideId, raterId) as RatingRow | undefined) ??
        null
    );
}

export function forRide(rideId: number): RatingRow[] {
    return db.get().prepare("SELECT * FROM ride_ratings WHERE ride_id = ? ORDER BY id").all(rideId) as unknown as RatingRow[];
}

export function summary(userId: number): { average: number | null; count: number } {
    const row = db.get().prepare("SELECT AVG(stars) AS average, COUNT(*) AS count FROM ride_ratings WHERE ratee_id = ?").get(userId) as {
        average: number | null;
        count: number;
    };
    return { average: row.average == null ? null : Math.round(row.average * 10) / 10, count: row.count };
}

/** Ratings a user received, newest first (admin user page). */
export function received(userId: number, limit = 20): (RatingRow & { rater_name: string | null })[] {
    return db
        .get()
        .prepare(
            `SELECT rr.*, u.name AS rater_name FROM ride_ratings rr JOIN users u ON u.id = rr.rater_id
             WHERE rr.ratee_id = ? ORDER BY rr.id DESC LIMIT ?`
        )
        .all(userId, limit) as unknown as (RatingRow & { rater_name: string | null })[];
}
