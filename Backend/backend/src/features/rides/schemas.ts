import { z } from "zod";
import * as rideState from "../../../../services/rides/state.ts";
import * as fare from "../../../../services/rides/fare.ts";
import * as ratings from "../../../../services/ratings/repository.ts";
import type { RideRow } from "../../../../lib/types.ts";
import { registry } from "../../core/openapi.ts";
import { PaymentMethod, VehicleType } from "../../core/schemas.ts";

const Location = registry.register(
    "Location",
    z.object({
        lat: z.number().openapi({ example: 19.0863 }),
        lng: z.number().openapi({ example: 72.9081 }),
        name: z.string().max(120).optional().openapi({ example: "Ghatkopar Station" })
    })
);

export const TripBody = z.object({ pickup: Location.nullish(), drop: Location.nullish() });

const Point = z.object({ lat: z.number(), lng: z.number() });
const Stop = Point.extend({ name: z.string() });

const RatingSummary = z.object({ average: z.number().nullable(), count: z.number() });

export const Pricing = registry.register(
    "Pricing",
    z.object({
        segment: z.enum(["normal", "peak", "night"]),
        label: z.string().openapi({ example: "Peak hours" }),
        multiplier: z.number().openapi({ example: 1.5 })
    })
);

const FareBreakdown = z.object({
    base: z.number(),
    distanceCharge: z.number(),
    timeCharge: z.number(),
    multiplier: z.number(),
    minimumApplied: z.boolean().optional(),
    fare: z.number()
});

export const MyRating = z.object({ stars: z.number(), tags: z.array(z.string()), comment: z.string().nullable() });

export const Ride = registry.register(
    "Ride",
    z.object({
        id: z.number(),
        status: z.enum(["requested", "accepted", "arrived", "in_progress", "completed", "cancelled"]),
        statusLabel: z.string(),
        viewerRole: z.enum(["rider", "driver"]),
        pickup: Stop,
        drop: Stop,
        vehicleType: VehicleType,
        distanceKm: z.number(),
        durationMin: z.number(),
        fare: z.number(),
        pricing: Pricing,
        fareBreakdown: FareBreakdown.nullable(),
        cancellationFee: z.number(),
        paymentMethod: PaymentMethod,
        paymentStatus: z.enum(["unpaid", "pending", "paid", "failed", "refunded"]),
        route: z.array(z.tuple([z.number(), z.number()])).nullable(),
        otp: z.string().nullable().openapi({ description: "Only for the rider, after the driver arrives, until it expires" }),
        otpExpiresAt: z.string().nullable(),
        rider: z.object({ name: z.string().nullable(), phone: z.string().nullable(), rating: RatingSummary }),
        driver: z
            .object({
                name: z.string().nullable(),
                phone: z.string().nullable(),
                vehicle: z.object({
                    make: z.string().nullable(),
                    model: z.string().nullable(),
                    plate: z.string().nullable(),
                    color: z.string().nullable()
                }),
                location: Point.nullable(),
                rating: RatingSummary
            })
            .nullable(),
        myRating: MyRating.nullable().openapi({ description: "The viewer's rating of this ride, once given" }),
        sosAt: z.string().nullable(),
        pickupDistanceKm: z.number().optional(),
        cancelledBy: z.string().nullable(),
        cancelReason: z.string().nullable(),
        times: z.record(z.string(), z.string().nullable())
    })
);

export const RideEnvelope = z.object({ ride: Ride.nullable() });

export const Estimate = z.object({
    pickup: Location,
    drop: Location,
    route: z.object({
        distanceKm: z.number(),
        durationMin: z.number(),
        geometry: z.array(z.tuple([z.number(), z.number()])),
        source: z.string()
    }),
    options: z.array(
        z.object({
            type: VehicleType,
            label: z.string(),
            seats: z.number(),
            distanceKm: z.number(),
            durationMin: z.number(),
            fare: z.number(),
            breakdown: FareBreakdown.extend({ segment: z.string(), segmentLabel: z.string() })
        })
    ),
    pricing: Pricing,
    quoteId: z.string().nullable().openapi({ description: "Send with the booking to pay exactly these prices (valid 10 minutes)" })
});

function parseTags(value: string | null): string[] {
    try {
        return value ? (JSON.parse(value) as string[]) : [];
    } catch {
        return [];
    }
}

function parseRoute(value: string | null): [number, number][] | null {
    try {
        return value ? (JSON.parse(value) as [number, number][]) : null;
    } catch {
        return null;
    }
}

/**
 * A ride as seen by `viewerId`. The rider sees the OTP (until the trip starts) and the
 * driver's live position; the driver sees the rider's phone. Nobody else gets a ride.
 */
export function toRide(row: RideRow | null, viewerId: number) {
    if (!row) return null;
    const isRider = row.rider_id === viewerId;
    const active = rideState.isActive(row.status);
    const showOtp =
        isRider && row.status === "arrived" && Boolean(row.otp) && row.otp_expires_at != null && row.otp_expires_at > Date.now();
    const myRating = row.status === "completed" ? ratings.byRater(row.id, viewerId) : null;
    return {
        id: row.id,
        status: row.status,
        statusLabel: rideState.STATUS_LABELS[row.status],
        viewerRole: isRider ? ("rider" as const) : ("driver" as const),
        pickup: { name: row.pickup_name, lat: row.pickup_lat, lng: row.pickup_lng },
        drop: { name: row.drop_name, lat: row.drop_lat, lng: row.drop_lng },
        vehicleType: row.vehicle_type,
        distanceKm: row.distance_km,
        durationMin: row.duration_min,
        fare: row.fare,
        paymentMethod: row.payment_method,
        paymentStatus: row.payment_status,
        route: parseRoute(row.route_geometry),
        pricing: {
            segment: row.pricing_segment,
            label: fare.PRICING_SEGMENTS[row.pricing_segment]?.label ?? "Normal",
            multiplier: row.fare_multiplier
        },
        fareBreakdown:
            row.fare_base == null
                ? null
                : {
                      base: row.fare_base,
                      distanceCharge: row.fare_distance ?? 0,
                      timeCharge: row.fare_time ?? 0,
                      multiplier: row.fare_multiplier,
                      fare: row.fare
                  },
        cancellationFee: row.cancellation_fee,
        // The OTP exists only once the driver has arrived, and only the rider ever sees it.
        otp: showOtp ? row.otp : null,
        otpExpiresAt: showOtp ? new Date(row.otp_expires_at!).toISOString() : null,
        rider: { name: row.rider_name, phone: !isRider && active ? row.rider_phone : null, rating: ratings.summary(row.rider_id) },
        driver: row.driver_id
            ? {
                  name: row.driver_name,
                  phone: isRider && active ? row.driver_phone : null,
                  vehicle: { make: row.vehicle_make, model: row.vehicle_model, plate: row.vehicle_plate, color: row.vehicle_color },
                  location:
                      isRider && active && row.driver_lat != null && row.driver_lng != null
                          ? { lat: row.driver_lat, lng: row.driver_lng }
                          : null,
                  rating: ratings.summary(row.driver_id)
              }
            : null,
        myRating: myRating ? { stars: myRating.stars, tags: parseTags(myRating.tags), comment: myRating.comment } : null,
        sosAt: row.sos_at,
        pickupDistanceKm: row.pickup_distance_km,
        cancelledBy: row.cancelled_by,
        cancelReason: row.cancel_reason,
        times: {
            requested: row.requested_at,
            accepted: row.accepted_at,
            arrived: row.arrived_at,
            started: row.started_at,
            completed: row.completed_at,
            cancelled: row.cancelled_at
        }
    };
}
