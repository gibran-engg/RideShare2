import * as db from "../../db/index.ts";
import { AppError } from "../../lib/errors.ts";
import { bus } from "../../lib/events.ts";
import * as driversRepo from "../drivers/repository.ts";
import * as repo from "./repository.ts";
import type { Role, UserRow, UserStatus } from "../../lib/types.ts";
import * as audit from "../../lib/audit.ts";
import * as otp from "./otp.ts";

export const getById = repo.getById;
export const getByEmail = repo.getByEmail;
export const list = repo.list;

export function getByIdentity(provider: string, subject: string): UserRow | null {
    const identity = repo.findIdentity(provider, subject);
    return identity ? repo.getById(identity.user_id) : null;
}

export interface IdentityProfile {
    provider: string;
    subject: string;
    email: string | null;
    emailVerified?: boolean;
    name?: string | null;
    picture?: string | null;
    /** Roles from the identity provider's token (admin, rider, driver). */
    roles?: readonly string[];
}

/**
 * Resolve the local account for an OAuth/OIDC sign-in.
 * 1. Known (provider, subject) -> that user.
 * 2. Otherwise a verified email links to an existing account with the same email.
 * 3. Otherwise a new account is created (onboarding happens next).
 * An unverified email can create an account but never take over an existing one.
 */
export function findOrCreateFromIdentity(profile: IdentityProfile): { user: UserRow; isNew: boolean } {
    const { provider, subject, email, emailVerified, name = null, picture = null } = profile;
    if (!subject) throw new AppError("BAD_REQUEST", "The sign-in provider did not return an account id.");
    if (!email) throw new AppError("FORBIDDEN", "Your sign-in account needs an email address.");

    return db.transaction(() => {
        const identity = repo.findIdentity(provider, subject);
        let userId: number;
        let isNew = false;

        if (identity) {
            userId = identity.user_id;
        } else {
            const existing = repo.getByEmail(email);
            if (existing) {
                if (emailVerified !== true) {
                    throw new AppError("FORBIDDEN", "Verify your email address with the sign-in service first (check your inbox).");
                }
                userId = existing.id;
            } else {
                userId = repo.insert(email, name, picture);
                isNew = true;
            }
            repo.linkIdentity(userId, provider, subject, email);
        }
        repo.recordLogin(userId, name, picture);
        return { user: repo.getById(userId)!, isNew };
    });
}

/** Sign-in from one of the apps: resolves the account and records the event. */
export function signIn(profile: IdentityProfile, app: string): { user: UserRow; isNew: boolean } {
    const result = findOrCreateFromIdentity(profile);
    bus.emit("user.signed_in", { userId: result.user.id, provider: profile.provider, app, isNew: result.isNew });
    return result;
}

/**
 * Auth0 roles are the source of truth for rider/driver: when one is assigned, the account uses it
 * (onboarding then skips the choice). Without one, the user picks during onboarding.
 */
export function applyRoles(user: UserRow, roles: readonly string[]): UserRow {
    const appRoles = (["rider", "driver"] as const).filter((role) => roles.includes(role));
    if (appRoles.length !== 1 || user.role === appRoles[0]) return user;
    repo.setRole(user.id, appRoles[0]!);
    return repo.getById(user.id)!;
}

/** The app throws its tokens away; JWTs can't be revoked here, they just expire. */
export function signOut(userId: number): void {
    bus.emit("user.signed_out", { userId });
}

export type OnboardingStep = "profile" | "verify" | "driver" | "pending" | "rejected" | "ready";

/** Which onboarding step the app should show next. */
export function onboardingStep(user: UserRow): OnboardingStep {
    if (!user.role || !user.name || !user.phone) return "profile";
    if (!user.phone_verified) return "verify";
    if (user.role === "rider") return "ready";
    const driver = driversRepo.get(user.id);
    if (!driver) return "driver";
    if (driver.verification_status === "pending") return "pending";
    if (driver.verification_status === "rejected") return "rejected";
    return "ready";
}

export function saveProfile(userId: number, profile: { name: string; phone: string; role: Role }): UserRow {
    const user = repo.getById(userId);
    if (!user) throw new AppError("NOT_FOUND", "User not found.");
    if (user.role && user.role !== profile.role) {
        throw new AppError("BAD_REQUEST", "Your account type can't be changed after it's chosen.");
    }
    repo.saveProfile(userId, profile, user.phone !== profile.phone);
    const saved = repo.getById(userId)!;
    if (!saved.phone_verified) otp.issue(userId, profile.phone);
    bus.emit("user.profile_saved", { userId, role: profile.role });
    return saved;
}

export function verifyPhone(user: UserRow, code: unknown): void {
    const result = otp.verify(user.id, user.phone, String(code ?? "").trim());
    if (!result.ok) throw new AppError("OTP_INVALID", result.reason);
    repo.markPhoneVerified(user.id);
    if (user.role === "rider") repo.completeOnboarding(user.id);
    bus.emit("user.phone_verified", { userId: user.id });
}

export function resendCode(user: UserRow): void {
    if (!user.phone) throw new AppError("BAD_REQUEST", "Add your phone number first.");
    if (!otp.issue(user.id, user.phone)) {
        throw new AppError("RATE_LIMITED", "Please wait 30 seconds before asking for another code.");
    }
}

export const completeOnboarding = repo.completeOnboarding;
export const markPhoneVerified = repo.markPhoneVerified;

/**
 * Admin suspends or reinstates a user. A suspended user's still-valid JWTs stop working at once,
 * because every API request and live-update check loads the account and checks its status.
 */
export function setStatus(userId: number, status: UserStatus, adminId: number): void {
    if (!repo.setStatus(userId, status)) throw new AppError("NOT_FOUND", "User not found.");
    if (status === "suspended") driversRepo.setOnline(userId, false);
    audit.log(adminId, status === "suspended" ? "user.suspend" : "user.reinstate", "user", userId);
    bus.emit("user.status_changed", { userId, status, actorId: adminId });
}
