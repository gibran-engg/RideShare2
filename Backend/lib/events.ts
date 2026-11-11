import { EventEmitter } from "node:events";
import type { PaymentMethod, PaymentStatus, VerificationStatus } from "./types.ts";

/**
 * Domain events, emitted by services after their transaction commits. Subscribers (activity log,
 * live updates) react to them, so services don't need to know who is listening.
 *
 * In-process only: the admin app runs in another process, so the API's live-update socket also
 * keeps a slow fingerprint check to pick up changes made there.
 */
interface RideRef {
    rideId: number;
    riderId: number;
    driverId: number | null;
    /** Who caused it (null for the system). */
    actorId: number | null;
}

export interface DomainEvents {
    "user.signed_in": { userId: number; provider: string; app: string; isNew: boolean };
    "user.signed_out": { userId: number };
    "user.profile_saved": { userId: number; role: string };
    "user.phone_verified": { userId: number };
    "user.status_changed": { userId: number; status: "active" | "suspended"; actorId: number };
    "driver.submitted": { userId: number };
    "driver.reviewed": { userId: number; decision: VerificationStatus; reason: string | null; actorId: number };
    "driver.online_changed": { userId: number; online: boolean };
    "driver.location_updated": { userId: number };
    "ride.requested": RideRef & { fare: number; paymentMethod: PaymentMethod };
    "ride.accepted": RideRef;
    "ride.arrived": RideRef;
    "ride.started": RideRef;
    "ride.completed": RideRef & { fare: number };
    "ride.released": RideRef & { previousDriverId: number };
    "ride.cancelled": RideRef & { by: string; reason: string | null };
    "payment.updated": {
        paymentId: number;
        rideId: number;
        riderId: number;
        driverId: number | null;
        status: PaymentStatus;
        amount: number;
        method: PaymentMethod;
        actorId: number | null;
    };
}

export type DomainEventName = keyof DomainEvents;
type Listener<K extends DomainEventName> = (payload: DomainEvents[K], name: K) => void;

class EventBus {
    private emitter = new EventEmitter();

    constructor() {
        this.emitter.setMaxListeners(50);
    }

    on<K extends DomainEventName>(name: K, listener: Listener<K>): () => void {
        const wrapped = (payload: DomainEvents[K]) => listener(payload, name);
        this.emitter.on(name, wrapped);
        return () => this.emitter.off(name, wrapped);
    }

    /** Subscribe to every event. */
    onAny(listener: <K extends DomainEventName>(payload: DomainEvents[K], name: K) => void): () => void {
        const wrapped = (name: DomainEventName, payload: unknown) => listener(payload as never, name);
        this.emitter.on("*", wrapped);
        return () => this.emitter.off("*", wrapped);
    }

    /** A failing subscriber is logged, never breaks the request that emitted the event. */
    emit<K extends DomainEventName>(name: K, payload: DomainEvents[K]): void {
        for (const [channel, args] of [
            [name, [payload]],
            ["*", [name, payload]]
        ] as const) {
            for (const listener of this.emitter.listeners(channel)) {
                try {
                    (listener as (...a: unknown[]) => void)(...args);
                } catch (err) {
                    console.error(`Event subscriber for ${name} failed:`, (err as Error).message);
                }
            }
        }
    }
}

export const bus = new EventBus();
