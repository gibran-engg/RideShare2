import assert from "node:assert/strict";
import crypto from "node:crypto";
import config from "../../lib/config.ts";
import * as sms from "../../lib/sms.ts";
import * as users from "../../services/users/service.ts";

// 1x1 PNG
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
// The Android app's redirect URI (registered in Auth0 as an Allowed Callback URL).
export const APP_REDIRECT = "rideshare://auth";

export const GHATKOPAR = { lat: 19.0863, lng: 72.9081, name: "Ghatkopar Station" };
export const POWAI = { lat: 19.1176, lng: 72.906, name: "Powai" };

export function stamp(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

// Test responses are loosely typed JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface ApiResponse {
    status: number;
    body: Json;
    headers: Headers;
}

export interface AppTokens {
    access_token: string;
    id_token: string;
    refresh_token?: string;
    expires_in: number;
}

/** Start of the PKCE sign-in: a code for `email`, as the provider would redirect it to the app. */
export async function authorizeCode(email: string, { audience = config.identity.audience } = {}) {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const res = await fetch(`${config.urls.mockOAuth}/authorize`, {
        method: "POST",
        redirect: "manual",
        body: new URLSearchParams({
            client_id: config.identity.appClientId,
            redirect_uri: APP_REDIRECT,
            response_type: "code",
            scope: "openid email profile offline_access",
            state: "test-state",
            code_challenge: challenge,
            code_challenge_method: "S256",
            audience,
            email,
            name: email.split("@")[0]!
        })
    });
    const redirect = new URL(res.headers.get("location") || "about:blank");
    assert.ok(redirect.href.startsWith(APP_REDIRECT), `expected the app's redirect, got ${redirect.href}`);
    assert.equal(redirect.searchParams.get("state"), "test-state");
    return { code: redirect.searchParams.get("code")!, verifier };
}

/** Token endpoint call, as the app makes it (a public client: no secret). */
export function tokenRequest(params: Record<string, string>): Promise<Response> {
    return fetch(`${config.urls.mockOAuth}/token`, {
        method: "POST",
        body: new URLSearchParams({ client_id: config.identity.appClientId, ...params })
    });
}

/** What the Android app does: Authorization Code + PKCE with the dev provider (standing in for Auth0). */
export async function appTokens(email: string, options: { audience?: string } = {}): Promise<AppTokens> {
    const { code, verifier } = await authorizeCode(email, options);
    const res = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: APP_REDIRECT, code_verifier: verifier });
    assert.equal(res.status, 200, `token request failed: ${await res.clone().text()}`);
    return (await res.json()) as AppTokens;
}

/** The claims of a JWT, without checking it (tests only). */
export function jwtPayload(token: string): Json {
    return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
}

/** Talks to the API the way the apps do. `prefix` is /api (legacy, mobile) or /api/v1. */
export class App {
    token: string | null = null;
    refreshToken: string | null = null;

    readonly apiUrl: string;
    readonly prefix: "/api" | "/api/v1";

    constructor(apiUrl: string, prefix: "/api" | "/api/v1" = "/api") {
        this.apiUrl = apiUrl;
        this.prefix = prefix;
    }

    /** Sign in like the app, then make the first API call, which links the identity to a local account. */
    async signIn(email: string): Promise<Json> {
        const tokens = await appTokens(email);
        this.token = tokens.access_token;
        this.refreshToken = tokens.refresh_token ?? null;
        return this.ok("GET", "/me");
    }

    async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse> {
        const isForm = body instanceof FormData;
        const response = await fetch(`${this.apiUrl}${this.prefix}${path}`, {
            method,
            headers: {
                ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
                ...(body && !isForm ? { "content-type": "application/json" } : {}),
                ...headers
            },
            body: body ? (isForm ? body : JSON.stringify(body)) : undefined
        });
        return { status: response.status, body: await response.json(), headers: response.headers };
    }

    async ok(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Json> {
        const res = await this.call(method, path, body, headers);
        assert.ok(res.status < 400, `${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
        return res.body;
    }
}

export function latestCode(email: string): string {
    return sms.latestForUser(users.getByEmail(email)!.id, 1)[0]!.message.slice(0, 6);
}

/** Sign in and finish onboarding through the API. Drivers end up pending approval. */
export async function onboard(
    apiUrl: string,
    role: "rider" | "driver",
    email: string,
    { vehicleType = "car", prefix = "/api" as "/api" | "/api/v1" } = {}
): Promise<App> {
    const app = new App(apiUrl, prefix);
    let me = await app.signIn(email);
    assert.equal(me.next, "profile");

    me = await app.ok("POST", "/onboarding/profile", { role, name: `Test ${role}`, phone: `9${String(Date.now()).slice(-9)}` });
    assert.equal(me.next, "verify");
    assert.match(me.devSms, /verification code/);

    me = await app.ok("POST", "/onboarding/verify", { code: latestCode(email) });
    if (role === "rider") {
        assert.equal(me.next, "ready");
        return app;
    }
    assert.equal(me.next, "driver");

    const form = new FormData();
    Object.entries({
        licenseNumber: "MH0220200011111",
        vehicleType,
        vehicleMake: "Hyundai",
        vehicleModel: "Aura",
        vehiclePlate: "MH 02 TT 9999",
        vehicleColor: "Grey",
        vehicleYear: "2022",
        licenseExpiry: "2099-01-01",
        insuranceExpiry: "2099-01-01"
    }).forEach(([key, value]) => form.set(key, value));
    form.set("licenseDoc", new Blob([PNG], { type: "image/png" }), "licence.png");
    form.set("rcDoc", new Blob([PNG], { type: "image/png" }), "rc.png");
    form.set("insuranceDoc", new Blob([PNG], { type: "image/png" }), "insurance.png");
    me = await app.ok("POST", "/onboarding/driver", form);
    assert.equal(me.next, "pending");
    return app;
}
