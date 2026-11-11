import * as db from "../../db/index.ts";
import type { DriverRow, VehicleType, VerificationStatus } from "../../lib/types.ts";

const SELECT_DRIVER = `
    SELECT d.*, u.name, u.email, u.phone, u.picture, u.status AS user_status,
           r.name AS reviewer_name
    FROM drivers d
    JOIN users u ON u.id = d.user_id
    LEFT JOIN users r ON r.id = d.reviewed_by`;

export interface DriverSubmission {
    licenseNumber: string;
    vehicleType: VehicleType;
    vehicleMake: string;
    vehicleModel: string;
    vehiclePlate: string;
    vehicleColor?: string | null;
    vehicleYear: number;
    /** YYYY-MM-DD */
    licenseExpiry: string;
    /** YYYY-MM-DD */
    insuranceExpiry: string;
}

export interface DriverDocuments {
    licenseDoc: string;
    rcDoc: string;
    insuranceDoc: string;
}

export function get(userId: number): DriverRow | null {
    return (db.get().prepare(`${SELECT_DRIVER} WHERE d.user_id = ?`).get(userId) as DriverRow | undefined) ?? null;
}

/** Insert, or resubmit (which resets verification to pending). */
export function upsert(userId: number, data: DriverSubmission, docs: DriverDocuments): void {
    db.get()
        .prepare(
            `INSERT INTO drivers (user_id, license_number, vehicle_type, vehicle_make, vehicle_model,
                                  vehicle_plate, vehicle_color, vehicle_year, license_expiry, insurance_expiry,
                                  license_doc, rc_doc, insurance_doc)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
                license_number = excluded.license_number, vehicle_type = excluded.vehicle_type,
                vehicle_make = excluded.vehicle_make, vehicle_model = excluded.vehicle_model,
                vehicle_plate = excluded.vehicle_plate, vehicle_color = excluded.vehicle_color,
                vehicle_year = excluded.vehicle_year, license_expiry = excluded.license_expiry,
                insurance_expiry = excluded.insurance_expiry,
                license_doc = excluded.license_doc, rc_doc = excluded.rc_doc, insurance_doc = excluded.insurance_doc,
                verification_status = 'pending', rejection_reason = NULL,
                reviewed_by = NULL, reviewed_at = NULL, submitted_at = datetime('now')`
        )
        .run(
            userId,
            data.licenseNumber,
            data.vehicleType,
            data.vehicleMake,
            data.vehicleModel,
            data.vehiclePlate,
            data.vehicleColor || null,
            data.vehicleYear,
            data.licenseExpiry,
            data.insuranceExpiry,
            docs.licenseDoc,
            docs.rcDoc,
            docs.insuranceDoc
        );
}

export function setLocation(userId: number, lat: number, lng: number): void {
    db.get().prepare("UPDATE drivers SET lat = ?, lng = ?, location_updated_at = datetime('now') WHERE user_id = ?").run(lat, lng, userId);
}

// Today's date and the start of today in India (UTC+5:30), as SQLite expressions.
const INDIA_TODAY = "date('now', '+330 minutes')";
const INDIA_DAY_START = `datetime(${INDIA_TODAY}, '-330 minutes')`;
const SECONDS_ONLINE_TODAY = `CASE WHEN online_day = ${INDIA_TODAY} THEN online_seconds_today ELSE 0 END
    + CASE WHEN is_online = 1 AND online_since IS NOT NULL
           THEN CAST(strftime('%s', 'now') - strftime('%s', max(online_since, ${INDIA_DAY_START})) AS INTEGER)
           ELSE 0 END`;

/**
 * Go online/offline and keep "hours online today": going offline adds the session (counted from
 * the start of today at the earliest) to today's total. SQLite reads the old row in every SET.
 */
export function setOnline(userId: number, online: boolean): void {
    const flag = online ? 1 : 0;
    db.get()
        .prepare(
            `UPDATE drivers SET
                online_seconds_today = CASE WHEN ? = 1 THEN
                        CASE WHEN online_day = ${INDIA_TODAY} THEN online_seconds_today ELSE 0 END
                    ELSE ${SECONDS_ONLINE_TODAY} END,
                online_day = ${INDIA_TODAY},
                online_since = CASE WHEN ? = 1 THEN COALESCE(CASE WHEN is_online = 1 THEN online_since END, datetime('now')) END,
                is_online = ?
             WHERE user_id = ?`
        )
        .run(flag, flag, flag, userId);
}

/** Seconds online today (India time), including the session in progress. */
export function secondsOnlineToday(userId: number): number {
    const row = db.get().prepare(`SELECT ${SECONDS_ONLINE_TODAY} AS seconds FROM drivers WHERE user_id = ?`).get(userId) as
        { seconds: number } | undefined;
    return Math.max(0, row?.seconds ?? 0);
}

/** Approved drivers who are online and have a known position. */
export function onlineWithLocation(): DriverRow[] {
    return db
        .get()
        .prepare(
            `${SELECT_DRIVER} WHERE d.is_online = 1 AND d.verification_status = 'approved' AND u.status = 'active'
                AND d.lat IS NOT NULL AND d.lng IS NOT NULL`
        )
        .all() as unknown as DriverRow[];
}

export function review(userId: number, decision: VerificationStatus, reason: string | null, adminId: number): void {
    db.get()
        .prepare(
            `UPDATE drivers SET verification_status = ?, rejection_reason = ?, reviewed_by = ?,
                    reviewed_at = datetime('now'), is_online = CASE WHEN ? = 'rejected' THEN 0 ELSE is_online END
             WHERE user_id = ?`
        )
        .run(decision, reason, adminId, decision, userId);
}

export function list(status: VerificationStatus | "" = ""): DriverRow[] {
    return db
        .get()
        .prepare(`${SELECT_DRIVER} WHERE (? = '' OR d.verification_status = ?) ORDER BY d.submitted_at DESC`)
        .all(status, status) as unknown as DriverRow[];
}
