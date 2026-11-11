import { z } from "zod";
import type { PaymentRow } from "../../../../lib/types.ts";
import { registry } from "../../core/openapi.ts";
import { PaymentMethod } from "../../core/schemas.ts";

export const Payment = registry.register(
    "Payment",
    z.object({
        id: z.number(),
        rideId: z.number(),
        amount: z.number(),
        currency: z.string(),
        method: PaymentMethod,
        status: z.enum(["pending", "succeeded", "failed", "refunded"]),
        provider: z.string(),
        failureReason: z.string().nullable(),
        createdAt: z.string(),
        paidAt: z.string().nullable(),
        refundedAt: z.string().nullable(),
        trip: z.object({ pickup: z.string().optional(), drop: z.string().optional() })
    })
);

export const CheckoutBody = z.object({
    method: z.enum(["card", "upi"], { message: "Choose card or UPI." }),
    returnUrl: z.string().url().max(500).optional().openapi({ description: "Where to send the rider afterwards (must be on the web app)" })
});

export const WebhookEvent = z.object({ sessionId: z.string(), outcome: z.enum(["succeeded", "failed"]), reason: z.string().optional() });

export function toPayment(row: PaymentRow | null) {
    if (!row) return null;
    return {
        id: row.id,
        rideId: row.ride_id,
        amount: row.amount,
        currency: row.currency,
        method: row.method,
        status: row.status,
        provider: row.provider,
        failureReason: row.failure_reason,
        createdAt: row.created_at,
        paidAt: row.paid_at,
        refundedAt: row.refunded_at,
        trip: { pickup: row.pickup_name, drop: row.drop_name }
    };
}
