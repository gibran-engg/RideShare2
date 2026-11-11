import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../../lib/errors.ts";
import { runWithContext } from "../../../lib/request-context.ts";

/** Gives each request an id (echoed in X-Request-Id) and makes who-is-asking available to services. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.get("x-request-id");
    const requestId = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    runWithContext({ requestId, ip: req.ip || null, userAgent: req.get("user-agent") || null }, next);
}

export function notFound(req: Request, res: Response, next: NextFunction): void {
    next(new AppError("NOT_FOUND", "Route not found"));
}

type AnyError = Error & { status?: number; statusCode?: number; expose?: boolean; type?: string };

/**
 * One error format for /api/v1: { error: { code, message, details? } }.
 * The legacy /api alias (used by the current mobile app) keeps { error: "message" }.
 * Unexpected errors are logged and never leak their message.
 */
export function errorHandler(err: AnyError, req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) return next(err);

    let error: AppError;
    if (err instanceof AppError) {
        error = err;
    } else {
        const status = err.status || err.statusCode || 500;
        if (status >= 500) {
            console.error(`[${req.requestId}]`, err);
            error = new AppError("INTERNAL", "Internal server error");
        } else if (err.type === "entity.parse.failed") {
            error = new AppError("VALIDATION_FAILED", "Request body is not valid JSON.");
        } else if (status === 413) {
            error = new AppError("VALIDATION_FAILED", "Request body is too large.");
        } else {
            error = new AppError("BAD_REQUEST", err.expose ? err.message : "Bad request");
        }
    }

    res.status(error.status);
    if (req.originalUrl.startsWith("/api/v1") || !req.originalUrl.startsWith("/api")) {
        res.json({
            error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) }
        });
    } else {
        res.json({ error: error.message, code: error.code });
    }
}
