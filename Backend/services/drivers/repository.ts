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
}

export function get(userId: number): DriverRow | null {
    return (db.get().prepare(`${SELECT_DRIVER} WHERE d.user_id = ?`).get(userId) as DriverRow | undefined) ?? null;
}

/** Insert, or resubmit (which resets verification to pending). */
export function upsert(userId: number, data: DriverSubmission, licenseDoc: string, rcDoc: string): void {
    db.get()
        .prepare(
            `INSERT INTO drivers (user_id, license_number, vehicle_type, vehicle_make, vehicle_model,
                                  vehicle_plate, vehicle_color, license_doc, rc_doc)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
                license_number = excluded.license_number, vehicle_type = excluded.vehicle_type,
                vehicle_make = excluded.vehicle_make, vehicle_model = excluded.vehicle_model,
                vehicle_plate = excluded.vehicle_plate, vehicle_color = excluded.vehicle_color,
                license_doc = excluded.license_doc, rc_doc = excluded.rc_doc,
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
            licenseDoc,
            rcDoc
        );
}

export function setLocation(userId: number, lat: number, lng: number): void {
    db.get().prepare("UPDATE drivers SET lat = ?, lng = ?, location_updated_at = datetime('now') WHERE user_id = ?").run(lat, lng, userId);
}

export function setOnline(userId: number, online: boolean): void {
    db.get()
        .prepare("UPDATE drivers SET is_online = ? WHERE user_id = ?")
        .run(online ? 1 : 0, userId);
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
