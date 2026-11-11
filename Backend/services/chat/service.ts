import { AppError } from "../../lib/errors.ts";
import { bus } from "../../lib/events.ts";
import type { MessageRow } from "../../lib/types.ts";
import * as rides from "../rides/service.ts";
import * as repo from "./repository.ts";

/**
 * Rider-driver chat for one ride. Messages can be sent from the moment a driver accepts until the
 * trip ends, and stay readable afterwards (and to admins). Phone numbers are never needed.
 */

const OPEN_STATUSES = new Set(["accepted", "arrived", "in_progress"]);
export const MAX_LENGTH = 500;

export const lastId = repo.lastId;

export function list(rideId: number, userId: number, afterId = 0): MessageRow[] {
    rides.getForParticipant(rideId, userId);
    return repo.forRide(rideId, afterId);
}

/** Admin view of a ride's conversation. */
export function forRide(rideId: number): MessageRow[] {
    return repo.forRide(rideId);
}

export function send(rideId: number, userId: number, text: unknown): MessageRow {
    const ride = rides.getForParticipant(rideId, userId);
    if (!OPEN_STATUSES.has(ride.status) || !ride.driver_id) {
        throw new AppError("RIDE_STATE_CONFLICT", "You can message once a driver accepts, until the trip ends.");
    }
    const body = String(text ?? "").trim();
    if (!body) throw new AppError("VALIDATION_FAILED", "Type a message first.");
    if (body.length > MAX_LENGTH) throw new AppError("VALIDATION_FAILED", `Messages can be up to ${MAX_LENGTH} characters.`);

    const id = repo.insert(rideId, userId, body);
    bus.emit("ride.message", { rideId, riderId: ride.rider_id, driverId: ride.driver_id, actorId: userId, messageId: id });
    return repo.get(id)!;
}
