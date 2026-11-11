import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../../lib/errors.ts";
import * as jwt from "../../../services/auth/jwt.ts";
import * as identity from "../../../services/auth/service.ts";
import * as users from "../../../services/users/service.ts";
import type { Role } from "../../../lib/types.ts";

/** Bearer-token authentication for /api routes: the token is an Auth0 JWT access token. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const header = req.get("authorization") || "";
    const access = await jwt.verifyAccessToken(header.startsWith("Bearer ") ? header.slice(7) : null);
    if (!access) return next(new AppError("UNAUTHENTICATED", "Please sign in again."));
    const user = await identity.userFor(access);
    if (user.status === "suspended") return next(new AppError("ACCOUNT_SUSPENDED", "Your account is suspended."));
    req.user = user;
    req.auth = access;
    next();
}

/** Riders and drivers must finish onboarding (drivers must be approved) first. */
export function requireReady(role?: Role) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const user = req.user!;
        if (users.onboardingStep(user) !== "ready")
            return next(new AppError("ONBOARDING_INCOMPLETE", "Finish setting up your account first."));
        if (role && user.role !== role) return next(new AppError("FORBIDDEN", `Only ${role}s can do that.`));
        next();
    };
}
