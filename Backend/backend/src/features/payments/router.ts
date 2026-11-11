import express from "express";
import type { Request } from "express";
import { z } from "zod";
import * as payments from "../../../../services/payments/service.ts";
import { requireReady } from "../../core/auth.ts";
import { registry } from "../../core/openapi.ts";
import { createModule } from "../../core/route.ts";
import { IdParams, PageQuery, page, toPage } from "../../core/schemas.ts";
import { CheckoutBody, Payment, WebhookEvent, toPayment } from "./schemas.ts";

/** Origin the client used to reach the API (the web app's origin when proxied through Vite). */
function requestOrigin(req: Request): string {
    return `${req.protocol}://${req.get("host")}`;
}

const { router, add } = createModule();
const tags = ["Payments"];

add(
    {
        method: "get",
        path: "/rides/:id/payment",
        summary: "The payment for a ride (null until the trip ends)",
        tags,
        params: IdParams,
        response: z.object({ payment: Payment.nullable() }),
        errors: [404]
    },
    ({ user, params }) => ({ payment: toPayment(payments.forRide(params.id, user.id)) })
);

add(
    {
        method: "post",
        path: "/rides/:id/payments/checkout",
        summary: "Start a card/UPI checkout; send the rider to checkoutUrl",
        description: "Test mode: checkoutUrl opens a RideShare Pay page where the payment can be approved or declined.",
        tags,
        before: [requireReady("rider")],
        idempotent: true,
        params: IdParams,
        body: CheckoutBody,
        response: z.object({ payment: Payment, checkoutUrl: z.string() }),
        status: 201,
        errors: [403, 404, 409, 422]
    },
    ({ user, params, body }, req) => {
        const result = payments.checkout(params.id, user.id, {
            method: body.method,
            returnUrl: body.returnUrl,
            baseUrl: requestOrigin(req)
        });
        return { payment: toPayment(result.payment), checkoutUrl: result.checkoutUrl };
    }
);

add(
    {
        method: "get",
        path: "/me/payments",
        summary: "My payments (paid as rider, or received as driver)",
        tags: ["History"],
        query: PageQuery,
        response: page(Payment)
    },
    ({ user, query }) => toPage(payments.forUser(user.id, user.role, query), (row) => toPayment(row)!)
);

export default router;

registry.registerPath({
    method: "post",
    path: "/payments/webhook",
    summary: "Payment provider callback (signed)",
    description: "Body is the provider's JSON event; header `X-RideShare-Signature: sha256=<HMAC of the raw body>`.",
    tags,
    request: { body: { content: { "application/json": { schema: WebhookEvent } } } },
    responses: {
        200: { description: "Processed", content: { "application/json": { schema: z.object({ payment: Payment }) } } },
        401: { description: "Bad signature" }
    }
});

/** Raw-body webhook: mounted before the JSON parser so the signature is checked on the exact bytes. */
export const webhookRouter = express.Router();
webhookRouter.post("/payments/webhook", express.raw({ type: "*/*", limit: "20kb" }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    res.json({ payment: toPayment(payments.handleWebhook(raw, req.get("x-rideshare-signature"))) });
});
