import config from "../../lib/config.ts";
import * as db from "../../db/index.ts";
import { AppError } from "../../lib/errors.ts";
import { bus } from "../../lib/events.ts";
import * as repo from "./repository.ts";
import * as ridesRepo from "../rides/repository.ts";
import type { Page, PageQuery, PaymentMethod, PaymentRow, RideRow } from "../../lib/types.ts";
import * as audit from "../../lib/audit.ts";
import { getGateway } from "./gateway.ts";

/**
 * Payments are a placeholder: cash is collected by the driver at the end of the trip, card and
 * UPI go through the configured gateway (a test-mode mock for now).
 */

/** Admin view: the payment of any ride. */
export const ofRide = repo.forRide;

function announce(payment: PaymentRow, actorId: number | null): void {
    bus.emit("payment.updated", {
        paymentId: payment.id,
        rideId: payment.ride_id,
        riderId: payment.rider_id,
        driverId: payment.driver_id,
        status: payment.status,
        amount: payment.amount,
        method: payment.method,
        actorId
    });
}

/** Called inside the ride-completion transaction. Returns the payment so the caller can announce it. */
export function openForCompletedRide(ride: RideRow): PaymentRow {
    const isCash = ride.payment_method === "cash";
    const id = repo.insert({
        rideId: ride.id,
        riderId: ride.rider_id,
        driverId: ride.driver_id,
        amount: ride.fare,
        currency: config.payments.currency,
        method: ride.payment_method,
        status: isCash ? "succeeded" : "pending",
        provider: isCash ? "cash" : getGateway().name
    });
    ridesRepo.setPaymentStatus(ride.id, isCash ? "paid" : "pending");
    const payment = repo.get(id)!;
    // Emitted synchronously; subscribers only write to other tables.
    announce(payment, ride.driver_id);
    return payment;
}

/** The payment of a ride the user took part in. */
export function forRide(rideId: number, userId: number): PaymentRow | null {
    const ride = ridesRepo.get(rideId);
    if (!ride || (ride.rider_id !== userId && ride.driver_id !== userId)) throw new AppError("RIDE_NOT_FOUND", "Ride not found.");
    return repo.forRide(rideId);
}

/** Where the gateway may send the rider back to: the web app only (no open redirects). */
function safeReturnUrl(value: string | undefined, rideId: number): string {
    const fallback = `${config.urls.web}/trips/${rideId}`;
    if (!value) return fallback;
    try {
        const url = new URL(value);
        return url.origin === new URL(config.urls.web).origin ? url.href : fallback;
    } catch {
        return fallback;
    }
}

export function checkout(
    rideId: number,
    riderId: number,
    { method, returnUrl, baseUrl }: { method: Exclude<PaymentMethod, "cash">; returnUrl?: string; baseUrl: string }
): { payment: PaymentRow; checkoutUrl: string } {
    const ride = ridesRepo.get(rideId);
    if (!ride || ride.rider_id !== riderId) throw new AppError("RIDE_NOT_FOUND", "Ride not found.");
    const payment = repo.forRide(rideId);
    if (!payment) throw new AppError("PAYMENT_NOT_FOUND", "This ride has nothing to pay yet. Payment opens when the trip ends.");
    if (payment.status !== "pending" && payment.status !== "failed") {
        throw new AppError(
            "PAYMENT_STATE_CONFLICT",
            payment.status === "succeeded" ? "This ride is already paid." : "This payment can't be changed."
        );
    }

    const session = getGateway().createCheckout({
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        method,
        description: `RideShare trip #${ride.id}: ${ride.pickup_name} to ${ride.drop_name}`,
        returnUrl: safeReturnUrl(returnUrl, ride.id),
        baseUrl
    });
    db.transaction(() => {
        repo.setProviderRef(payment.id, session.id, method);
        ridesRepo.setPaymentStatus(ride.id, "pending");
    });
    return { payment: repo.get(payment.id)!, checkoutUrl: session.url };
}

/**
 * Signed result from the gateway. Idempotent: providers retry webhooks, and a repeated or
 * out-of-date event leaves the payment unchanged.
 */
export function handleWebhook(rawBody: string, signature: string | undefined): PaymentRow {
    const event = getGateway().verifyWebhook(rawBody, signature);
    if (!event) throw new AppError("UNAUTHENTICATED", "Invalid webhook signature.");
    const payment = repo.byProviderRef(event.sessionId);
    if (!payment) throw new AppError("PAYMENT_NOT_FOUND", "Unknown checkout session.");

    const changed = db.transaction(() => {
        const ok = repo.updateStatus(
            payment.id,
            ["pending"],
            event.outcome,
            event.outcome === "failed" ? event.reason || "Payment failed" : null
        );
        if (ok) ridesRepo.setPaymentStatus(payment.ride_id, event.outcome === "succeeded" ? "paid" : "failed");
        return ok;
    });
    const updated = repo.get(payment.id)!;
    if (changed) announce(updated, payment.rider_id);
    return updated;
}

export function refund(paymentId: number, adminId: number, reason: string): PaymentRow {
    const payment = repo.get(paymentId);
    if (!payment) throw new AppError("PAYMENT_NOT_FOUND", "Payment not found.");
    if (payment.status !== "succeeded") throw new AppError("PAYMENT_STATE_CONFLICT", "Only completed payments can be refunded.");

    if (payment.provider !== "cash") getGateway().refund(payment);
    db.transaction(() => {
        if (!repo.updateStatus(payment.id, ["succeeded"], "refunded", reason)) {
            throw new AppError("PAYMENT_STATE_CONFLICT", "Only completed payments can be refunded.");
        }
        ridesRepo.setPaymentStatus(payment.ride_id, "refunded");
    });
    audit.log(adminId, "payment.refund", "payment", payment.id, { reason, amount: payment.amount });
    const updated = repo.get(payment.id)!;
    announce(updated, adminId);
    return updated;
}

export function forUser(userId: number, role: "rider" | "driver" | null, page: PageQuery = {}): Page<PaymentRow> {
    return repo.listFor(role === "driver" ? "driver_id" : "rider_id", userId, page);
}

export function all(page: PageQuery = {}): Page<PaymentRow> {
    return repo.listFor(null, null, page);
}
