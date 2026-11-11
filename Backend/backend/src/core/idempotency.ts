import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../../lib/errors.ts";
import * as idempotency from "../../../lib/idempotency.ts";

/**
 * Idempotency-Key support (as in the Stripe/Razorpay APIs). The first response to a key is stored;
 * retrying with the same key returns it instead of running the request again, so a double tap or a
 * network retry never books two rides. Reusing a key for a different request is an error.
 */
export function idempotent(req: Request, res: Response, next: NextFunction): void {
    const key = req.get("idempotency-key");
    if (!key) return next();
    if (key.length > 100) return next(new AppError("VALIDATION_FAILED", "Idempotency-Key must be at most 100 characters."));

    const userId = req.user!.id;
    const route = `${req.method} ${req.baseUrl}${req.path}`;
    const requestHash = crypto
        .createHash("sha256")
        .update(`${route}\n${JSON.stringify(req.body ?? null)}`)
        .digest("hex");

    const stored = idempotency.find(userId, key);
    if (stored) {
        if (stored.route !== route || stored.request_hash !== requestHash) {
            return next(new AppError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different request."));
        }
        res.setHeader("Idempotent-Replayed", "true");
        res.status(stored.status_code).type("application/json").send(stored.response_body);
        return;
    }

    // Capture the response; only definitive outcomes (not server errors) are remembered.
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
        if (res.statusCode < 500) {
            idempotency.save(userId, key, {
                route,
                request_hash: requestHash,
                status_code: res.statusCode,
                response_body: JSON.stringify(body)
            });
        }
        return json(body);
    };
    next();
}
