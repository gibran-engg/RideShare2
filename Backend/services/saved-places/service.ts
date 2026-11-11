import { AppError } from "../../lib/errors.ts";
import type { SavedPlaceRow } from "../../lib/types.ts";
import * as geo from "../places/service.ts";
import * as repo from "./repository.ts";

/** A rider's saved places (Home, Work, or their own labels), one place per label. */

const MAX_PLACES = 10;

export const list = repo.list;

export function save(userId: number, input: { label: string; name: string; lat: number; lng: number }): SavedPlaceRow {
    const place = { ...input, label: input.label.trim().slice(0, 30), name: input.name.trim().slice(0, 120) };
    if (!place.label || !place.name) throw new AppError("VALIDATION_FAILED", "Give the place a label and a name.");
    if (!geo.isPoint(place)) throw new AppError("VALIDATION_FAILED", "Invalid location.");
    if (!repo.byLabel(userId, place.label) && repo.list(userId).length >= MAX_PLACES) {
        throw new AppError("CONFLICT", `You can save up to ${MAX_PLACES} places.`);
    }
    repo.upsert(userId, place);
    return repo.byLabel(userId, place.label)!;
}

export function remove(userId: number, id: number): void {
    if (!repo.remove(userId, id)) throw new AppError("NOT_FOUND", "Saved place not found.");
}
