import { bus } from "../../lib/events.ts";
import type { DomainEventName, DomainEvents } from "../../lib/events.ts";
import * as repo from "./repository.ts";
import type { NewActivity } from "./repository.ts";
import { currentContext } from "../../lib/request-context.ts";
import type { ActivityRow, Page, PageQuery } from "../../lib/types.ts";

/**
 * Per-user activity timeline (sign-ins, onboarding, every ride step, payments, admin decisions).
 * Built entirely from domain events, so services never call it directly.
 */

type Entry = Omit<NewActivity, "ip" | "userAgent">;

function rideEntries(
    type: string,
    e: { rideId: number; riderId: number; driverId: number | null; actorId: number | null },
    extra: Record<string, unknown> = {}
): Entry[] {
    const users = new Set([e.riderId, e.driverId].filter((id): id is number => id != null));
    return [...users].map((userId) => ({
        userId,
        type,
        entityType: "ride",
        entityId: e.rideId,
        metadata: { ...extra, by: e.actorId === userId ? "self" : e.actorId == null ? "system" : userId === e.riderId ? "driver" : "rider" }
    }));
}

/** Which users' timelines an event belongs on, and how it reads there. */
const MAPPERS: { [K in DomainEventName]?: (e: DomainEvents[K]) => Entry[] } = {
    "user.signed_in": (e) => [
        { userId: e.userId, type: e.isNew ? "account.created" : "auth.signed_in", metadata: { provider: e.provider, app: e.app } }
    ],
    "user.signed_out": (e) => [{ userId: e.userId, type: "auth.signed_out" }],
    "user.profile_saved": (e) => [{ userId: e.userId, type: "onboarding.profile_saved", metadata: { role: e.role } }],
    "user.phone_verified": (e) => [{ userId: e.userId, type: "onboarding.phone_verified" }],
    "user.status_changed": (e) => [
        { userId: e.userId, type: e.status === "suspended" ? "account.suspended" : "account.reinstated", metadata: { adminId: e.actorId } }
    ],
    "driver.submitted": (e) => [{ userId: e.userId, type: "driver.documents_submitted", entityType: "driver", entityId: e.userId }],
    "driver.reviewed": (e) => [
        {
            userId: e.userId,
            type: e.decision === "approved" ? "driver.approved" : "driver.rejected",
            entityType: "driver",
            entityId: e.userId,
            metadata: { reason: e.reason, adminId: e.actorId }
        }
    ],
    "driver.online_changed": (e) => [{ userId: e.userId, type: e.online ? "driver.went_online" : "driver.went_offline" }],
    "ride.requested": (e) => rideEntries("ride.requested", e, { fare: e.fare, paymentMethod: e.paymentMethod }),
    "ride.accepted": (e) => rideEntries("ride.accepted", e),
    "ride.arrived": (e) => rideEntries("ride.driver_arrived", e),
    "ride.started": (e) => rideEntries("ride.started", e),
    "ride.completed": (e) => rideEntries("ride.completed", e, { fare: e.fare }),
    "ride.released": (e) => [
        ...rideEntries("ride.driver_released", e),
        { userId: e.previousDriverId, type: "ride.released", entityType: "ride", entityId: e.rideId, metadata: { by: "self" } }
    ],
    "ride.cancelled": (e) => rideEntries("ride.cancelled", e, { cancelledBy: e.by, reason: e.reason }),
    "payment.updated": (e) =>
        rideEntries(
            `payment.${e.status}`,
            { rideId: e.rideId, riderId: e.riderId, driverId: e.driverId, actorId: e.actorId },
            {
                paymentId: e.paymentId,
                amount: e.amount,
                method: e.method
            }
        )
};

export function entriesFor<K extends DomainEventName>(name: K, payload: DomainEvents[K]): Entry[] {
    const mapper = MAPPERS[name] as ((e: DomainEvents[K]) => Entry[]) | undefined;
    return mapper ? mapper(payload) : [];
}

let recording = false;

/** Start recording. Each process that changes data (API, admin app) calls this once. */
export function startRecording(): void {
    if (recording) return;
    recording = true;
    bus.onAny((payload, name) => {
        const context = currentContext();
        for (const entry of entriesFor(name, payload)) {
            repo.insert({ ...entry, ip: context?.ip ?? null, userAgent: context?.userAgent ?? null });
        }
    });
}

export function listFor(userId: number, page: PageQuery = {}): Page<ActivityRow> {
    return repo.listFor(userId, page);
}

/** Readable label for the admin timeline. */
export const ACTIVITY_LABELS: Record<string, string> = {
    "account.created": "Created account",
    "auth.signed_in": "Signed in",
    "auth.signed_out": "Signed out",
    "account.suspended": "Account suspended",
    "account.reinstated": "Account reinstated",
    "onboarding.profile_saved": "Saved profile",
    "onboarding.phone_verified": "Verified phone",
    "driver.documents_submitted": "Submitted driver documents",
    "driver.approved": "Driver profile approved",
    "driver.rejected": "Driver profile needs changes",
    "driver.went_online": "Went online",
    "driver.went_offline": "Went offline",
    "ride.requested": "Ride requested",
    "ride.accepted": "Ride accepted",
    "ride.driver_arrived": "Driver arrived",
    "ride.started": "Trip started",
    "ride.completed": "Trip completed",
    "ride.driver_released": "Driver released the ride",
    "ride.released": "Released ride",
    "ride.cancelled": "Ride cancelled",
    "payment.pending": "Payment due",
    "payment.succeeded": "Payment received",
    "payment.failed": "Payment failed",
    "payment.refunded": "Payment refunded"
};
