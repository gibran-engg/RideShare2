import express from "express";
import type { Request, Response, Router } from "express";
import * as client from "openid-client";
import config from "../../lib/config.ts";
import type { AppKey } from "../../lib/config.ts";
import { AppError } from "../../lib/errors.ts";
import type { IdentityProfile } from "../users/service.ts";
import { safeReturnTo } from "../../lib/security.ts";
import { rolesFrom } from "./jwt.ts";

/**
 * OAuth 2.0 / OpenID Connect sign-in for the server-rendered admin website
 * (Authorization Code flow + PKCE, state and nonce; the ID token's signature and claims are checked).
 *
 * Providers:
 *   auth0 - the Auth0 tenant (AUTH0_DOMAIN, AUTH0_ADMIN_CLIENT_ID / AUTH0_ADMIN_CLIENT_SECRET)
 *   mock  - the local dev provider in /mock-oauth (development only, when Auth0 isn't set up)
 */

export type Provider = "auth0" | "mock";
const PROVIDERS: Provider[] = ["auth0", "mock"];
const PROVIDER_LABELS: Record<Provider, string> = { auth0: "Auth0", mock: "Dev sign-in" };

function isProvider(value: string): value is Provider {
    return (PROVIDERS as string[]).includes(value);
}

function isEnabled(provider: Provider): boolean {
    return Boolean(config.oauth[provider]?.enabled);
}

interface ProviderSettings {
    issuer: string;
    clientId: string;
    clientSecret: string;
    extraParams: Record<string, string>;
    insecure?: boolean;
}

function providerSettings(provider: Provider, appKey: AppKey): ProviderSettings | null {
    if (!isEnabled(provider)) return null;
    if (provider === "auth0") {
        return {
            issuer: config.oauth.auth0.issuer,
            clientId: config.oauth.auth0.adminClientId,
            clientSecret: config.oauth.auth0.adminClientSecret,
            // Always show Auth0's login form, so switching between the admin and other accounts works.
            extraParams: { prompt: "login" }
        };
    }
    const registered = config.oauth.mock.clients[appKey];
    return {
        issuer: config.urls.mockOAuth,
        clientId: registered.clientId,
        clientSecret: registered.clientSecret || "",
        insecure: config.urls.mockOAuth.startsWith("http://"),
        extraParams: {}
    };
}

export interface ProviderInfo {
    id: Provider;
    label: string;
    enabled: boolean;
}

/** Providers to show as sign-in buttons. */
export function enabledProviders(): ProviderInfo[] {
    return PROVIDERS.filter(isEnabled).map((id) => ({ id, label: PROVIDER_LABELS[id], enabled: true }));
}

interface Discovered {
    oidc: client.Configuration;
    settings: ProviderSettings;
}

const discovered = new Map<string, { pending: Promise<Discovered>; expires: number }>();

async function getConfiguration(provider: Provider, appKey: AppKey): Promise<Discovered> {
    const key = `${provider}:${appKey}`;
    const cached = discovered.get(key);
    if (cached && cached.expires > Date.now()) return cached.pending;

    const settings = providerSettings(provider, appKey);
    if (!settings) throw new AppError("NOT_FOUND", `${PROVIDER_LABELS[provider] || "That"} sign-in isn't set up yet.`);

    const pending = client
        .discovery(
            new URL(settings.issuer),
            settings.clientId,
            settings.clientSecret,
            client.ClientSecretPost(settings.clientSecret),
            settings.insecure ? { execute: [client.allowInsecureRequests] } : undefined
        )
        .then((oidc) => ({ oidc, settings }))
        .catch((err: Error) => {
            discovered.delete(key);
            console.error(`OIDC discovery failed for ${provider}:`, err.message);
            throw new AppError("SERVICE_UNAVAILABLE", `${PROVIDER_LABELS[provider]} sign-in is unreachable right now. Please try again.`);
        });
    discovered.set(key, { pending, expires: Date.now() + 12 * 60 * 60 * 1000 });
    return pending;
}

function regenerateSession(req: Request): Promise<void> {
    return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

function saveSession(req: Request): Promise<void> {
    return new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
}

function defaultOnError(req: Request, res: Response, message: string): void {
    if (req.flash) req.flash("error", message);
    res.redirect("/login");
}

export interface AuthRouterOptions {
    appKey: AppKey;
    /** Public origin (+ optional path prefix) the router is mounted at; redirect URIs are built from it. */
    baseUrl: string;
    /** Extra data to remember across the redirect (may throw an AppError). */
    startContext?: (req: Request) => unknown;
    /**
     * Runs on a freshly regenerated session (prevents session fixation). Returns where to redirect.
     * `expiresAt` is when the verified ID token expires (ms).
     */
    onSignIn: (
        req: Request,
        profile: IdentityProfile,
        context: { returnTo: string; extra: unknown; expiresAt: number }
    ) => Promise<string> | string;
    onError?: (req: Request, res: Response, message: string, extra: unknown) => void;
    afterLogout?: string;
}

/**
 * Router with:
 *   GET  /auth/:provider                 -> redirect to the provider
 *   GET  /auth/:provider/callback        -> code exchange + ID token validation
 *   POST /auth/logout
 */
export function createAuthRouter({
    appKey,
    baseUrl,
    onSignIn,
    startContext = () => null,
    onError = defaultOnError,
    afterLogout = "/login"
}: AuthRouterOptions): Router {
    const router = express.Router();

    router.get("/auth/:provider", async (req, res) => {
        const provider = String(req.params.provider);
        if (!isProvider(provider)) throw new AppError("NOT_FOUND", "Unknown sign-in provider.");
        const extra = startContext(req);
        const { oidc, settings } = await getConfiguration(provider, appKey);

        const codeVerifier = client.randomPKCECodeVerifier();
        const state = client.randomState();
        const nonce = client.randomNonce();

        req.session.oauth = {
            provider,
            codeVerifier,
            state,
            nonce,
            returnTo: safeReturnTo(req.query.returnTo, ""),
            extra,
            startedAt: Date.now()
        };
        await saveSession(req);

        const url = client.buildAuthorizationUrl(oidc, {
            redirect_uri: `${baseUrl}/auth/${provider}/callback`,
            scope: "openid email profile",
            response_type: "code",
            code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
            code_challenge_method: "S256",
            state,
            nonce,
            ...settings.extraParams
        });
        res.redirect(url.href);
    });

    async function callback(req: Request, res: Response): Promise<void> {
        const provider = String(req.params.provider);
        const params = req.query as Record<string, unknown>;
        const pending = req.session.oauth;
        delete req.session.oauth;
        const extra = pending?.extra;

        if (params.error) {
            const cancelled = params.error === "access_denied" || params.error === "user_cancelled_authorize";
            return onError(req, res, cancelled ? "Sign-in was cancelled." : "Sign-in failed. Please try again.", extra);
        }
        if (!isProvider(provider) || !pending || pending.provider !== provider || Date.now() - pending.startedAt > 10 * 60 * 1000) {
            return onError(req, res, "Your sign-in session expired. Please try again.", extra);
        }

        const { oidc } = await getConfiguration(provider, appKey);
        // The public callback URL (the request may have come through a proxy) with the provider's parameters.
        const currentUrl = new URL(`${baseUrl}/auth/${provider}/callback`);
        for (const key of ["code", "state", "iss"]) {
            const value = params[key];
            if (typeof value === "string") currentUrl.searchParams.set(key, value);
        }

        let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
        try {
            tokens = await client.authorizationCodeGrant(oidc, currentUrl, {
                pkceCodeVerifier: pending.codeVerifier,
                expectedState: pending.state,
                expectedNonce: pending.nonce,
                idTokenExpected: true
            });
        } catch (err) {
            console.error(`OAuth callback failed for ${provider}:`, (err as Error).message);
            return onError(req, res, "We couldn't complete sign-in. Please try again.", extra);
        }

        const claims = tokens.claims()!;
        const profile: IdentityProfile = {
            provider,
            subject: claims.sub,
            email: claims.email ? String(claims.email).toLowerCase() : null,
            emailVerified: claims.email_verified === true,
            name: (claims.name as string | undefined) || null,
            picture: (claims.picture as string | undefined) || null,
            roles: rolesFrom(claims)
        };

        await regenerateSession(req);
        let destination: string;
        try {
            destination = await onSignIn(req, profile, { returnTo: pending.returnTo, extra, expiresAt: claims.exp * 1000 });
        } catch (err) {
            if (err instanceof AppError && err.status < 500) return onError(req, res, err.message, extra);
            throw err;
        }
        await saveSession(req);
        res.redirect(destination);
    }

    router.get("/auth/:provider/callback", callback);

    router.post("/auth/logout", (req, res, next) => {
        req.session.destroy((err) => {
            if (err) return next(err);
            res.redirect(afterLogout);
        });
    });

    return router;
}
