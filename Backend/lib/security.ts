import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "./errors.ts";

/** Conservative security headers; pages use no inline scripts or styles. */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
    res.setHeader(
        "Content-Security-Policy",
        [
            "default-src 'self'",
            "img-src 'self' data: https://*.googleusercontent.com",
            "style-src 'self'",
            "script-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'"
        ].join("; ")
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    next();
}

function csrfToken(req: Request): string {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(24).toString("hex");
    }
    return req.session.csrfToken;
}

function isValidCsrf(req: Request): boolean {
    const expected = req.session && req.session.csrfToken;
    const given: unknown = (req.body && req.body._csrf) || req.get("x-csrf-token");
    if (!expected || typeof given !== "string" || given.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const formExpired = () => new AppError("FORBIDDEN", "Your form expired. Please go back, refresh and try again.");

/** Synchroniser-token CSRF protection for every form post. */
export function csrf(req: Request, res: Response, next: NextFunction): void {
    res.locals.csrfToken = csrfToken(req);
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (unsafe && !isValidCsrf(req)) return next(formExpired());
    next();
}

/** One-shot messages carried across a redirect. */
export function flash(req: Request, res: Response, next: NextFunction): void {
    res.locals.flash = req.session.flash || [];
    delete req.session.flash;
    req.flash = (type, message) => {
        req.session.flash = req.session.flash || [];
        req.session.flash.push({ type, message });
    };
    next();
}

/** Small fixed-window in-memory rate limiter, keyed per IP (and user when signed in). */
export function rateLimit({
    windowMs,
    max,
    message = "Too many attempts. Please wait a moment and try again."
}: {
    windowMs: number;
    max: number;
    message?: string;
}) {
    const hits = new Map<string, { count: number; resetAt: number }>();
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    }, windowMs);
    timer.unref();

    return (req: Request, res: Response, next: NextFunction): void => {
        const key = `${req.ip}:${req.user?.id ?? req.session?.adminId ?? ""}`;
        const now = Date.now();
        let entry = hits.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }
        entry.count += 1;
        if (entry.count > max) {
            res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
            return next(new AppError("RATE_LIMITED", message));
        }
        next();
    };
}

/** Only allow same-site relative redirect targets. */
export function safeReturnTo(value: unknown, fallback: string): string;
export function safeReturnTo(value: unknown, fallback: null): string | null;
export function safeReturnTo(value: unknown, fallback: string | null = "/"): string | null {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
        return fallback;
    }
    return value;
}

function refererPath(req: Request): string | null {
    const referer = req.get("referer");
    if (!referer) return null;
    try {
        const url = new URL(referer);
        if (url.host !== req.get("host")) return null;
        return safeReturnTo(url.pathname + url.search, null);
    } catch {
        return null;
    }
}

export function notFound(req: Request, res: Response, next: NextFunction): void {
    next(new AppError("NOT_FOUND", "We couldn't find that page."));
}

/** Error handler for the server-rendered admin app. */
export function errorHandler(
    err: Error & { status?: number; statusCode?: number; expose?: boolean },
    req: Request,
    res: Response,
    next: NextFunction
): void {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = status < 500 && (err.expose || err.message) ? err.message : "Something went wrong on our side.";

    // A rejected form action (ride already taken, wrong state...) goes back to the page it came from.
    const back = refererPath(req);
    if (req.method === "POST" && status < 500 && status !== 403 && req.flash && back) {
        req.flash("error", message);
        return res.redirect(303, back);
    }

    res.status(status);
    if (req.accepts(["html", "json"]) === "json") {
        res.json({ error: message });
        return;
    }
    res.render("error", { title: "Error", status, message });
}
