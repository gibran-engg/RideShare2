import "./helpers/env.ts";
import test from "node:test";
import assert from "node:assert/strict";
import * as db from "../db/index.ts";
import * as chat from "../services/chat/service.ts";
import * as drivers from "../services/drivers/service.ts";
import * as fare from "../services/rides/fare.ts";
import * as ola from "../services/places/ola.ts";
import * as ratings from "../services/ratings/service.ts";
import * as rides from "../services/rides/service.ts";
import * as savedPlaces from "../services/saved-places/service.ts";
import * as sms from "../lib/sms.ts";
import * as users from "../services/users/service.ts";
import type { Point, Role, UserRow, VehicleType } from "../lib/types.ts";

/** Round 7 features: pricing segments, OTP on arrival, chat, ratings, safety, saved places, nearby cabs, hours online. */

db.open();

const GHATKOPAR = { lat: 19.0863, lng: 72.9081, name: "Ghatkopar Station" };
const POWAI = { lat: 19.1176, lng: 72.906, name: "Powai" };
const COLABA = { lat: 18.922, lng: 72.8347, name: "Gateway of India" };

let counter = 0;
function makeUser(role: Role, { vehicleType = "car" as VehicleType, at = GHATKOPAR as Point, online = true } = {}): UserRow {
    counter += 1;
    const email = `feat-${role}-${counter}-${Date.now()}@example.test`;
    const { user } = users.findOrCreateFromIdentity({
        provider: "test",
        subject: email,
        email,
        emailVerified: true,
        name: `${role} ${counter}`
    });
    users.saveProfile(user.id, { name: user.name!, phone: `+9191000${String(counter).padStart(5, "0")}`, role });
    users.markPhoneVerified(user.id);
    users.completeOnboarding(user.id);
    if (role === "driver") {
        drivers.submit(
            user.id,
            {
                licenseNumber: "MH0120200000002",
                vehicleType,
                vehicleMake: "Tata",
                vehicleModel: "Nexon",
                vehiclePlate: `MH 01 FF ${1000 + counter}`,
                vehicleYear: 2022,
                licenseExpiry: "2099-01-01",
                insuranceExpiry: "2099-01-01"
            },
            { licenseDoc: "x.pdf", rcDoc: "y.pdf", insuranceDoc: "z.pdf" }
        );
        db.get().prepare("UPDATE drivers SET verification_status = 'approved' WHERE user_id = ?").run(user.id);
        drivers.setLocation(user.id, at);
        if (online) drivers.setOnline(user.id, true);
    }
    return users.getById(user.id)!;
}

/** A booked ride that the driver has accepted (and optionally arrived at). */
async function acceptedRide({ arrive = false } = {}) {
    const rider = makeUser("rider");
    const driver = makeUser("driver");
    const booked = await rides.request(rider.id, { pickup: GHATKOPAR, drop: POWAI, vehicleType: "car" });
    rides.accept(booked.id, driver.id);
    const ride = arrive ? rides.arrive(booked.id, driver.id) : rides.get(booked.id)!;
    return { rider, driver, ride };
}

/** A UTC instant that is hh:mm in India (UTC+5:30). */
function india(hh: number, mm: number): Date {
    return new Date(Date.UTC(2026, 10, 11, hh, mm) - 330 * 60 * 1000);
}

// ---- Pricing ----

test("pricing segments switch at the right India-time boundaries", () => {
    const cases: [number, number, fare.PricingSegmentId][] = [
        [0, 0, "night"],
        [4, 59, "night"],
        [5, 0, "normal"],
        [7, 59, "normal"],
        [8, 0, "peak"],
        [10, 59, "peak"],
        [11, 0, "normal"],
        [16, 59, "normal"],
        [17, 0, "peak"],
        [19, 59, "peak"],
        [20, 0, "normal"],
        [23, 59, "normal"]
    ];
    for (const [hh, mm, expected] of cases) {
        assert.equal(fare.segmentAt(india(hh, mm)).id, expected, `${hh}:${String(mm).padStart(2, "0")} IST`);
    }
});

test("peak is 1.5x and late night 1.3x the normal fare, minimum fare included", () => {
    const normal = fare.quote("car", 10, 30, india(13, 0));
    const peak = fare.quote("car", 10, 30, india(9, 0));
    const night = fare.quote("car", 10, 30, india(2, 0));
    const raw = normal.base + normal.distanceCharge + normal.timeCharge;
    assert.equal(normal.fare, Math.round(raw));
    assert.equal(peak.fare, Math.round(raw * 1.5));
    assert.equal(night.fare, Math.round(raw * 1.3));
    assert.equal(peak.segmentLabel, "Peak hours");
    // A very short bike trip pays the minimum, and peak multiplies that too.
    assert.equal(fare.quote("bike", 0.1, 1, india(13, 0)).fare, fare.RATE_CARD.bike.minimum);
    assert.equal(fare.quote("bike", 0.1, 1, india(13, 0)).minimumApplied, true);
    assert.equal(fare.quote("bike", 0.1, 1, india(9, 0)).fare, Math.round(fare.RATE_CARD.bike.minimum * 1.5));
});

test("a booked ride keeps the pricing segment and breakdown it was quoted with", async () => {
    const rider = makeUser("rider");
    const ride = await rides.request(rider.id, { pickup: GHATKOPAR, drop: POWAI, vehicleType: "auto" });
    const segment = fare.segmentAt();
    assert.equal(ride.pricing_segment, segment.id);
    assert.equal(ride.fare_multiplier, segment.multiplier);
    assert.ok(ride.fare_base! > 0 && ride.fare_distance! > 0);
    rides.cancel(ride.id, { by: "rider", userId: rider.id });
});

// ---- OTP on arrival ----

test("the trip OTP is created when the driver arrives and expires after 15 minutes", async () => {
    const { rider, driver, ride } = await acceptedRide();
    assert.equal(ride.otp, "", "no OTP at booking or acceptance");
    assert.throws(() => rides.refreshOtp(ride.id, rider.id), /when your driver arrives/);

    const arrived = rides.arrive(ride.id, driver.id);
    assert.match(arrived.otp, /^\d{4}$/);
    const ttl = arrived.otp_expires_at! - Date.now();
    assert.ok(ttl > 14.9 * 60 * 1000 && ttl <= 15 * 60 * 1000, "15-minute expiry");
    assert.ok(sms.latestForUser(rider.id, 1)[0]!.message.includes(arrived.otp), "the rider is sent the OTP");

    // An expired code is refused; the rider asks for a new one.
    db.get()
        .prepare("UPDATE rides SET otp_expires_at = ? WHERE id = ?")
        .run(Date.now() - 1000, ride.id);
    assert.throws(() => rides.start(ride.id, driver.id, arrived.otp), /expired/);
    const fresh = rides.refreshOtp(ride.id, rider.id);
    assert.ok(fresh.otp_expires_at! > Date.now());
    assert.equal(rides.start(ride.id, driver.id, fresh.otp).status, "in_progress");
    assert.equal(rides.get(ride.id)!.otp, "", "the OTP is cleared once used");
});

test("three wrong OTPs replace the code with a new one", async () => {
    const { driver, ride } = await acceptedRide({ arrive: true });
    const wrong = ride.otp === "0000" ? "1111" : "0000";
    assert.throws(() => rides.start(ride.id, driver.id, wrong), /doesn't match/);
    assert.throws(() => rides.start(ride.id, driver.id, wrong), /doesn't match/);
    assert.throws(() => rides.start(ride.id, driver.id, wrong), /new code/);
    const after = rides.get(ride.id)!;
    assert.equal(after.otp_attempts, 0, "attempts reset with the new code");
    assert.ok(after.otp_expires_at! > Date.now());
    if (after.otp !== ride.otp) assert.throws(() => rides.start(ride.id, driver.id, ride.otp), /doesn't match/);
    assert.equal(rides.start(ride.id, driver.id, after.otp).status, "in_progress");
});

// ---- Cancellation fee ----

test("a rider cancelling after the driver arrives pays a fee that goes to the driver", async () => {
    const early = await acceptedRide();
    assert.equal(rides.cancel(early.ride.id, { by: "rider", userId: early.rider.id, reason: "Plans changed" }).cancellation_fee, 0);

    const late = await acceptedRide({ arrive: true });
    const cancelled = rides.cancel(late.ride.id, { by: "rider", userId: late.rider.id, reason: "Driver took too long" });
    assert.equal(cancelled.cancellation_fee, rides.CANCELLATION_FEE);
    assert.equal(cancelled.otp, "", "the OTP is cleared");
    const earnings = rides.earnings(late.driver.id);
    assert.equal(earnings.today.amount, rides.CANCELLATION_FEE);
    assert.equal(earnings.today.trips, 0, "a fee is not a trip");
});

// ---- Chat ----

test("rider and driver can chat from acceptance until the trip ends", async () => {
    const rider = makeUser("rider");
    const driver = makeUser("driver");
    const stranger = makeUser("rider");
    const ride = await rides.request(rider.id, { pickup: GHATKOPAR, drop: POWAI, vehicleType: "car" });
    assert.throws(() => chat.send(ride.id, rider.id, "hello?"), /once a driver accepts/);

    rides.accept(ride.id, driver.id);
    const before = rides.fingerprint(rider.id);
    chat.send(ride.id, rider.id, "I'm at gate 2");
    assert.notEqual(rides.fingerprint(rider.id), before, "a new message refreshes the other app");
    const reply = chat.send(ride.id, driver.id, "  Coming, 2 mins  ");
    assert.equal(reply.body, "Coming, 2 mins");
    assert.deepEqual(
        chat.list(ride.id, driver.id).map((m) => m.body),
        ["I'm at gate 2", "Coming, 2 mins"]
    );
    assert.equal(chat.list(ride.id, rider.id, reply.id - 1).length, 1, "only newer messages with afterId");
    assert.throws(() => chat.list(ride.id, stranger.id), /not found/);
    assert.throws(() => chat.send(ride.id, rider.id, "x".repeat(501)), /up to 500/);
    assert.throws(() => chat.send(ride.id, rider.id, "   "), /Type a message/);

    const arrived = rides.arrive(ride.id, driver.id);
    rides.start(ride.id, driver.id, arrived.otp);
    rides.complete(ride.id, driver.id);
    assert.throws(() => chat.send(ride.id, rider.id, "thanks"), /until the trip ends/);
    assert.equal(chat.list(ride.id, rider.id).length, 2, "history stays readable");
});

// ---- Ratings ----

test("after a completed ride each side rates the other once", async () => {
    const { rider, driver, ride } = await acceptedRide({ arrive: true });
    assert.throws(() => ratings.rate(ride.id, rider.id, { stars: 5 }), /once it's completed/);
    rides.start(ride.id, driver.id, ride.otp);
    rides.complete(ride.id, driver.id);

    const given = ratings.rate(ride.id, rider.id, { stars: 4, tags: ["Clean car", "Not a real tag"], comment: "Nice ride" });
    assert.equal(given.ratee_id, driver.id);
    assert.deepEqual(JSON.parse(given.tags!), ["Clean car"], "only known tags are kept");
    assert.throws(() => ratings.rate(ride.id, rider.id, { stars: 5 }), /already rated/);
    assert.throws(() => ratings.rate(ride.id, driver.id, { stars: 0 }), /1 and 5/);
    ratings.rate(ride.id, driver.id, { stars: 5, tags: ["On time"] });

    assert.deepEqual(ratings.summary(driver.id), { average: 4, count: 1 });
    assert.deepEqual(ratings.summary(rider.id), { average: 5, count: 1 });
});

// ---- Safety ----

test("SOS alerts support, and a shared link shows the trip without phones or OTP", async () => {
    const { rider, driver, ride } = await acceptedRide({ arrive: true });
    const stranger = makeUser("rider");

    const url = rides.shareLink(ride.id, rider.id);
    assert.equal(rides.shareLink(ride.id, rider.id), url, "the same link every time");
    assert.throws(() => rides.shareLink(ride.id, stranger.id), /not found/);
    const token = url.split("/track/")[1]!;
    const shared = rides.sharedRide(token);
    assert.equal(shared.status, "arrived");
    assert.ok(shared.driver?.location, "the driver's live position");
    const json = JSON.stringify(shared);
    assert.ok(!json.includes(ride.otp) || ride.otp.length === 0, "no OTP");
    assert.ok(!json.includes("+91"), "no phone numbers");
    assert.throws(() => rides.sharedRide("not-a-real-token"), /isn't valid/);

    assert.throws(() => rides.sos(ride.id, stranger.id), /not found/);
    const alerted = rides.sos(ride.id, driver.id);
    assert.ok(alerted.sos_at);
    assert.ok(
        sms.recent(5).some((n) => n.recipient === "support" && n.message.includes(`SOS on ride #${ride.id}`)),
        "support is alerted"
    );
});

// ---- Saved places ----

test("riders save places by label; saving the same label replaces it", () => {
    const rider = makeUser("rider");
    const home = savedPlaces.save(rider.id, { label: "Home", ...GHATKOPAR });
    savedPlaces.save(rider.id, { label: "Work", ...POWAI });
    savedPlaces.save(rider.id, { label: "Home", ...COLABA });
    const places = savedPlaces.list(rider.id);
    assert.deepEqual(
        places.map((p) => [p.label, p.name]),
        [
            ["Home", "Gateway of India"],
            ["Work", "Powai"]
        ]
    );
    savedPlaces.remove(rider.id, home.id);
    assert.equal(savedPlaces.list(rider.id).length, 1);
    assert.throws(() => savedPlaces.remove(rider.id, home.id), /not found/);
    assert.throws(() => savedPlaces.save(rider.id, { label: "Bad", name: "Nowhere", lat: 200, lng: 0 }), /Invalid location/);
});

// ---- Nearby cabs and hours online ----

test("riders see online cabs nearby, not offline or far away ones", () => {
    const near = makeUser("driver", { at: { lat: 19.087, lng: 72.909 } });
    const offline = makeUser("driver", { at: { lat: 19.087, lng: 72.909 }, online: false });
    const far = makeUser("driver", { at: COLABA });
    const found = drivers.onlineNear(GHATKOPAR, 5).map((d) => d.user_id);
    assert.ok(found.includes(near.id));
    assert.ok(!found.includes(offline.id));
    assert.ok(!found.includes(far.id));
});

test("hours online today add up across sessions", () => {
    const driver = makeUser("driver", { online: false });
    assert.equal(drivers.secondsOnlineToday(driver.id), 0);
    drivers.setOnline(driver.id, true);
    // Pretend this session started 30 minutes ago (but not before today in India).
    db.get().prepare("UPDATE drivers SET online_since = datetime('now', '-30 minutes') WHERE user_id = ?").run(driver.id);
    const during = drivers.secondsOnlineToday(driver.id);
    assert.ok(during >= 0 && during <= 30 * 60 + 5);
    drivers.setOnline(driver.id, false);
    const after = drivers.secondsOnlineToday(driver.id);
    assert.ok(Math.abs(after - during) <= 5, "going offline keeps the time");
    assert.equal(drivers.get(driver.id)!.online_since, null);
});

// ---- Ola Maps ----

test("Ola Maps is off without a key, and its route lines decode correctly", () => {
    assert.equal(ola.enabled(), false, "tests never call Ola");
    // The example from Google's encoded polyline documentation.
    assert.deepEqual(ola.decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
        [38.5, -120.2],
        [40.7, -120.95],
        [43.252, -126.453]
    ]);
});

test("booking charges the quoted price; quotes are per rider and single use", async () => {
    const rider = makeUser("rider");
    const other = makeUser("rider");
    // Quoted at 02:00 India time (late night ×1.3): booking keeps that price whatever the time is now.
    const quote = await rides.estimate(GHATKOPAR, POWAI, { at: india(2, 0), riderId: rider.id });
    assert.ok(quote.quoteId);
    const quoted = quote.options.find((o) => o.type === "car")!;

    const stolen = await rides.request(other.id, { pickup: GHATKOPAR, drop: POWAI, vehicleType: "car", quoteId: quote.quoteId });
    assert.equal(stolen.pricing_segment, fare.segmentAt().id, "another rider's quote is ignored");
    rides.cancel(stolen.id, { by: "rider", userId: other.id });

    const ride = await rides.request(rider.id, { pickup: GHATKOPAR, drop: POWAI, vehicleType: "car", quoteId: quote.quoteId });
    assert.equal(ride.pricing_segment, fare.segmentAt().id, "the quote was used up by the failed attempt");
    rides.cancel(ride.id, { by: "rider", userId: rider.id });

    const fresh = await rides.estimate(GHATKOPAR, POWAI, { at: india(2, 0), riderId: rider.id });
    const booked = await rides.request(rider.id, { pickup: GHATKOPAR, drop: POWAI, vehicleType: "car", quoteId: fresh.quoteId });
    assert.equal(booked.pricing_segment, "night");
    assert.equal(booked.fare, fresh.options.find((o) => o.type === "car")!.fare);
    assert.equal(quoted.breakdown.multiplier, 1.3);
    rides.cancel(booked.id, { by: "rider", userId: rider.id });

    const elsewhere = await rides.estimate(GHATKOPAR, POWAI, { at: india(2, 0), riderId: rider.id });
    const moved = await rides.request(rider.id, { pickup: COLABA, drop: POWAI, vehicleType: "car", quoteId: elsewhere.quoteId });
    assert.equal(moved.pricing_segment, fare.segmentAt().id, "a quote only covers the trip it was for");
    rides.cancel(moved.id, { by: "rider", userId: rider.id });
});

test("driver onboarding refuses expired licences or insurance, and needs all three documents", () => {
    const email = `feat-onboard-${Date.now()}@example.test`;
    const { user } = users.findOrCreateFromIdentity({ provider: "test", subject: email, email, emailVerified: true, name: "New Driver" });
    const details = {
        licenseNumber: "MH0120200000003",
        vehicleType: "auto" as VehicleType,
        vehicleMake: "Bajaj",
        vehicleModel: "RE",
        vehiclePlate: "MH 01 GG 1234",
        vehicleYear: 2021,
        licenseExpiry: "2099-01-01",
        insuranceExpiry: "2099-01-01"
    };
    const docs = { licenseDoc: "l.pdf", rcDoc: "r.pdf", insuranceDoc: "i.pdf" };
    const todayInIndia = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

    assert.throws(() => drivers.submit(user.id, { ...details, licenseExpiry: "2020-01-01" }, docs), /licence has expired/);
    assert.throws(
        () => drivers.submit(user.id, { ...details, insuranceExpiry: todayInIndia }, docs),
        /insurance has expired/,
        "expiring today is too late"
    );
    assert.throws(() => drivers.submit(user.id, details, { ...docs, insuranceDoc: null }), /licence, vehicle RC and insurance/);

    const submitted = drivers.submit(user.id, details, docs);
    assert.equal(submitted.verification_status, "pending");
    // Resubmitting keeps documents that weren't replaced.
    const again = drivers.submit(user.id, { ...details, vehicleColor: "Yellow" }, { insuranceDoc: "i2.pdf" });
    assert.deepEqual([again.license_doc, again.rc_doc, again.insurance_doc], ["l.pdf", "r.pdf", "i2.pdf"]);
});
