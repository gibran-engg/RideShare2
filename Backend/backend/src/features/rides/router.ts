import { z } from "zod";
import { AppError } from "../../../../lib/errors.ts";
import * as rides from "../../../../services/rides/service.ts";
import type { RideRow } from "../../../../lib/types.ts";
import { requireReady } from "../../core/auth.ts";
import { createModule } from "../../core/route.ts";
import { IdParams, PageQuery, PaymentMethod, VehicleType, page, toPage } from "../../core/schemas.ts";
import { Earnings } from "../drivers/schemas.ts";
import { Estimate, Ride, RideEnvelope, TripBody, toRide } from "./schemas.ts";

const { router, add } = createModule();
const tags = ["Rides"];
const riderOnly = requireReady("rider");
const driverOnly = requireReady("driver");

// ---- Rider ----

add(
    {
        method: "post",
        path: "/rides/estimate",
        summary: "Route, fare and ETA for every vehicle type",
        tags,
        before: [riderOnly],
        body: TripBody,
        response: Estimate,
        errors: [403]
    },
    ({ body }) => rides.estimate(body.pickup, body.drop)
);

add(
    {
        method: "post",
        path: "/rides",
        summary: "Book a ride (the fare is computed on the server)",
        tags,
        before: [riderOnly],
        idempotent: true,
        body: TripBody.extend({ vehicleType: VehicleType.optional(), paymentMethod: PaymentMethod.default("cash") }),
        response: RideEnvelope,
        status: 201,
        errors: [403, 409, 422]
    },
    async ({ user, body }) => {
        if (!body.vehicleType) throw new AppError("VALIDATION_FAILED", "Please choose a vehicle type.");
        const ride = await rides.request(user.id, {
            pickup: body.pickup!,
            drop: body.drop!,
            vehicleType: body.vehicleType,
            paymentMethod: body.paymentMethod
        });
        return { ride: toRide(ride, user.id) };
    }
);

// ---- Rider and driver ----

add({ method: "get", path: "/rides/active", summary: "The user's current ride, if any", tags, response: RideEnvelope }, ({ user }) => {
    const ride = user.role === "driver" ? rides.activeForDriver(user.id) : rides.activeForRider(user.id);
    return { ride: toRide(ride, user.id) };
});

add(
    {
        method: "get",
        path: "/rides",
        summary: "Recent rides (rider) or trips (driver). Prefer /me/rides and /me/trips, which paginate.",
        tags,
        response: z.object({ rides: z.array(Ride) })
    },
    ({ user }) => ({ rides: rides.historyFor(user.id, user.role, { limit: 100 }).items.map((ride) => toRide(ride, user.id)) })
);

add(
    {
        method: "get",
        path: "/rides/:id",
        summary: "One of the user's rides",
        tags,
        params: IdParams,
        response: RideEnvelope,
        errors: [404]
    },
    ({ user, params }) => ({ ride: toRide(rides.getForParticipant(params.id, user.id), user.id) })
);

add(
    {
        method: "post",
        path: "/rides/:id/cancel",
        summary: "Rider cancels, or driver releases the ride back to the queue",
        tags,
        params: IdParams,
        body: z.object({ reason: z.string().trim().max(300).nullish() }),
        response: RideEnvelope,
        errors: [404, 409]
    },
    ({ user, params, body }) => {
        const by = user.role === "driver" ? "driver" : "rider";
        const ride = rides.cancel(params.id, { by, userId: user.id, reason: body.reason || null });
        // A driver releasing a ride is no longer part of it.
        return { ride: by === "driver" ? null : toRide(ride, user.id) };
    }
);

// ---- Driver trip steps ----

function driverStep(path: string, summary: string, action: (rideId: number, driverId: number, otp?: string) => RideRow, withOtp = false) {
    add(
        {
            method: "post",
            path,
            summary,
            tags: ["Driver"],
            before: [driverOnly],
            params: IdParams,
            body: withOtp ? z.object({ otp: z.string({ message: "Enter the rider's 4-digit OTP." }).trim().max(10) }) : undefined,
            response: RideEnvelope,
            errors: [403, 404, 409]
        },
        ({ user, params, body }) => ({ ride: toRide(action(params.id, user.id, (body as { otp?: string } | undefined)?.otp), user.id) })
    );
}

driverStep("/rides/:id/accept", "Accept a requested ride", rides.accept);
driverStep("/rides/:id/arrived", "Tell the rider you've arrived", rides.arrive);
driverStep("/rides/:id/start", "Start the trip with the rider's OTP", rides.start, true);
driverStep("/rides/:id/complete", "Complete the trip (opens the payment)", rides.complete);

// ---- History ----

add(
    {
        method: "get",
        path: "/me/rides",
        summary: "Rides I took as a rider, newest first",
        tags: ["History"],
        query: PageQuery,
        response: page(Ride)
    },
    ({ user, query }) => toPage(rides.historyFor(user.id, "rider", query), (ride) => toRide(ride, user.id)!)
);

add(
    {
        method: "get",
        path: "/me/trips",
        summary: "Trips I made as a driver, newest first, with earnings",
        tags: ["History"],
        query: PageQuery,
        response: page(Ride).extend({ earnings: Earnings }),
        errors: [403]
    },
    ({ user, query }) => {
        if (user.role !== "driver") throw new AppError("FORBIDDEN", "Only drivers have trips.");
        return {
            ...toPage(rides.historyFor(user.id, "driver", query), (ride) => toRide(ride, user.id)!),
            earnings: rides.earnings(user.id)
        };
    }
);

export default router;
