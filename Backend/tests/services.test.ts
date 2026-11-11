import "./helpers/env.ts";
import test from "node:test";
import assert from "node:assert/strict";
import * as db from "../db/index.ts";
import * as drivers from "../services/drivers/service.ts";
import * as fare from "../services/rides/fare.ts";
import * as geo from "../services/places/service.ts";
import * as otp from "../services/users/otp.ts";
import * as rides from "../services/rides/service.ts";
import * as sms from "../lib/sms.ts";
import * as users from "../services/users/service.ts";
import type { Point, Role, UserRow, VehicleType } from "../lib/types.ts";

db.open();

const GHATKOPAR = { lat: 19.0863, lng: 72.9081, name: "Ghatkopar Station" };
const POWAI = { lat: 19.1176, lng: 72.906, name: "Powai" };
const KURLA = { lat: 19.0653, lng: 72.8794, name: "Kurla" };
const VASHI = { lat: 19.0771, lng: 72.9986, name: "Vashi" };
const COLABA = { lat: 18.922, lng: 72.8347, name: "Gateway of India" };

let counter = 0;
function makeUser(role: Role, { vehicleType = "car" as VehicleType, at = GHATKOPAR as Point } = {}): UserRow {
    counter += 1;
    const email = `svc-${role}-${counter}-${Date.now()}@example.test`;
    const { user } = users.findOrCreateFromIdentity({
        provider: "test",
        subject: email,
        email,
        emailVerified: true,
        name: `${role} ${counter}`
    });
    users.saveProfile(user.id, { name: user.name!, phone: `+9190000${String(counter).padStart(5, "0")}`, role });
    users.markPhoneVerified(user.id);
    users.completeOnboarding(user.id);
    if (role === "driver") {
        drivers.submit(
            user.id,
            {
                licenseNumber: "MH0120200000001",
                vehicleType,
                vehicleMake: "Tata",
                vehicleModel: "Nexon",
                vehiclePlate: `MH 01 ZZ ${1000 + counter}`
            },
            { licenseDoc: "x.pdf", rcDoc: "y.pdf" }
        );
        db.get().prepare("UPDATE drivers SET verification_status = 'approved' WHERE user_id = ?").run(user.id);
        drivers.setLocation(user.id, at);
        drivers.setOnline(user.id, true);
    }
    return users.getById(user.id)!;
}

test("fares respect the minimum and grow with distance", () => {
    assert.equal(fare.calculate("bike", 0.5, 3), fare.RATE_CARD.bike.minimum);
    assert.ok(fare.calculate("car", 20, 50) > fare.calculate("car", 5, 15));
    assert.ok(fare.calculate("car", 10, 25) > fare.calculate("bike", 10, 25));
});

test("routing falls back to a straight-line estimate when OSRM is unreachable", async () => {
    const route = await geo.route(COLABA, { lat: 19.1197, lng: 72.8464 });
    assert.equal(route.source, "estimate");
    assert.ok(route.distanceKm > 20 && route.distanceKm < 35, `got ${route.distanceKm} km`);
    assert.equal(route.geometry.length, 2);
});

test("estimates validate coordinates", async () => {
    await assert.rejects(rides.estimate({ lat: 999, lng: 0 }, POWAI), /pickup location/);
    await assert.rejects(rides.estimate(GHATKOPAR, GHATKOPAR), /too close/);
    const quote = await rides.estimate(GHATKOPAR, POWAI);
    assert.deepEqual(
        quote.options.map((o) => o.type),
        ["bike", "auto", "car"]
    );
});

test("identity linking: same provider subject returns the same user, verified email links providers", () => {
    const email = `link-${Date.now()}@example.test`;
    const first = users.findOrCreateFromIdentity({ provider: "google", subject: "g-1" + email, email, emailVerified: true });
    const again = users.findOrCreateFromIdentity({ provider: "google", subject: "g-1" + email, email, emailVerified: true });
    const other = users.findOrCreateFromIdentity({ provider: "apple", subject: "a-1" + email, email, emailVerified: true });
    assert.equal(first.isNew, true);
    assert.equal(again.isNew, false);
    assert.equal(again.user.id, first.user.id);
    assert.equal(other.user.id, first.user.id);
    // An unverified email can't take over the existing account.
    assert.throws(() => users.findOrCreateFromIdentity({ provider: "x", subject: "s", email, emailVerified: false }), /Verify your email/);
});

test("Auth0 roles: rider or driver from the token is applied; no role or both roles leave it to onboarding", () => {
    const email = `roles-${Date.now()}@example.test`;
    const { user } = users.findOrCreateFromIdentity({ provider: "auth0", subject: `auth0|${email}`, email, emailVerified: false });
    assert.equal(user.role, null, "an unverified email may still create a new account");
    assert.equal(users.applyRoles(user, ["admin"]).role, null);
    assert.equal(users.applyRoles(user, ["rider", "driver"]).role, null);
    assert.equal(users.applyRoles(user, ["driver"]).role, "driver");
    assert.equal(users.getById(user.id)!.role, "driver");
});

test("phone OTP: wrong code counts attempts, right code verifies once", () => {
    const user = makeUser("rider");
    db.get().prepare("DELETE FROM otp_codes WHERE user_id = ?").run(user.id);
    assert.equal(otp.issue(user.id, user.phone!), true);
    assert.equal(otp.issue(user.id, user.phone!), false, "resend cooldown");
    const code = sms.latestForUser(user.id, 1)[0]!.message.slice(0, 6);
    assert.equal(otp.verify(user.id, user.phone, code === "000000" ? "111111" : "000000").ok, false);
    assert.equal(otp.verify(user.id, user.phone, code).ok, true);
    assert.equal(otp.verify(user.id, user.phone, code).ok, false, "single use");
});

test("ride lifecycle with OTP and earnings", async () => {
    const rider = makeUser("rider");
    const driver = makeUser("driver");

    const ride = await rides.request(rider.id, { pickup: GHATKOPAR, drop: POWAI, vehicleType: "car" });
    assert.equal(ride.status, "requested");
    assert.ok(JSON.parse(ride.route_geometry!).length >= 2);
    await assert.rejects(rides.request(rider.id, { pickup: KURLA, drop: POWAI, vehicleType: "car" }), /already have a ride/);
    assert.ok(rides.openRequestsFor(drivers.get(driver.id)).some((r) => r.id === ride.id));

    rides.accept(ride.id, driver.id);
    assert.throws(() => rides.complete(ride.id, driver.id), /can't be updated/);
    rides.arrive(ride.id, driver.id);
    assert.throws(() => rides.start(ride.id, driver.id, "12345"), /doesn't match/);
    rides.start(ride.id, driver.id, ride.otp);
    assert.throws(() => rides.cancel(ride.id, { by: "rider", userId: rider.id }), /no longer be cancelled/);
    const done = rides.complete(ride.id, driver.id);
    assert.equal(done.status, "completed");
    assert.equal(rides.earnings(driver.id).total.amount, ride.fare);
    assert.equal(done.payment_status, "paid");
});

test("only one driver can accept a ride", async () => {
    const rider = makeUser("rider");
    const first = makeUser("driver");
    const second = makeUser("driver");
    const ride = await rides.request(rider.id, { pickup: GHATKOPAR, drop: KURLA, vehicleType: "car" });
    rides.accept(ride.id, first.id);
    assert.throws(() => rides.accept(ride.id, second.id), /no longer available/);
});

test("drivers don't see requests for other vehicle types or far away", async () => {
    const rider = makeUser("rider");
    const bike = makeUser("driver", { vehicleType: "bike" });
    const ride = await rides.request(rider.id, { pickup: GHATKOPAR, drop: VASHI, vehicleType: "auto" });
    assert.ok(!rides.openRequestsFor(drivers.get(bike.id)).some((r) => r.id === ride.id));

    const far = makeUser("driver", { vehicleType: "auto", at: COLABA });
    assert.ok(!rides.openRequestsFor(drivers.get(far.id)).some((r) => r.id === ride.id));
    rides.cancel(ride.id, { by: "rider", userId: rider.id });
});

test("a driver releasing a ride puts it back in the queue", async () => {
    const rider = makeUser("rider");
    const driver = makeUser("driver");
    const ride = await rides.request(rider.id, { pickup: GHATKOPAR, drop: POWAI, vehicleType: "car" });
    rides.accept(ride.id, driver.id);
    const released = rides.cancel(ride.id, { by: "driver", userId: driver.id });
    assert.equal(released.status, "requested");
    assert.equal(released.driver_id, null);
    rides.cancel(ride.id, { by: "rider", userId: rider.id });
});

test("unapproved drivers can't go online", () => {
    const user = makeUser("rider");
    assert.throws(() => drivers.setOnline(user.id, true), /isn't approved/);
});
