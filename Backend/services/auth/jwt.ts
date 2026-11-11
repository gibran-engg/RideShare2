import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import config from "../../lib/config.ts";
import { AppError } from "../../lib/errors.ts";

/**
 * JWT access tokens from Auth0 (or the dev provider). The apps send one with every API call
 * (Authorization: Bearer <jwt>); the API trusts it only if all of these hold:
 *   - signed with RS256 by a key from the issuer's JWKS (no "none", no HS256 with a guessed secret)
 *   - "iss" is our Auth0 tenant and "aud" is our API, so a token for another app is rejected
 *   - "exp"/"nbf" say it is valid now (30 s clock tolerance)
 * Roles come from the custom claim the Auth0 Post-Login Action adds.
 */

export const ROLES = ["admin", "rider", "driver"] as const;
export type AppRole = (typeof ROLES)[number];

export interface AccessToken {
    subject: string;
    roles: AppRole[];
    /** Milliseconds since the epoch. */
    expiresAt: number;
    /** The raw JWT, needed to call the issuer's /userinfo once for a new user. */
    raw: string;
}

let keys: ReturnType<typeof createRemoteJWKSet> | null = null;

/** The issuer's public keys, cached; refetched when a token names a key we haven't seen (key rotation). */
function issuerKeys() {
    keys ??= createRemoteJWKSet(new URL(config.identity.jwksUri), { timeoutDuration: 5000, cooldownDuration: 30_000 });
    return keys;
}

/** The app roles in a token's (or ID token's) claims; unknown values are ignored. */
export function rolesFrom(claims: Record<string, unknown>): AppRole[] {
    const value = claims[config.identity.rolesClaim];
    return Array.isArray(value) ? ROLES.filter((role) => value.includes(role)) : [];
}

/** Returns the verified token, or null if it is missing, forged, expired or meant for another API. */
export async function verifyAccessToken(token: unknown): Promise<AccessToken | null> {
    if (typeof token !== "string" || token.split(".").length !== 3) return null;
    try {
        const { payload } = await jwtVerify(token, issuerKeys(), {
            issuer: config.identity.issuer,
            audience: config.identity.audience,
            algorithms: ["RS256"],
            clockTolerance: 30,
            requiredClaims: ["sub", "exp"]
        });
        return { subject: payload.sub!, roles: rolesFrom(payload), expiresAt: payload.exp! * 1000, raw: token };
    } catch (err) {
        // Can't fetch the issuer's keys (network error, timeout, non-200): the sign-in service is down, not the token bad.
        const unreachable =
            !(err instanceof errors.JOSEError) ||
            err instanceof errors.JWKSTimeout ||
            err instanceof errors.JWKSInvalid ||
            err.code === "ERR_JOSE_GENERIC";
        if (unreachable) {
            console.error("Access token check failed:", (err as Error).message);
            throw new AppError("SERVICE_UNAVAILABLE", "Sign-in is unreachable right now. Please try again.");
        }
        return null;
    }
}
