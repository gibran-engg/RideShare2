import type { SQLInputValue } from "node:sqlite";
import * as db from "../../db/index.ts";
import { ACTIVE_STATUSES, STATUS_TIMESTAMP } from "./state.ts";
import type { NamedPoint, Page, PageQuery, PaymentMethod, RidePaymentStatus, RideRow, RideStatus, VehicleType } from "../../lib/types.ts";
import { pageLimit, toPage } from "../../lib/pagination.ts";

const ACTIVE_SQL = ACTIVE_STATUSES.map((status) => `'${status}'`).join(", ");

const SELECT_RIDE = `
    SELECT r.*,
           rider.name AS rider_name, rider.phone AS rider_phone,
           driver.name AS driver_name, driver.phone AS driver_phone,
           d.vehicle_make, d.vehicle_model, d.vehicle_plate, d.vehicle_color,
           d.lat AS driver_lat, d.lng AS driver_lng
    FROM rides r
    JOIN users rider ON rider.id = r.rider_id
    LEFT JOIN users driver ON driver.id = r.driver_id
    LEFT JOIN drivers d ON d.user_id = r.driver_id`;

// Columns a transition may set besides status/timestamps (never user-controlled names).
type RideColumn = "driver_id" | "accepted_at" | "arrived_at" | "cancelled_by" | "cancel_reason" | "payment_status";

export function get(id: number): RideRow | null {
    return (db.get().prepare(`${SELECT_RIDE} WHERE r.id = ?`).get(id) as RideRow | undefined) ?? null;
}

export function activeFor(column: "rider_id" | "driver_id", userId: number): RideRow | null {
    return (
        (db.get().prepare(`${SELECT_RIDE} WHERE r.${column} = ? AND r.status IN (${ACTIVE_SQL}) ORDER BY r.id DESC LIMIT 1`).get(userId) as
            RideRow | undefined) ?? null
    );
}

export interface NewRide {
    riderId: number;
    pickup: NamedPoint;
    drop: NamedPoint;
    vehicleType: VehicleType;
    distanceKm: number;
    durationMin: number;
    fare: number;
    otp: string;
    routeGeometry: [number, number][];
    paymentMethod: PaymentMethod;
}

export function insert(ride: NewRide): number {
    return Number(
        db
            .get()
            .prepare(
                `INSERT INTO rides (rider_id, pickup_name, pickup_lat, pickup_lng, drop_name, drop_lat, drop_lng,
                                    vehicle_type, distance_km, duration_min, fare, otp, route_geometry, payment_method)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                ride.riderId,
                ride.pickup.name,
                ride.pickup.lat,
                ride.pickup.lng,
                ride.drop.name,
                ride.drop.lat,
                ride.drop.lng,
                ride.vehicleType,
                ride.distanceKm,
                ride.durationMin,
                ride.fare,
                ride.otp,
                JSON.stringify(ride.routeGeometry),
                ride.paymentMethod
            ).lastInsertRowid
    );
}

/**
 * Move a ride to `to`, but only if nobody changed it since it was read at `version`
 * (optimistic locking). Returns false when another request won the race.
 */
export function transition(id: number, version: number, to: RideStatus, set: Partial<Record<RideColumn, SQLInputValue>> = {}): boolean {
    const assignments = ["status = ?", "version = version + 1"];
    const values: SQLInputValue[] = [to];
    const timestamp = STATUS_TIMESTAMP[to];
    if (timestamp) assignments.push(`${timestamp} = datetime('now')`);
    for (const [column, value] of Object.entries(set)) {
        assignments.push(`${column} = ?`);
        values.push(value as SQLInputValue);
    }
    const result = db
        .get()
        .prepare(`UPDATE rides SET ${assignments.join(", ")} WHERE id = ? AND version = ?`)
        .run(...values, id, version);
    return result.changes > 0;
}

export function setPaymentStatus(id: number, status: RidePaymentStatus): void {
    db.get().prepare("UPDATE rides SET payment_status = ?, version = version + 1 WHERE id = ?").run(status, id);
}

export function requestedOfType(vehicleType: VehicleType): RideRow[] {
    return db
        .get()
        .prepare(`${SELECT_RIDE} WHERE r.status = 'requested' AND r.vehicle_type = ? ORDER BY r.id`)
        .all(vehicleType) as unknown as RideRow[];
}

/** Rides a rider took or trips a driver made, newest first. */
export function historyFor(column: "rider_id" | "driver_id", userId: number, page: PageQuery = {}): Page<RideRow> {
    const limit = pageLimit(page);
    const rows = db
        .get()
        .prepare(`${SELECT_RIDE} WHERE r.${column} = ? AND (? IS NULL OR r.id < ?) ORDER BY r.id DESC LIMIT ?`)
        .all(userId, page.cursor ?? null, page.cursor ?? null, limit + 1) as unknown as RideRow[];
    return toPage(rows, limit);
}

export function list({ status = "", ...page }: { status?: RideStatus | "" } & PageQuery = {}): Page<RideRow> {
    const limit = pageLimit({ limit: 100, ...page });
    const rows = db
        .get()
        .prepare(`${SELECT_RIDE} WHERE (? = '' OR r.status = ?) AND (? IS NULL OR r.id < ?) ORDER BY r.id DESC LIMIT ?`)
        .all(status, status, page.cursor ?? null, page.cursor ?? null, limit + 1) as unknown as RideRow[];
    return toPage(rows, limit);
}

export interface EarningsBucket {
    trips: number;
    amount: number;
}

export function earnings(driverId: number): { today: EarningsBucket; week: EarningsBucket; total: EarningsBucket } {
    const conn = db.get();
    const sum = (where: string) =>
        conn
            .prepare(
                `SELECT COUNT(*) AS trips, COALESCE(SUM(fare), 0) AS amount FROM rides
                 WHERE driver_id = ? AND status = 'completed' ${where}`
            )
            .get(driverId) as unknown as EarningsBucket;
    return {
        today: sum("AND date(completed_at) = date('now')"),
        week: sum("AND completed_at >= datetime('now', '-7 days')"),
        total: sum("")
    };
}

/** Rider totals for the admin user page. */
export function riderSummary(riderId: number): { rides: number; completed: number; cancelled: number; spent: number } {
    return db
        .get()
        .prepare(
            `SELECT COUNT(*) AS rides,
                    COALESCE(SUM(status = 'completed'), 0) AS completed,
                    COALESCE(SUM(status = 'cancelled'), 0) AS cancelled,
                    COALESCE(SUM(CASE WHEN status = 'completed' THEN fare END), 0) AS spent
             FROM rides WHERE rider_id = ?`
        )
        .get(riderId) as unknown as { rides: number; completed: number; cancelled: number; spent: number };
}

/** Cheap summary of a user's rides; changes whenever any of them changes. */
export function versionSum(userId: number): { n: number; v: number } {
    return db
        .get()
        .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(version), 0) AS v FROM rides WHERE rider_id = ? OR driver_id = ?")
        .get(userId, userId) as unknown as { n: number; v: number };
}

export function stats(): Record<string, number> {
    const conn = db.get();
    const one = (sql: string) => Number(Object.values(conn.prepare(sql).get() as Record<string, number>)[0]);
    return {
        users: one("SELECT COUNT(*) FROM users"),
        riders: one("SELECT COUNT(*) FROM users WHERE role = 'rider'"),
        drivers: one("SELECT COUNT(*) FROM drivers WHERE verification_status = 'approved'"),
        pendingDrivers: one("SELECT COUNT(*) FROM drivers WHERE verification_status = 'pending'"),
        onlineDrivers: one("SELECT COUNT(*) FROM drivers WHERE is_online = 1"),
        activeRides: one(`SELECT COUNT(*) FROM rides WHERE status IN (${ACTIVE_SQL})`),
        ridesToday: one("SELECT COUNT(*) FROM rides WHERE date(requested_at) = date('now')"),
        completedRides: one("SELECT COUNT(*) FROM rides WHERE status = 'completed'"),
        fares: one("SELECT COALESCE(SUM(fare), 0) FROM rides WHERE status = 'completed'"),
        paymentsReceived: one("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'succeeded'"),
        paymentsPending: one("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status IN ('pending', 'failed')"),
        cashCollected: one("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'succeeded' AND method = 'cash'"),
        refunded: one("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'refunded'")
    };
}
