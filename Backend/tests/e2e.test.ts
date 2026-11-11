import { startServers, stopServers } from "./helpers/env.ts";
import crypto from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import * as users from "../services/users/service.ts";
import { APP_REDIRECT, App, GHATKOPAR, POWAI, appTokens, authorizeCode, jwtPayload, onboard, stamp, tokenRequest } from "./helpers/app.ts";
import type { Json } from "./helpers/app.ts";
import { Client } from "./helpers/client.ts";

/**
 * End-to-end journeys through the legacy /api paths, which the current mobile app uses.
 * (tests/api-v1.test.ts covers the versioned API.)
 */

let urls: Awaited<ReturnType<typeof startServers>>;
test.before(async () => {
    urls = await startServers();
});
test.after(() => stopServers());

test("health and public config", async () => {
    const health = (await (await fetch(`${urls.api}/api/health`)).json()) as Json;
    assert.equal(health.status, "ok");
    const config = (await (await fetch(`${urls.api}/api/config`)).json()) as Json;
    assert.deepEqual(config.auth, {
        provider: "mock",
        issuer: urls.mockOAuth,
        clientId: "rideshare-app",
        audience: "https://api.rideshare.local"
    });
    assert.match(config.map.tileUrl, /dark_all/);
    assert.equal(config.map.configured, false);
});

test("API requires a token", async () => {
    const res = await new App(urls.api).call("GET", "/me");
    assert.equal(res.status, 401);
    assert.equal(res.body.error, "Please sign in again.", "legacy error format is a plain message");
});

test("sign-in only redirects to the app's registered callback", async () => {
    const res = await fetch(
        `${urls.mockOAuth}/authorize?client_id=rideshare-app&redirect_uri=${encodeURIComponent("exp://evil.example/--/auth")}&response_type=code&scope=openid&code_challenge=x&code_challenge_method=S256`,
        { redirect: "manual" }
    );
    assert.equal(res.status, 400);
});

test("PKCE: an intercepted sign-in code is useless without the app's verifier, and works only once", async () => {
    const { code, verifier } = await authorizeCode(stamp("pkce"));
    const stolen = await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: APP_REDIRECT,
        code_verifier: "attacker-guess"
    });
    assert.equal(stolen.status, 400);
    // The failed attempt burned the code, like Auth0.
    const late = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: APP_REDIRECT, code_verifier: verifier });
    assert.equal(late.status, 400);
});

test("access tokens are RS256 JWTs for this API, with the user's roles", async () => {
    const tokens = await appTokens("newdriver@example.test");
    const header = JSON.parse(Buffer.from(tokens.access_token.split(".")[0]!, "base64url").toString());
    assert.equal(header.alg, "RS256");
    const claims = jwtPayload(tokens.access_token);
    assert.equal(claims.iss, urls.mockOAuth);
    assert.ok(claims.aud.includes("https://api.rideshare.local"));
    assert.deepEqual(claims["https://rideshare.app/roles"], ["driver"]);
    assert.ok(claims.exp > Date.now() / 1000);

    // The driver role from the token picks the account type: onboarding won't ask.
    const app = new App(urls.api);
    app.token = tokens.access_token;
    const me = await app.ok("GET", "/me");
    assert.equal(me.user.role, "driver");
    assert.equal(me.next, "profile");
});

test("forged, tampered and wrong-audience tokens are rejected", async () => {
    const real = await appTokens(stamp("jwt"));
    const [header, payload, signature] = real.access_token.split(".");
    const claims = jwtPayload(real.access_token);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

    // Signed with an attacker's own RSA key.
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const forgedData = `${header}.${encode({ ...claims, sub: "someone-else" })}`;
    const forged = `${forgedData}.${crypto.sign("sha256", Buffer.from(forgedData), privateKey).toString("base64url")}`;
    // A real signature on changed claims.
    const tampered = `${header}.${encode({ ...claims, "https://rideshare.app/roles": ["admin"] })}.${signature}`;
    // No signature at all.
    const unsigned = `${encode({ alg: "none", typ: "JWT" })}.${payload}.`;
    // A genuine token, but not issued for this API (no audience asked for).
    const otherAudience = (await appTokens(stamp("aud"), { audience: "" })).access_token;

    for (const [label, token] of Object.entries({ forged, tampered, unsigned, otherAudience })) {
        const app = new App(urls.api);
        app.token = token;
        assert.equal((await app.call("GET", "/me")).status, 401, label);
    }
    const app = new App(urls.api);
    app.token = real.access_token;
    assert.equal((await app.call("GET", "/me")).status, 200);
});

test("refresh tokens get a new access token and rotate (each works once)", async () => {
    const app = new App(urls.api);
    await app.signIn(stamp("refresh"));
    const first = await tokenRequest({ grant_type: "refresh_token", refresh_token: app.refreshToken! });
    assert.equal(first.status, 200);
    const renewed = (await first.json()) as Json;
    assert.ok(renewed.refresh_token && renewed.refresh_token !== app.refreshToken);
    app.token = renewed.access_token;
    assert.equal((await app.call("GET", "/me")).status, 200);
    const reused = await tokenRequest({ grant_type: "refresh_token", refresh_token: app.refreshToken! });
    assert.equal(reused.status, 400);
});

test("full journey: onboarding, admin approval, ride with OTP", async () => {
    const riderEmail = stamp("rider");
    const driverEmail = stamp("driver");
    const rider = await onboard(urls.api, "rider", riderEmail);
    const driver = await onboard(urls.api, "driver", driverEmail, { vehicleType: "auto" });

    // Pending drivers can't work yet.
    assert.equal((await driver.call("POST", "/driver/online", { online: true })).status, 403);

    // Admin (web) approves the driver.
    const admin = new Client();
    let page = await admin.signIn(urls.admin, "admin@example.test", "Admin");
    assert.match(page.text, /Platform overview/);
    const driverId = users.getByEmail(driverEmail)!.id;
    page = await admin.get(`${urls.admin}/drivers/${driverId}`);
    const doc = page.text.match(/\/documents\/([0-9a-f-]+\.png)/)![1];
    assert.equal((await admin.get(`${urls.admin}/documents/${doc}`)).status, 200);
    page = await admin.post(`${urls.admin}/drivers/${driverId}/approve`, {}, page);
    assert.match(page.text, /Driver approved/);
    assert.equal((await driver.ok("GET", "/me")).next, "ready");

    // Driver shares GPS and goes online.
    await driver.ok("POST", "/driver/location", { lat: 19.09, lng: 72.91 });
    const online = await driver.ok("POST", "/driver/online", { online: true });
    assert.equal(online.driver.isOnline, true);

    // Rider gets a quote and books an auto.
    const quote = await rider.ok("POST", "/rides/estimate", { pickup: GHATKOPAR, drop: POWAI });
    assert.equal(quote.options.length, 3);
    assert.ok(quote.route.geometry.length >= 2);
    const { ride } = await rider.ok("POST", "/rides", { pickup: GHATKOPAR, drop: POWAI, vehicleType: "auto", fare: 1 });
    assert.equal(ride.status, "requested");
    assert.ok(ride.fare > 1, "fare is set by the server");
    assert.equal(ride.otp, null, "no OTP before a driver is assigned");

    // Drivers can't book; strangers can't see the ride.
    assert.equal((await driver.call("POST", "/rides", { pickup: GHATKOPAR, drop: POWAI, vehicleType: "auto" })).status, 403);
    const stranger = await onboard(urls.api, "rider", stamp("stranger"));
    assert.equal((await stranger.call("GET", `/rides/${ride.id}`)).status, 404);

    // Driver sees and accepts the request.
    const requests = await driver.ok("GET", "/driver/requests");
    assert.ok(requests.rides.some((r: { id: number }) => r.id === ride.id));
    await driver.ok("POST", `/rides/${ride.id}/accept`);

    // Rider sees the driver and their position; the OTP only comes when the driver arrives.
    const accepted = (await rider.ok("GET", "/rides/active")).ride;
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.otp, null, "no OTP until the driver arrives");
    assert.deepEqual(accepted.driver.location, { lat: 19.09, lng: 72.91 });
    assert.equal((await driver.call("POST", `/rides/${ride.id}/start`, { otp: "1234" })).status, 409, "can't start before arriving");

    await driver.ok("POST", `/rides/${ride.id}/arrived`);
    const active = (await rider.ok("GET", "/rides/active")).ride;
    assert.match(active.otp, /^\d{4}$/);
    assert.ok(Date.parse(active.otpExpiresAt) > Date.now() + 14 * 60 * 1000, "the OTP lasts 15 minutes");
    const driverView = (await driver.ok("GET", "/rides/active")).ride;
    assert.equal(driverView.otp, null, "the driver never sees the OTP");

    const wrong = await driver.call("POST", `/rides/${ride.id}/start`, { otp: active.otp === "0000" ? "1111" : "0000" });
    assert.equal(wrong.status, 400);
    await driver.ok("POST", `/rides/${ride.id}/start`, { otp: active.otp });
    const done = await driver.ok("POST", `/rides/${ride.id}/complete`);
    assert.equal(done.ride.status, "completed");
    assert.equal(done.ride.paymentStatus, "paid", "cash is collected by the driver");

    const earnings = await driver.ok("GET", "/driver/earnings");
    assert.equal(earnings.earnings.total.amount, done.ride.fare);
    const history = await rider.ok("GET", "/rides");
    assert.equal(history.rides[0].id, ride.id);

    // Suspending the rider blocks their still-valid JWT at once.
    page = await admin.get(`${urls.admin}/users`);
    await admin.post(`${urls.admin}/users/${users.getByEmail(riderEmail)!.id}/status`, { status: "suspended" }, page);
    const blocked = await rider.call("GET", "/me");
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, "Your account is suspended.");
});

test("live updates: the socket says refresh when a ride changes", async () => {
    const rider = await onboard(urls.api, "rider", stamp("live"));
    const socket = new WebSocket(urls.api.replace("http", "ws") + "/ws");
    const messages: string[] = [];
    await new Promise<void>((resolve, reject) => {
        socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token: rider.token }));
        socket.onerror = reject;
        socket.onmessage = (event) => {
            messages.push(JSON.parse(String(event.data)).type);
            if (messages.includes("ready")) resolve();
        };
    });
    const started = Date.now();
    await rider.ok("POST", "/rides", { pickup: GHATKOPAR, drop: POWAI, vehicleType: "bike" });
    await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
            if (messages.includes("refresh")) {
                clearInterval(timer);
                resolve();
            }
        }, 20);
    });
    socket.close();
    assert.ok(messages.includes("refresh"));
    // Pushed from the domain event, not the 10 s fallback poll.
    assert.ok(Date.now() - started < 2000, `refresh took ${Date.now() - started} ms`);
});
