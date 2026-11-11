import * as db from "../../db/index.ts";
import type { Page, PageQuery, PaymentMethod, PaymentRow, PaymentStatus } from "../../lib/types.ts";
import { pageLimit, toPage } from "../../lib/pagination.ts";

const SELECT_PAYMENT = `
    SELECT p.*, rider.name AS rider_name, driver.name AS driver_name, r.pickup_name, r.drop_name
    FROM payments p
    JOIN rides r ON r.id = p.ride_id
    JOIN users rider ON rider.id = p.rider_id
    LEFT JOIN users driver ON driver.id = p.driver_id`;

export function get(id: number): PaymentRow | null {
    return (db.get().prepare(`${SELECT_PAYMENT} WHERE p.id = ?`).get(id) as PaymentRow | undefined) ?? null;
}

export function forRide(rideId: number): PaymentRow | null {
    return (db.get().prepare(`${SELECT_PAYMENT} WHERE p.ride_id = ?`).get(rideId) as PaymentRow | undefined) ?? null;
}

export function byProviderRef(ref: string): PaymentRow | null {
    return (db.get().prepare(`${SELECT_PAYMENT} WHERE p.provider_ref = ?`).get(ref) as PaymentRow | undefined) ?? null;
}

export interface NewPayment {
    rideId: number;
    riderId: number;
    driverId: number | null;
    amount: number;
    currency: string;
    method: PaymentMethod;
    status: PaymentStatus;
    provider: string;
}

export function insert(payment: NewPayment): number {
    return Number(
        db
            .get()
            .prepare(
                `INSERT INTO payments (ride_id, rider_id, driver_id, amount, currency, method, status, provider, paid_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'succeeded' THEN datetime('now') END)`
            )
            .run(
                payment.rideId,
                payment.riderId,
                payment.driverId,
                payment.amount,
                payment.currency,
                payment.method,
                payment.status,
                payment.provider,
                payment.status
            ).lastInsertRowid
    );
}

export function setProviderRef(id: number, ref: string, method: PaymentMethod): void {
    db.get()
        .prepare(
            "UPDATE payments SET provider_ref = ?, method = ?, status = 'pending', failure_reason = NULL, updated_at = datetime('now') WHERE id = ?"
        )
        .run(ref, method, id);
}

/** Change status only if it is currently one of `from` (guards against out-of-order callbacks). */
export function updateStatus(id: number, from: PaymentStatus[], to: PaymentStatus, failureReason: string | null = null): boolean {
    const stamp = to === "succeeded" ? ", paid_at = datetime('now')" : to === "refunded" ? ", refunded_at = datetime('now')" : "";
    return (
        db
            .get()
            .prepare(
                `UPDATE payments SET status = ?, failure_reason = ?, updated_at = datetime('now')${stamp}
                 WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`
            )
            .run(to, failureReason, id, ...from).changes > 0
    );
}

export function listFor(column: "rider_id" | "driver_id" | null, userId: number | null, page: PageQuery = {}): Page<PaymentRow> {
    const limit = pageLimit(page);
    const where = column ? `p.${column} = ?` : "? IS NULL";
    const rows = db
        .get()
        .prepare(`${SELECT_PAYMENT} WHERE ${where} AND (? IS NULL OR p.id < ?) ORDER BY p.id DESC LIMIT ?`)
        .all(userId, page.cursor ?? null, page.cursor ?? null, limit + 1) as unknown as PaymentRow[];
    return toPage(rows, limit);
}
