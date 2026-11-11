import { startServers, stopServers } from "./helpers/env.ts";
import test from "node:test";
import assert from "node:assert/strict";
import * as db from "../db/index.ts";
import * as drivers from "../services/drivers/service.ts";
import * as paymentGateway from "../services/payments/gateway.ts";
import * as users from "../services/users/service.ts";
import { App, GHATKOPAR, POWAI, onboard, stamp } from "./helpers/app.ts";
import type { Json } from "./helpers/app.ts";
import { Client } from "./helpers/client.ts";

let urls: Awaited<ReturnType<typeof startServers>>;
test.before(async () => {
    urls = await startServers();
});
test.after(() => stopServers());

const V1 = { prefix: "/api/v1" as const };

function adminId(): number {
    return users.findOrCreateFromIdentity({ provider: "test", subject: "admin", email: "admin@example.test", emailVerified: true }).user.id;
}

/** An approved, online driver near Ghatkopar, signed in to /api/v1. */
async function readyDriver(vehicleType = "car"): Promise<App> {
    const email = stamp("v1-driver");
    const driver = await onboard(urls.api, "driver", email, { vehicleType, ...V1 });
    drivers.review(users.getByEmail(email)!.id, adminId(), "approved");
    await driver.ok("POST", "/driver/location", { lat: 19.09, lng: 72.91 });
    await driver.ok("POST", "/driver/online", { online: true });
    return driver;
}

/** Book, accept, start and complete a ride. Returns the completed ride. */
async function completedRide(rider: App, driver: App, paymentMethod = "cash"): Promise<Json> {
    const { ride } = await rider.ok("POST", "/rides", { pickup: GHATKOPAR, drop: POWAI, vehicleType: "car", paymentMethod });
    await driver.ok("POST", `/rides/${ride.id}/accept`);
    const { ride: accepted } = await rider.ok("GET", `/rides/${ride.id}`);
    await driver.ok("POST", `/rides/${ride.id}/start`, { otp: accepted.otp });
    return (await driver.ok("POST", `/rides/${ride.id}/complete`)).ride;
}

test("v1 errors have a stable code, message and field details", async () => {
    const anonymous = new App(urls.api, "/api/v1");
    const unauth = await anonymous.call("GET", "/me");
    assert.equal(unauth.status, 401);
    assert.deepEqual(unauth.body, { error: { code: "UNAUTHENTICATED", message: "Please sign in again." } });
    assert.ok(unauth.headers.get("x-request-id"), "every response carries a request id");

    const rider = await onboard(urls.api, "rider", stamp("v1-errors"), V1);
    const invalid = await rider.call("POST", "/onboarding/verify", { code: 123 });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "VALIDATION_FAILED");
    assert.deepEqual(invalid.body.error.details.issues[0].path, "code");

    const badId = await rider.call("GET", "/rides/abc");
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error.details.issues[0].source, "params");

    const missing = await rider.call("GET", "/rides/999999");
    assert.equal(missing.body.error.code, "RIDE_NOT_FOUND");

    const notJson = await fetch(`${urls.api}/api/v1/rides`, {
        method: "POST",
        headers: { authorization: `Bearer ${rider.token}`, "content-type": "application/json" },
        body: "{oops"
    });
    assert.equal(notJson.status, 400);
    assert.equal(((await notJson.json()) as Json).error.code, "VALIDATION_FAILED");

    const unknown = await rider.call("GET", "/nope");
    assert.equal(unknown.body.error.code, "NOT_FOUND");
});

test("the first request with a new user's JWT creates their account", async () => {
    const email = stamp("first");
    const app = new App(urls.api, "/api/v1");
    const me = await app.signIn(email);
    assert.equal(me.user.email, email);
    assert.equal(me.next, "profile");
    // Several requests at once (the app's first screen) still create only one account.
    const again = await Promise.all([1, 2, 3].map(() => app.ok("GET", "/me")));
    assert.ok(again.every((body) => body.user.id === me.user.id));

    const timeline = await app.ok("GET", "/me/activity");
    assert.equal(timeline.items[0].type, "account.created");
    assert.equal(timeline.items[0].metadata.app, "app");
});

test("the admin app needs the admin role from the sign-in token", async () => {
    const browser = new Client();
    const refused = await browser.signIn(urls.admin, "rider@example.test", "Rider");
    assert.match(refused.text, /doesn&#39;t have the admin role|doesn't have the admin role/);
    const admin = new Client();
    const page = await admin.signIn(urls.admin, "admin@example.test", "Admin");
    assert.match(page.text, /Platform overview/);
});

test("booking is idempotent: retrying with the same key returns the same ride", async () => {
    const rider = await onboard(urls.api, "rider", stamp("v1-idem"), V1);
    const body = { pickup: GHATKOPAR, drop: POWAI, vehicleType: "car" };
    const key = { "idempotency-key": `book-${Date.now()}` };

    const first = await rider.call("POST", "/rides", body, key);
    assert.equal(first.status, 201);
    const retry = await rider.call("POST", "/rides", body, key);
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get("idempotent-replayed"), "true");
    assert.equal(retry.body.ride.id, first.body.ride.id);

    const reused = await rider.call("POST", "/rides", { ...body, vehicleType: "bike" }, key);
    assert.equal(reused.status, 422);
    assert.equal(reused.body.error.code, "IDEMPOTENCY_KEY_REUSED");

    // Without a key the active-ride guard still stops a second booking.
    const again = await rider.call("POST", "/rides", body);
    assert.equal(again.body.error.code, "ACTIVE_RIDE_EXISTS");
    await rider.ok("POST", `/rides/${first.body.ride.id}/cancel`, {});
});

test("card payment: checkout page, signed webhook, then paid", async () => {
    const rider = await onboard(urls.api, "rider", stamp("v1-card"), V1);
    const driver = await readyDriver();
    const ride = await completedRide(rider, driver, "card");
    assert.equal(ride.paymentMethod, "card");
    assert.equal(ride.paymentStatus, "pending", "card rides wait for the rider to pay");

    const { payment } = await rider.ok("GET", `/rides/${ride.id}/payment`);
    assert.equal(payment.status, "pending");
    assert.equal(payment.amount, ride.fare);

    // The driver can't start the rider's checkout.
    assert.equal((await driver.call("POST", `/rides/${ride.id}/payments/checkout`, { method: "card" })).status, 403);

    const checkout = await rider.ok("POST", `/rides/${ride.id}/payments/checkout`, { method: "card" });
    assert.match(checkout.checkoutUrl, /\/pay\/mock\/mock_cs_/);

    // The rider's browser opens the hosted page and pays.
    const browser = new Client();
    const page = await browser.get(checkout.checkoutUrl);
    assert.match(page.text, /TEST MODE/);
    const back = await browser.request(checkout.checkoutUrl, { method: "POST", form: { outcome: "succeeded" } });
    assert.match(back.url, new RegExp(`/trips/${ride.id}\\?payment=succeeded$`));

    const paid = await rider.ok("GET", `/rides/${ride.id}`);
    assert.equal(paid.ride.paymentStatus, "paid");
    const again = await rider.call("POST", `/rides/${ride.id}/payments/checkout`, { method: "upi" });
    assert.equal(again.body.error.code, "PAYMENT_STATE_CONFLICT");

    // The driver sees it as received.
    const received = await driver.ok("GET", "/me/payments");
    assert.equal(received.items[0].rideId, ride.id);
    assert.equal(received.items[0].status, "succeeded");
});

test("declined payments can be retried; forged webhooks are rejected", async () => {
    const rider = await onboard(urls.api, "rider", stamp("v1-decline"), V1);
    const driver = await readyDriver();
    const ride = await completedRide(rider, driver, "upi");

    const first = await rider.ok("POST", `/rides/${ride.id}/payments/checkout`, { method: "upi" });
    await new Client().request(first.checkoutUrl, { method: "POST", form: { outcome: "failed" } });
    assert.equal((await rider.ok("GET", `/rides/${ride.id}`)).ride.paymentStatus, "failed");

    // A forged "succeeded" for the new session is refused.
    const second = await rider.ok("POST", `/rides/${ride.id}/payments/checkout`, { method: "card" });
    const sessionId = second.checkoutUrl.split("/").pop();
    const forgedBody = JSON.stringify({ sessionId, outcome: "succeeded" });
    const forged = await fetch(`${urls.api}/api/v1/payments/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-rideshare-signature": "sha256=deadbeef" },
        body: forgedBody
    });
    assert.equal(forged.status, 401);
    assert.equal((await rider.ok("GET", `/rides/${ride.id}`)).ride.paymentStatus, "pending");

    // A correctly signed one (as the provider would send) is accepted, and repeating it is harmless.
    const signed = {
        method: "POST",
        headers: { "content-type": "application/json", "x-rideshare-signature": paymentGateway.sign(forgedBody) },
        body: forgedBody
    };
    assert.equal((await fetch(`${urls.api}/api/v1/payments/webhook`, signed)).status, 200);
    assert.equal((await fetch(`${urls.api}/api/v1/payments/webhook`, signed)).status, 200);
    assert.equal((await rider.ok("GET", `/rides/${ride.id}/payment`)).payment.status, "succeeded");
});

test("histories: rides taken, trips made with earnings, paginated", async () => {
    const rider = await onboard(urls.api, "rider", stamp("v1-hist"), V1);
    const driver = await readyDriver();
    const rideIds: number[] = [];
    for (let i = 0; i < 3; i++) rideIds.push((await completedRide(rider, driver)).id);

    const firstPage = await rider.ok("GET", "/me/rides?limit=2");
    assert.deepEqual(
        firstPage.items.map((r: Json) => r.id),
        [rideIds[2], rideIds[1]]
    );
    assert.equal(firstPage.nextCursor, rideIds[1]);
    const secondPage = await rider.ok("GET", `/me/rides?limit=2&cursor=${firstPage.nextCursor}`);
    assert.deepEqual(
        secondPage.items.map((r: Json) => r.id),
        [rideIds[0]]
    );
    assert.equal(secondPage.nextCursor, null);

    const trips = await driver.ok("GET", "/me/trips");
    assert.deepEqual(
        trips.items.slice(0, 3).map((r: Json) => r.id),
        [...rideIds].reverse()
    );
    assert.equal(trips.earnings.total.trips, 3);
    assert.equal((await rider.call("GET", "/me/trips")).status, 403, "riders have no trips");
});

test("activity: a full ride is recorded on both timelines, with IP and user agent", async () => {
    const rider = await onboard(urls.api, "rider", stamp("v1-activity"), V1);
    const driver = await readyDriver();
    const ride = await completedRide(rider, driver);

    const riderTypes = (await rider.ok("GET", "/me/activity")).items.filter((e: Json) => e.entity?.id === ride.id).map((e: Json) => e.type);
    for (const type of ["ride.requested", "ride.accepted", "ride.started", "ride.completed", "payment.succeeded"]) {
        assert.ok(riderTypes.includes(type), `rider timeline has ${type}: ${riderTypes}`);
    }
    const driverTypes = (await driver.ok("GET", "/me/activity")).items.map((e: Json) => e.type);
    assert.ok(
        driverTypes.includes("driver.approved") && driverTypes.includes("driver.went_online") && driverTypes.includes("ride.completed")
    );

    const row = db
        .get()
        .prepare("SELECT ip, user_agent FROM activity_events WHERE entity_id = ? AND type = 'ride.requested'")
        .get(ride.id) as Json;
    assert.ok(row.ip, "ip recorded");
    assert.ok(row.user_agent, "user agent recorded");
});

test("admin: user page shows rides, trips, payments and activity; payments can be refunded", async () => {
    const riderEmail = stamp("v1-admin-rider");
    const rider = await onboard(urls.api, "rider", riderEmail, V1);
    const driver = await readyDriver();
    const ride = await completedRide(rider, driver);
    const riderId = users.getByEmail(riderEmail)!.id;
    const driverId = (await driver.ok("GET", "/me")).user.id;

    const admin = new Client();
    await admin.signIn(urls.admin, "admin@example.test", "Admin");

    let page = await admin.get(`${urls.admin}/users/${riderId}`);
    assert.match(page.text, /Rides taken/);
    assert.match(page.text, new RegExp(`/rides/${ride.id}`));
    page = await admin.get(`${urls.admin}/users/${driverId}?tab=trips`);
    assert.match(page.text, /Trips made/);
    assert.match(page.text, new RegExp(`/rides/${ride.id}`));
    page = await admin.get(`${urls.admin}/users/${riderId}?tab=activity`);
    assert.match(page.text, /Trip completed/);
    page = await admin.get(`${urls.admin}/users/${riderId}?tab=payments`);
    assert.match(page.text, /CASH/);
    assert.equal((await admin.get(`${urls.admin}/payments`)).status, 200);

    page = await admin.get(`${urls.admin}/rides/${ride.id}`);
    assert.match(page.text, /Refund payment/);
    const paymentId = (await rider.ok("GET", `/rides/${ride.id}/payment`)).payment.id;
    page = await admin.post(`${urls.admin}/payments/${paymentId}/refund`, { reason: "Test refund" }, page);
    assert.match(page.text, /marked as refunded/);
    assert.equal((await rider.ok("GET", `/rides/${ride.id}`)).ride.paymentStatus, "refunded");
    const timeline = (await rider.ok("GET", "/me/activity")).items.map((e: Json) => e.type);
    assert.ok(timeline.includes("payment.refunded"));
});

test("OpenAPI document lists every v1 route, and /docs serves it", async () => {
    const doc = (await (await fetch(`${urls.api}/api/v1/openapi.json`)).json()) as Json;
    assert.equal(doc.openapi, "3.1.0");
    const paths = Object.keys(doc.paths);
    for (const path of [
        "/health",
        "/config",
        "/auth/logout",
        "/me",
        "/onboarding/driver",
        "/rides",
        "/rides/{id}/start",
        "/rides/{id}/payments/checkout",
        "/payments/webhook",
        "/me/rides",
        "/me/trips",
        "/me/activity",
        "/driver/online"
    ]) {
        assert.ok(paths.includes(path), `missing ${path}`);
    }
    assert.ok(doc.paths["/rides"].post.parameters.some((p: Json) => p.name === "idempotency-key"));
    assert.ok(doc.components.schemas.Ride && doc.components.schemas.Payment && doc.components.schemas.Error);

    const docs = await fetch(`${urls.api}/docs/`);
    assert.equal(docs.status, 200);
    assert.match(await docs.text(), /swagger/i);
});
