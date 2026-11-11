import config from "../../lib/config.ts";
import { AppError } from "../../lib/errors.ts";
import type { UserRow } from "../../lib/types.ts";
import * as users from "../users/service.ts";
import type { AccessToken } from "./jwt.ts";

/**
 * The local account behind a verified access token. Auth0 owns who the user is (sign-in, passwords,
 * Google login, roles); this database keeps what RideShare needs (phone, driver documents, rides).
 * A new user's email and name are read once from the issuer's /userinfo, then found by the token's "sub".
 */

const linking = new Map<string, Promise<UserRow>>();

export async function userFor(token: AccessToken): Promise<UserRow> {
    const known = users.getByIdentity(config.identity.provider, token.subject);
    return users.applyRoles(known ?? (await linkOnce(token)), token.roles);
}

/** The app sends several requests at once right after sign-in; create the account only once. */
function linkOnce(token: AccessToken): Promise<UserRow> {
    let pending = linking.get(token.subject);
    if (!pending) {
        pending = link(token).finally(() => linking.delete(token.subject));
        linking.set(token.subject, pending);
    }
    return pending;
}

interface UserInfo {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
}

async function link(token: AccessToken): Promise<UserRow> {
    let info: UserInfo;
    try {
        const res = await fetch(config.identity.userinfoUrl, {
            headers: { authorization: `Bearer ${token.raw}` },
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) throw new Error(`userinfo answered ${res.status}`);
        info = (await res.json()) as UserInfo;
    } catch (err) {
        console.error("Loading the user's profile failed:", (err as Error).message);
        throw new AppError("SERVICE_UNAVAILABLE", "We couldn't load your profile from sign-in. Please try again.");
    }
    if (info.sub !== token.subject) throw new AppError("UNAUTHENTICATED", "Please sign in again.");

    const profile = {
        provider: config.identity.provider,
        subject: info.sub,
        email: info.email ? info.email.toLowerCase() : null,
        emailVerified: info.email_verified === true,
        name: info.name || null,
        picture: info.picture || null
    };
    return users.signIn(profile, "app").user;
}
