import { AppError } from "../../lib/errors.ts";
import type { RideStatus } from "../../lib/types.ts";

export type RideActor = "rider" | "driver" | "admin";

/**
 * The ride lifecycle as data. Every status change in the system goes through `assertTransition`,
 * so an illegal move (completing a ride that never started, a rider "accepting" a ride...) is
 * impossible regardless of which endpoint asks for it.
 *
 *   requested ─accept─► accepted ─arrive─► arrived ─start(OTP)─► in_progress ─complete─► completed
 *       ▲                  │  └──────────start(OTP)──────────────┘
 *       └──release (driver)┘ (also from arrived)
 *   cancel: rider until the trip starts, admin until it ends.
 */
const TRANSITIONS: Record<RideStatus, Partial<Record<RideStatus, readonly RideActor[]>>> = {
    requested: { accepted: ["driver"], cancelled: ["rider", "admin"] },
    accepted: { arrived: ["driver"], in_progress: ["driver"], requested: ["driver"], cancelled: ["rider", "admin"] },
    arrived: { in_progress: ["driver"], requested: ["driver"], cancelled: ["rider", "admin"] },
    in_progress: { completed: ["driver"], cancelled: ["admin"] },
    completed: {},
    cancelled: {}
};

export const ACTIVE_STATUSES: readonly RideStatus[] = ["requested", "accepted", "arrived", "in_progress"];

export const STATUS_LABELS: Record<RideStatus, string> = {
    requested: "Finding a driver",
    accepted: "Driver on the way",
    arrived: "Driver has arrived",
    in_progress: "On trip",
    completed: "Completed",
    cancelled: "Cancelled"
};

/** Timestamp column set when a ride enters a status. */
export const STATUS_TIMESTAMP: Partial<Record<RideStatus, string>> = {
    accepted: "accepted_at",
    arrived: "arrived_at",
    in_progress: "started_at",
    completed: "completed_at",
    cancelled: "cancelled_at"
};

export function canTransition(from: RideStatus, to: RideStatus, actor: RideActor): boolean {
    return Boolean(TRANSITIONS[from]?.[to]?.includes(actor));
}

export function assertTransition(from: RideStatus, to: RideStatus, actor: RideActor): void {
    if (canTransition(from, to, actor)) return;
    const message =
        to === "cancelled" ? "This ride can no longer be cancelled." : "This ride can't be updated right now. Refresh and try again.";
    throw new AppError("RIDE_STATE_CONFLICT", message, { from, to, actor });
}

export function isActive(status: RideStatus): boolean {
    return ACTIVE_STATUSES.includes(status);
}
