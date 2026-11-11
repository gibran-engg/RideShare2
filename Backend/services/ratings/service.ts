import { AppError } from "../../lib/errors.ts";
import { bus } from "../../lib/events.ts";
import type { RatingRow } from "../../lib/types.ts";
import * as rides from "../rides/service.ts";
import * as repo from "./repository.ts";

/** After a completed trip, the rider rates the driver and the driver rates the rider, once each. */

export const RIDER_TAGS = ["Clean car", "Safe driving", "Polite", "On time", "Knew the route", "Rash driving", "Late", "Rude"];
export const DRIVER_TAGS = ["Polite", "On time", "Easy pickup", "Kept me waiting", "Rude", "Wrong pickup spot"];

export const summary = repo.summary;
export const received = repo.received;
export const forRide = repo.forRide;
export const byRater = repo.byRater;

export interface RatingInput {
    stars: number;
    tags?: string[];
    comment?: string | null;
}

export function rate(rideId: number, userId: number, input: RatingInput): RatingRow {
    const ride = rides.getForParticipant(rideId, userId);
    if (ride.status !== "completed" || !ride.driver_id)
        throw new AppError("RIDE_STATE_CONFLICT", "You can rate a ride once it's completed.");

    const stars = Math.round(Number(input.stars));
    if (!(stars >= 1 && stars <= 5)) throw new AppError("VALIDATION_FAILED", "Choose between 1 and 5 stars.");
    const isRider = ride.rider_id === userId;
    const allowed = isRider ? RIDER_TAGS : DRIVER_TAGS;
    const tags = [...new Set(input.tags || [])].filter((tag) => allowed.includes(tag));
    const comment =
        String(input.comment ?? "")
            .trim()
            .slice(0, 300) || null;
    const rateeId = isRider ? ride.driver_id : ride.rider_id;

    if (!repo.insert({ rideId, raterId: userId, rateeId, stars, tags, comment })) {
        throw new AppError("CONFLICT", "You've already rated this ride.");
    }
    bus.emit("ride.rated", { rideId, riderId: ride.rider_id, driverId: ride.driver_id, actorId: userId, stars, rateeId });
    return repo.byRater(rideId, userId)!;
}
