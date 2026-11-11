import crypto from "node:crypto";
import * as db from "../../db/index.ts";
import { assertTransition } from "./state.ts";
import type { RideActor } from "./state.ts";
import { AppError } from "../../lib/errors.ts";
import { bus } from "../../lib/events.ts";
import * as repo from "./repository.ts";
import type { DriverRow, NamedPoint, Page, PageQuery, PaymentMethod, Role, RideRow, RideStatus, VehicleType } from "../../lib/types.ts";
import * as drivers from "../drivers/service.ts";
import * as usersRepo from "../users/repository.ts";
import * as fare from "./fare.ts";
import * as geo from "../places/service.ts";
import * as payments from "../payments/service.ts";
import * as sms from "../../lib/sms.ts";
import * as audit from "../../lib/audit.ts";

// Drivers only see requests whose pickup is within this distance of them.
export const MATCH_RADIUS_KM = 12;

export const get = repo.get;
export const list = repo.list;
export const stats = repo.stats;
export const earnings = repo.earnings;
export const riderSummary = repo.riderSummary;

export interface LocationInput {
    lat: number;
    lng: number;
    name?: string | null;
}

function location(input: LocationInput | null | undefined, label: string): NamedPoint {
    const point = {
        lat: Number(input?.lat),
        lng: Number(input?.lng),
        name: String(input?.name || "")
            .trim()
            .slice(0, 120)
    };
    if (!geo.isPoint(point)) throw new AppError("VALIDATION_FAILED", `Please choose a ${label} location.`);
    if (!point.name) point.name = `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
    return point;
}

function resolveTrip(pickupInput: LocationInput | null | undefined, dropInput: LocationInput | null | undefined) {
    const pickup = location(pickupInput, "pickup");
    const drop = location(dropInput, "drop");
    if (geo.haversineKm(pickup, drop) < 0.2) throw new AppError("VALIDATION_FAILED", "Pickup and drop are too close together.");
    return { pickup, drop };
}

export interface FareOption {
    type: VehicleType;
    label: string;
    seats: number;
    distanceKm: number;
    durationMin: number;
    fare: number;
}

/** Route plus fare and ETA for every vehicle type. */
export async function estimate(pickupInput: LocationInput | null | undefined, dropInput: LocationInput | null | undefined) {
    const { pickup, drop } = resolveTrip(pickupInput, dropInput);
    const carRoute = await geo.route(pickup, drop, "car");
    const options = fare.VEHICLE_TYPES.map((type): FareOption => {
        const speedRatio = geo.AVERAGE_SPEED_KMH.car / geo.AVERAGE_SPEED_KMH[type];
        const durationMin = Math.max(2, Math.round(carRoute.durationMin * speedRatio));
        return {
            type,
            label: fare.RATE_CARD[type].label,
            seats: fare.RATE_CARD[type].seats,
            distanceKm: carRoute.distanceKm,
            durationMin,
            fare: fare.calculate(type, carRoute.distanceKm, durationMin)
        };
    });
    return { pickup, drop, route: carRoute, options };
}

/** A ride the given user is part of, or 404 (never reveal other people's rides). */
export function getForParticipant(rideId: number, userId: number): RideRow {
    const ride = repo.get(rideId);
    if (!ride || (ride.rider_id !== userId && ride.driver_id !== userId)) {
        throw new AppError("RIDE_NOT_FOUND", "Ride not found.");
    }
    return ride;
}

export function activeForRider(riderId: number): RideRow | null {
    return repo.activeFor("rider_id", riderId);
}

export function activeForDriver(driverId: number): RideRow | null {
    return repo.activeFor("driver_id", driverId);
}

function ref(ride: RideRow, actorId: number | null) {
    return { rideId: ride.id, riderId: ride.rider_id, driverId: ride.driver_id, actorId };
}

/**
 * The one place a ride changes status: checks the state machine, then writes with an optimistic
 * lock on the version that was read, so two concurrent requests can't both succeed.
 */
type RideSet = Parameters<typeof repo.transition>[3];
function move(ride: RideRow, to: RideStatus, actor: RideActor, set: RideSet = {}): RideRow {
    assertTransition(ride.status, to, actor);
    if (!repo.transition(ride.id, ride.version, to, set)) {
        throw new AppError("RIDE_STATE_CONFLICT", "This ride was just updated. Refresh and try again.");
    }
    return repo.get(ride.id)!;
}

export interface RideRequest {
    pickup: LocationInput;
    drop: LocationInput;
    vehicleType: VehicleType;
    paymentMethod?: PaymentMethod;
}

export async function request(riderId: number, input: RideRequest): Promise<RideRow> {
    const { pickup, drop } = resolveTrip(input.pickup, input.drop);
    if (!fare.isVehicleType(input.vehicleType)) throw new AppError("VALIDATION_FAILED", "Please choose a vehicle type.");
    const paymentMethod = input.paymentMethod ?? "cash";

    // Price is always computed on the server, never taken from the app.
    const quote = await estimate(pickup, drop);
    const option = quote.options.find((item) => item.type === input.vehicleType)!;
    const otp = crypto.randomInt(0, 10_000).toString().padStart(4, "0");

    const rideId = db.transaction(() => {
        if (repo.activeFor("rider_id", riderId)) throw new AppError("ACTIVE_RIDE_EXISTS", "You already have a ride in progress.");
        return repo.insert({
            riderId,
            pickup,
            drop,
            vehicleType: input.vehicleType,
            distanceKm: option.distanceKm,
            durationMin: option.durationMin,
            fare: option.fare,
            otp,
            routeGeometry: quote.route.geometry,
            paymentMethod
        });
    });

    const ride = repo.get(rideId)!;
    bus.emit("ride.requested", { ...ref(ride, riderId), fare: ride.fare, paymentMethod });
    return ride;
}

/** Requested rides a driver could take: same vehicle type, pickup nearby, nearest first. */
export function openRequestsFor(driver: DriverRow | null): RideRow[] {
    if (!driver || !driver.is_online || driver.lat == null || driver.lng == null) return [];
    const here = { lat: driver.lat, lng: driver.lng };
    return repo
        .requestedOfType(driver.vehicle_type)
        .map((ride) => ({
            ...ride,
            pickup_distance_km: Math.round(geo.haversineKm(here, { lat: ride.pickup_lat, lng: ride.pickup_lng }) * 10) / 10
        }))
        .filter((ride) => ride.pickup_distance_km <= MATCH_RADIUS_KM)
        .sort((a, b) => a.pickup_distance_km - b.pickup_distance_km);
}

export function accept(rideId: number, driverId: number): RideRow {
    const driver = drivers.requireApproved(driverId);
    if (!driver.is_online) throw new AppError("BAD_REQUEST", "Go online to accept rides.");

    const ride = db.transaction(() => {
        if (repo.activeFor("driver_id", driverId)) throw new AppError("ACTIVE_RIDE_EXISTS", "Finish your current ride first.");
        const current = repo.get(rideId);
        if (!current || current.status !== "requested" || current.vehicle_type !== driver.vehicle_type) {
            throw new AppError("RIDE_UNAVAILABLE", "Sorry, this ride is no longer available.");
        }
        try {
            return move(current, "accepted", "driver", { driver_id: driverId });
        } catch (err) {
            // Another driver got there first.
            if (err instanceof AppError && err.code === "RIDE_STATE_CONFLICT") {
                throw new AppError("RIDE_UNAVAILABLE", "Sorry, this ride is no longer available.");
            }
            throw err;
        }
    });

    sms.send({
        userId: ride.rider_id,
        phone: ride.rider_phone,
        message: `${ride.driver_name} is on the way in a ${[ride.vehicle_color, ride.vehicle_make, ride.vehicle_model].filter(Boolean).join(" ")} (${ride.vehicle_plate}). Share OTP ${ride.otp} to start your trip.`
    });
    bus.emit("ride.accepted", ref(ride, driverId));
    return ride;
}

function driversRide(rideId: number, driverId: number): RideRow {
    const ride = getForParticipant(rideId, driverId);
    if (ride.driver_id !== driverId) throw new AppError("RIDE_NOT_FOUND", "Ride not found.");
    return ride;
}

export function arrive(rideId: number, driverId: number): RideRow {
    const ride = move(driversRide(rideId, driverId), "arrived", "driver");
    sms.send({
        userId: ride.rider_id,
        phone: ride.rider_phone,
        message: `Your driver ${ride.driver_name} has arrived at ${ride.pickup_name} (${ride.vehicle_plate}).`
    });
    bus.emit("ride.arrived", ref(ride, driverId));
    return ride;
}

export function start(rideId: number, driverId: number, otp: unknown): RideRow {
    const current = driversRide(rideId, driverId);
    const given = String(otp ?? "").trim();
    if (!/^\d{4}$/.test(given) || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(current.otp))) {
        throw new AppError("OTP_INVALID", "That OTP doesn't match. Ask the rider for the 4-digit code in their app.");
    }
    const ride = move(current, "in_progress", "driver");
    bus.emit("ride.started", ref(ride, driverId));
    return ride;
}

export function complete(rideId: number, driverId: number): RideRow {
    const ride = db.transaction(() => {
        const done = move(driversRide(rideId, driverId), "completed", "driver");
        // Cash is collected by the driver now; card/UPI waits for the rider to pay.
        payments.openForCompletedRide(done);
        return repo.get(done.id)!;
    });
    sms.send({
        userId: ride.rider_id,
        phone: ride.rider_phone,
        message: `Trip completed: ${ride.pickup_name} to ${ride.drop_name}. Fare Rs ${ride.fare}. Thanks for riding with RideShare!`
    });
    bus.emit("ride.completed", { ...ref(ride, driverId), fare: ride.fare });
    return ride;
}

/**
 * Riders can cancel until the trip starts. A driver cancelling releases the ride back to the
 * queue for another driver. Admins can cancel any unfinished ride.
 */
export function cancel(rideId: number, { by, userId, reason = null }: { by: RideActor; userId: number; reason?: string | null }): RideRow {
    const ride = repo.get(rideId);
    if (!ride) throw new AppError("RIDE_NOT_FOUND", "Ride not found.");
    if (by === "rider" && ride.rider_id !== userId) throw new AppError("RIDE_NOT_FOUND", "Ride not found.");
    if (by === "driver" && ride.driver_id !== userId) throw new AppError("RIDE_STATE_CONFLICT", "This ride can no longer be cancelled.");

    if (by === "driver") {
        if (ride.status !== "accepted" && ride.status !== "arrived")
            throw new AppError("RIDE_STATE_CONFLICT", "This ride can no longer be cancelled.");
        const released = move(ride, "requested", "driver", { driver_id: null, accepted_at: null, arrived_at: null });
        sms.send({
            userId: ride.rider_id,
            phone: ride.rider_phone,
            message: "Your driver had to cancel. We're finding you another driver."
        });
        bus.emit("ride.released", { ...ref(released, userId), previousDriverId: userId });
        return released;
    }

    const cancelled = move(ride, "cancelled", by, { cancelled_by: by, cancel_reason: reason });
    if (by === "admin") {
        audit.log(userId, "ride.cancel", "ride", rideId, { reason });
        sms.send({ userId: ride.rider_id, phone: ride.rider_phone, message: `Your ride #${rideId} was cancelled by RideShare support.` });
    }
    if (ride.driver_id) {
        sms.send({ userId: ride.driver_id, phone: ride.driver_phone, message: `Ride #${rideId} was cancelled.` });
    }
    bus.emit("ride.cancelled", { ...ref(cancelled, userId), by, reason });
    return cancelled;
}

/** Rides a rider took (role rider) or trips a driver made (role driver), newest first. */
export function historyFor(userId: number, role: Role | null, page: PageQuery = {}): Page<RideRow> {
    return repo.historyFor(role === "driver" ? "driver_id" : "rider_id", userId, page);
}

/**
 * Cheap fingerprint of everything that should refresh a user's screen. The live-update socket
 * compares it periodically, which also picks up changes made by other processes (an admin
 * approving a driver) and the driver's moving position.
 */
export function fingerprint(userId: number): string {
    const own = repo.versionSum(userId);
    const parts: unknown[] = [own.n, own.v];

    // A rider with an active ride also follows the driver's position.
    const active = activeForRider(userId);
    if (active && active.driver_id) parts.push(active.driver_lat, active.driver_lng);

    const driver = drivers.get(userId);
    if (driver) {
        parts.push(driver.verification_status, driver.is_online);
        if (driver.is_online)
            parts.push(
                openRequestsFor(driver)
                    .map((ride) => ride.id)
                    .join(".")
            );
    }
    parts.push(usersRepo.getById(userId)?.status);
    return parts.join("|");
}
