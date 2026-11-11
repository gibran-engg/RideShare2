/**
 * Adds demo data for local development. Safe to run more than once.
 * The seeded emails match the quick-pick accounts on the dev sign-in page.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import config from "../lib/config.ts";
import * as db from "../db/index.ts";
import * as drivers from "../services/drivers/service.ts";
import * as savedPlaces from "../services/saved-places/service.ts";
import * as users from "../services/users/service.ts";
import type { PaymentMethod, Point, Role, UserRow, VehicleType } from "../lib/types.ts";

if (config.isProduction) {
    console.error("Refusing to seed demo data in production.");
    process.exit(1);
}

db.open();

// Around Ghatkopar / Vidyavihar, Mumbai (the default service area).
const SPOTS = {
    ghatkopar: { lat: 19.0863, lng: 72.9081, name: "Ghatkopar Station" },
    vidyavihar: { lat: 19.0728, lng: 72.8999, name: "Vidyavihar Station" },
    powai: { lat: 19.1176, lng: 72.906, name: "Powai Lake" },
    bkc: { lat: 19.0662, lng: 72.8654, name: "BKC" },
    airport: { lat: 19.0974, lng: 72.8746, name: "Mumbai Airport T2" }
};

// A tiny but valid PDF used as a placeholder document.
function placeholderPdf(title: string): string {
    const text = `RideShare demo document: ${title}`;
    const stream = `BT /F1 14 Tf 30 100 Td (${text}) Tj ET`;
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    ];

    let body = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, index) => {
        offsets.push(body.length);
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    fs.mkdirSync(config.uploadDir, { recursive: true });
    const name = `${crypto.randomUUID()}.pdf`;
    fs.writeFileSync(path.join(config.uploadDir, name), body);
    return name;
}

function ensureUser({ email, name, phone, role }: { email: string; name: string; phone: string; role: Role }): UserRow {
    const existing = users.getByEmail(email);
    if (existing) return existing;
    db.get()
        .prepare(
            `INSERT INTO users (email, name, phone, phone_verified, role, onboarding_complete)
             VALUES (?, ?, ?, 1, ?, 1)`
        )
        .run(email, name, phone, role);
    return users.getByEmail(email)!;
}

interface Vehicle {
    license: string;
    type: VehicleType;
    make: string;
    model: string;
    plate: string;
    color: string;
    year: number;
}

/** A date `years` from today, as YYYY-MM-DD (for document expiry dates). */
function yearsFromNow(years: number): string {
    const date = new Date();
    date.setFullYear(date.getFullYear() + years);
    return date.toISOString().slice(0, 10);
}

function ensureDriver(user: UserRow, vehicle: Vehicle, status: "approved" | "pending", spot: Point): void {
    if (drivers.get(user.id)) return;
    drivers.submit(
        user.id,
        {
            licenseNumber: vehicle.license,
            vehicleType: vehicle.type,
            vehicleMake: vehicle.make,
            vehicleModel: vehicle.model,
            vehiclePlate: vehicle.plate,
            vehicleColor: vehicle.color,
            vehicleYear: vehicle.year,
            licenseExpiry: yearsFromNow(8),
            insuranceExpiry: yearsFromNow(1)
        },
        {
            licenseDoc: placeholderPdf(`Driving licence ${vehicle.license}`),
            rcDoc: placeholderPdf(`RC ${vehicle.plate}`),
            insuranceDoc: placeholderPdf(`Insurance ${vehicle.plate}`)
        }
    );
    if (status === "approved") {
        db.get()
            .prepare(
                "UPDATE drivers SET verification_status = 'approved', reviewed_at = datetime('now'), lat = ?, lng = ? WHERE user_id = ?"
            )
            .run(spot.lat, spot.lng, user.id);
    }
}

function activity(userId: number, type: string, rideId: number | null, metadata: Record<string, unknown>, daysAgo: number): void {
    db.get()
        .prepare(
            `INSERT INTO activity_events (user_id, type, entity_type, entity_id, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, datetime('now', ?))`
        )
        .run(userId, type, rideId ? "ride" : null, rideId, JSON.stringify(metadata), `-${daysAgo} days`);
}

interface PastTrip {
    from: keyof typeof SPOTS;
    to: keyof typeof SPOTS;
    km: number;
    min: number;
    fare: number;
    method: PaymentMethod;
    outcome: "paid" | "pending" | "cancelled";
    daysAgo: number;
}

/** A few finished trips so ride history, earnings, payments and timelines aren't empty. */
function seedHistory(rider: UserRow, driver: UserRow): number {
    const already = db.get().prepare("SELECT COUNT(*) AS n FROM rides WHERE rider_id = ?").get(rider.id) as { n: number };
    if (already.n > 0) return 0;

    const trips: PastTrip[] = [
        { from: "ghatkopar", to: "powai", km: 5.4, min: 22, fare: 181, method: "cash", outcome: "paid", daysAgo: 6 },
        { from: "vidyavihar", to: "bkc", km: 7.9, min: 31, fare: 238, method: "card", outcome: "paid", daysAgo: 3 },
        { from: "powai", to: "airport", km: 9.2, min: 35, fare: 267, method: "upi", outcome: "pending", daysAgo: 1 },
        { from: "ghatkopar", to: "bkc", km: 8.1, min: 30, fare: 240, method: "cash", outcome: "cancelled", daysAgo: 2 }
    ];

    for (const trip of trips) {
        const from = SPOTS[trip.from];
        const to = SPOTS[trip.to];
        const ago = `-${trip.daysAgo} days`;
        const cancelled = trip.outcome === "cancelled";
        const rideId = Number(
            db
                .get()
                .prepare(
                    `INSERT INTO rides (rider_id, driver_id, pickup_name, pickup_lat, pickup_lng, drop_name, drop_lat, drop_lng,
                                        vehicle_type, distance_km, duration_min, fare, otp, status, route_geometry,
                                        payment_method, payment_status, cancelled_by, cancel_reason,
                                        requested_at, accepted_at, arrived_at, started_at, completed_at, cancelled_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'car', ?, ?, ?, '0000', ?, ?, ?, ?, ?, ?,
                             datetime('now', ?, '-40 minutes'), datetime('now', ?, '-38 minutes'),
                             CASE WHEN ? THEN NULL ELSE datetime('now', ?, '-32 minutes') END,
                             CASE WHEN ? THEN NULL ELSE datetime('now', ?, '-30 minutes') END,
                             CASE WHEN ? THEN NULL ELSE datetime('now', ?) END,
                             CASE WHEN ? THEN datetime('now', ?, '-35 minutes') END)`
                )
                .run(
                    rider.id,
                    driver.id,
                    from.name,
                    from.lat,
                    from.lng,
                    to.name,
                    to.lat,
                    to.lng,
                    trip.km,
                    trip.min,
                    trip.fare,
                    cancelled ? "cancelled" : "completed",
                    JSON.stringify([
                        [from.lat, from.lng],
                        [to.lat, to.lng]
                    ]),
                    trip.method,
                    cancelled ? "unpaid" : trip.outcome,
                    cancelled ? "rider" : null,
                    cancelled ? "Plans changed" : null,
                    ago,
                    ago,
                    cancelled ? 1 : 0,
                    ago,
                    cancelled ? 1 : 0,
                    ago,
                    cancelled ? 1 : 0,
                    ago,
                    cancelled ? 1 : 0,
                    ago
                ).lastInsertRowid
        );

        for (const userId of [rider.id, driver.id])
            activity(userId, "ride.requested", rideId, { fare: trip.fare, paymentMethod: trip.method }, trip.daysAgo);
        if (cancelled) {
            for (const userId of [rider.id, driver.id])
                activity(userId, "ride.cancelled", rideId, { cancelledBy: "rider", reason: "Plans changed" }, trip.daysAgo);
            continue;
        }
        for (const userId of [rider.id, driver.id]) activity(userId, "ride.completed", rideId, { fare: trip.fare }, trip.daysAgo);
        // Both sides rated the paid trips, so ratings show up from the start.
        if (trip.outcome === "paid") {
            const rate = db.get().prepare("INSERT INTO ride_ratings (ride_id, rater_id, ratee_id, stars, tags) VALUES (?, ?, ?, ?, ?)");
            rate.run(rideId, rider.id, driver.id, trip.daysAgo > 4 ? 5 : 4, JSON.stringify(["Safe driving", "Polite"]));
            rate.run(rideId, driver.id, rider.id, 5, JSON.stringify(["On time"]));
        }

        const status = trip.outcome === "paid" ? "succeeded" : "pending";
        const paymentId = Number(
            db
                .get()
                .prepare(
                    `INSERT INTO payments (ride_id, rider_id, driver_id, amount, currency, method, status, provider, created_at, updated_at, paid_at)
                     VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, datetime('now', ?), datetime('now', ?), CASE WHEN ? = 'succeeded' THEN datetime('now', ?) END)`
                )
                .run(
                    rideId,
                    rider.id,
                    driver.id,
                    trip.fare,
                    trip.method,
                    status,
                    trip.method === "cash" ? "cash" : "mock",
                    ago,
                    ago,
                    status,
                    ago
                ).lastInsertRowid
        );
        for (const userId of [rider.id, driver.id]) {
            activity(userId, `payment.${status}`, rideId, { paymentId, amount: trip.fare, method: trip.method }, trip.daysAgo);
        }
    }
    return trips.length;
}

const rider = ensureUser({ email: "rider@example.test", name: "Asha Rider", phone: "+919800000001", role: "rider" });

const driver = ensureUser({ email: "driver@example.test", name: "Ravi Driver", phone: "+919800000002", role: "driver" });
ensureDriver(
    driver,
    { license: "MH0220190012345", type: "car", make: "Maruti Suzuki", model: "Dzire", plate: "MH 02 AB 1234", color: "White", year: 2021 },
    "approved",
    SPOTS.ghatkopar
);

const pending = ensureUser({ email: "pending.driver@example.test", name: "Priya Pending", phone: "+919800000003", role: "driver" });
ensureDriver(
    pending,
    { license: "MH0320210054321", type: "auto", make: "Bajaj", model: "RE Compact", plate: "MH 03 CD 5678", color: "Green", year: 2022 },
    "pending",
    SPOTS.vidyavihar
);

const trips = seedHistory(rider, driver);
if (!savedPlaces.list(rider.id).length) {
    savedPlaces.save(rider.id, { label: "Home", ...SPOTS.ghatkopar });
    savedPlaces.save(rider.id, { label: "Work", ...SPOTS.bkc });
}

console.log(`
Seeded demo data:
  Rider              rider@example.test${trips ? `   (${trips} past rides with payments)` : ""}
  Driver (approved)  driver@example.test   (car, near Ghatkopar)
  Driver (pending)   pending.driver@example.test
  Admin              admin@example.test   (admin role, admin app only)
Sign in with "Dev sign-in" and pick one of these accounts. With Auth0 configured, sign in with
the users you created in your Auth0 tenant instead (see docs/auth0-setup.md).
`);
