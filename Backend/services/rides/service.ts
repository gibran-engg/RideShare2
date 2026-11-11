import crypto from "node:crypto";
import * as db from "../../db/index.ts";
import { assertTransition, isActive } from "./state.ts";
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
import config from "../../lib/config.ts";
import * as chat from "../chat/repository.ts";

// Drivers only see requests whose pickup is within this distance of them.
export const MATCH_RADIUS_KM = 12;
// The trip OTP is created when the driver arrives and works for this long.
export const OTP_TTL_MS = 15 * 60 * 1000;
// Wrong entries allowed per code; after that a new code is sent to the rider.
export const MAX_OTP_ATTEMPTS = 3;
// Charged (to the driver's benefit) when a rider cancels after the driver has arrived, in rupees.
export const CANCELLATION_FEE = 30;

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
    breakdown: fare.FareQuote;
}

type Estimate = Awaited<ReturnType<typeof computeEstimate>>;

/**
 * Quotes shown to riders, so booking charges exactly the price on screen even if traffic changes
 * the route in between. Kept on the server (the app only holds the id), single use, 10 minutes.
 */
const QUOTE_TTL_MS = 10 * 60 * 1000;
const quotes = new Map<string, { riderId: number; estimate: Estimate; expiresAt: number }>();

function samePlace(a: LocationInput, b: LocationInput): boolean {
    return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
}

/** Route plus fare (with the current pricing segment) and ETA for every vehicle type. */
export async function estimate(
    pickupInput: LocationInput | null | undefined,
    dropInput: LocationInput | null | undefined,
    { at = new Date(), riderId = null }: { at?: Date; riderId?: number | null } = {}
): Promise<Estimate & { quoteId: string | null }> {
    const result = await computeEstimate(pickupInput, dropInput, at);
    if (riderId == null) return { ...result, quoteId: null };

    const now = Date.now();
    for (const [id, saved] of quotes) if (saved.expiresAt <= now) quotes.delete(id);
    if (quotes.size > 10_000) quotes.delete(quotes.keys().next().value!);
    const quoteId = crypto.randomUUID();
    quotes.set(quoteId, { riderId, estimate: result, expiresAt: now + QUOTE_TTL_MS });
    return { ...result, quoteId };
}

/** The rider's own unexpired quote for exactly this trip, used once; otherwise null. */
function takeQuote(quoteId: string | null | undefined, riderId: number, pickup: LocationInput, drop: LocationInput): Estimate | null {
    const saved = quoteId ? quotes.get(quoteId) : undefined;
    if (!saved) return null;
    quotes.delete(quoteId!);
    const usable =
        saved.riderId === riderId &&
        saved.expiresAt > Date.now() &&
        samePlace(saved.estimate.pickup, pickup) &&
        samePlace(saved.estimate.drop, drop);
    return usable ? saved.estimate : null;
}

async function computeEstimate(pickupInput: LocationInput | null | undefined, dropInput: LocationInput | null | undefined, at: Date) {
    const { pickup, drop } = resolveTrip(pickupInput, dropInput);
    const carRoute = await geo.route(pickup, drop, "car");
    const options = fare.VEHICLE_TYPES.map((type): FareOption => {
        const speedRatio = geo.AVERAGE_SPEED_KMH.car / geo.AVERAGE_SPEED_KMH[type];
        const durationMin = Math.max(2, Math.round(carRoute.durationMin * speedRatio));
        const breakdown = fare.quote(type, carRoute.distanceKm, durationMin, at);
        return {
            type,
            label: fare.RATE_CARD[type].label,
            seats: fare.RATE_CARD[type].seats,
            distanceKm: carRoute.distanceKm,
            durationMin,
            fare: breakdown.fare,
            breakdown
        };
    });
    const segment = fare.segmentAt(at);
    return {
        pickup,
        drop,
        route: carRoute,
        options,
        pricing: { segment: segment.id, label: segment.label, multiplier: segment.multiplier }
    };
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
    /** From the estimate the rider saw; books at that price if it's still valid. */
    quoteId?: string | null;
}

export async function request(riderId: number, input: RideRequest): Promise<RideRow> {
    const { pickup, drop } = resolveTrip(input.pickup, input.drop);
    if (!fare.isVehicleType(input.vehicleType)) throw new AppError("VALIDATION_FAILED", "Please choose a vehicle type.");
    const paymentMethod = input.paymentMethod ?? "cash";

    // Price is always computed on the server, never taken from the app: the quote the rider was shown
    // (kept server-side), or a fresh one if it expired. The pricing segment is fixed now.
    const quote = takeQuote(input.quoteId, riderId, pickup, drop) ?? (await computeEstimate(pickup, drop, new Date()));
    const option = quote.options.find((item) => item.type === input.vehicleType)!;

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
            pricingSegment: option.breakdown.segment,
            fareMultiplier: option.breakdown.multiplier,
            fareBase: option.breakdown.base,
            fareDistance: option.breakdown.distanceCharge,
            fareTime: option.breakdown.timeCharge,
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
        message: `${ride.driver_name} is on the way in a ${[ride.vehicle_color, ride.vehicle_make, ride.vehicle_model].filter(Boolean).join(" ")} (${ride.vehicle_plate}). You'll get your trip OTP when they arrive.`
    });
    bus.emit("ride.accepted", ref(ride, driverId));
    return ride;
}

function driversRide(rideId: number, driverId: number): RideRow {
    const ride = getForParticipant(rideId, driverId);
    if (ride.driver_id !== driverId) throw new AppError("RIDE_NOT_FOUND", "Ride not found.");
    return ride;
}

/** A fresh 4-digit trip OTP for a ride whose driver has arrived, valid for OTP_TTL_MS. Only the rider sees it. */
function issueOtp(ride: RideRow, actorId: number): RideRow {
    const otp = crypto.randomInt(0, 10_000).toString().padStart(4, "0");
    repo.setOtp(ride.id, otp, Date.now() + OTP_TTL_MS);
    const updated = repo.get(ride.id)!;
    sms.send({
        userId: ride.rider_id,
        phone: ride.rider_phone,
        message: `Your RideShare trip OTP is ${otp}. Share it with your driver (${ride.vehicle_plate}) to start the trip. It expires in 15 minutes.`
    });
    bus.emit("ride.otp_issued", ref(updated, actorId));
    return updated;
}

export function otpExpired(ride: RideRow, now = Date.now()): boolean {
    return !ride.otp || ride.otp_expires_at == null || ride.otp_expires_at <= now;
}

export function arrive(rideId: number, driverId: number): RideRow {
    const arrived = move(driversRide(rideId, driverId), "arrived", "driver");
    sms.send({
        userId: arrived.rider_id,
        phone: arrived.rider_phone,
        message: `Your driver ${arrived.driver_name} has arrived at ${arrived.pickup_name} (${arrived.vehicle_plate}).`
    });
    bus.emit("ride.arrived", ref(arrived, driverId));
    // The OTP is created now, not at booking, so it can't be shared or guessed before the driver is there.
    return issueOtp(arrived, driverId);
}

/** The rider asks for a new code (the old one expired, or they want a fresh one). */
export function refreshOtp(rideId: number, riderId: number): RideRow {
    const ride = getForParticipant(rideId, riderId);
    if (ride.rider_id !== riderId) throw new AppError("RIDE_NOT_FOUND", "Ride not found.");
    if (ride.status !== "arrived") throw new AppError("RIDE_STATE_CONFLICT", "You'll get an OTP when your driver arrives.");
    return issueOtp(ride, riderId);
}

export function start(rideId: number, driverId: number, otp: unknown): RideRow {
    const current = driversRide(rideId, driverId);
    if (current.status !== "arrived") throw new AppError("RIDE_STATE_CONFLICT", 'Tap "I\'ve arrived" first; the rider gets the OTP then.');
    if (otpExpired(current)) {
        throw new AppError("OTP_EXPIRED", 'The rider\'s OTP expired. Ask them to tap "New code" in their app.');
    }
    const given = String(otp ?? "").trim();
    if (!/^\d{4}$/.test(given) || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(current.otp))) {
        if (repo.countOtpAttempt(current.id) >= MAX_OTP_ATTEMPTS) {
            issueOtp(current, driverId);
            throw new AppError("OTP_INVALID", "Too many wrong tries. The rider has been sent a new code; ask them for it.");
        }
        throw new AppError("OTP_INVALID", "That OTP doesn't match. Ask the rider for the 4-digit code in their app.");
    }
    const ride = move(current, "in_progress", "driver", { otp: "", otp_expires_at: null });
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

    // A rider who cancels after the driver has arrived pays a small fee to the driver.
    const fee = by === "rider" && ride.status === "arrived" ? CANCELLATION_FEE : 0;
    const cancelled = move(ride, "cancelled", by, {
        cancelled_by: by,
        cancel_reason: reason,
        cancellation_fee: fee,
        otp: "",
        otp_expires_at: null
    });
    if (by === "admin") {
        audit.log(userId, "ride.cancel", "ride", rideId, { reason });
        sms.send({ userId: ride.rider_id, phone: ride.rider_phone, message: `Your ride #${rideId} was cancelled by RideShare support.` });
    }
    if (ride.driver_id) {
        sms.send({ userId: ride.driver_id, phone: ride.driver_phone, message: `Ride #${rideId} was cancelled.` });
    }
    bus.emit("ride.cancelled", { ...ref(cancelled, userId), by, reason, fee });
    return cancelled;
}

/**
 * SOS from the rider or driver during a ride: recorded on the ride (admins see it), logged, and
 * support is alerted. The app also offers to call the emergency number 112.
 */
export function sos(rideId: number, userId: number): RideRow {
    const ride = getForParticipant(rideId, userId);
    if (!isActive(ride.status) || ride.status === "requested") throw new AppError("RIDE_STATE_CONFLICT", "SOS is available during a ride.");
    repo.markSos(ride.id);
    const who =
        ride.rider_id === userId ? `rider ${ride.rider_name} (${ride.rider_phone})` : `driver ${ride.driver_name} (${ride.driver_phone})`;
    sms.send({
        userId: null,
        phone: "support",
        message: `SOS on ride #${ride.id} from ${who}. Driver location: ${ride.driver_lat}, ${ride.driver_lng}. Vehicle ${ride.vehicle_plate}.`
    });
    audit.log(userId, "ride.sos", "ride", ride.id);
    const updated = repo.get(ride.id)!;
    bus.emit("ride.sos", ref(updated, userId));
    return updated;
}

/** A link the rider can send to family or friends to follow the trip live (no sign-in needed). */
export function shareLink(rideId: number, riderId: number): string {
    const ride = getForParticipant(rideId, riderId);
    if (ride.rider_id !== riderId) throw new AppError("RIDE_NOT_FOUND", "Ride not found.");
    if (!isActive(ride.status)) throw new AppError("RIDE_STATE_CONFLICT", "Only an ongoing ride can be shared.");
    repo.setShareToken(ride.id, crypto.randomBytes(18).toString("base64url"));
    const token = repo.get(ride.id)!.share_token!;
    bus.emit("ride.shared", ref(ride, riderId));
    return `${config.urls.web}/track/${token}`;
}

/** What a shared link shows: the trip and the driver's live position, never phone numbers or the OTP. */
export function sharedRide(token: string) {
    const ride = token ? repo.getByShareToken(token) : null;
    if (!ride) throw new AppError("RIDE_NOT_FOUND", "This trip link isn't valid.");
    const active = isActive(ride.status);
    return {
        status: ride.status,
        riderFirstName: (ride.rider_name || "").split(" ")[0] || null,
        pickup: { name: ride.pickup_name, lat: ride.pickup_lat, lng: ride.pickup_lng },
        drop: { name: ride.drop_name, lat: ride.drop_lat, lng: ride.drop_lng },
        driver: ride.driver_id
            ? {
                  name: ride.driver_name,
                  vehicle: [ride.vehicle_color, ride.vehicle_make, ride.vehicle_model].filter(Boolean).join(" "),
                  plate: ride.vehicle_plate,
                  location:
                      active && ride.driver_lat != null && ride.driver_lng != null ? { lat: ride.driver_lat, lng: ride.driver_lng } : null
              }
            : null,
        updatedAt: new Date().toISOString()
    };
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
    // New chat messages on the user's current ride.
    const current = active || activeForDriver(userId);
    if (current) parts.push(chat.lastId(current.id));

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
