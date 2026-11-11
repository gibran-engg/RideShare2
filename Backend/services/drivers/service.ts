import { AppError } from "../../lib/errors.ts";
import { bus } from "../../lib/events.ts";
import * as repo from "./repository.ts";
import type { DriverSubmission } from "./repository.ts";
import type { DriverRow, Point, VerificationStatus } from "../../lib/types.ts";
import * as audit from "../../lib/audit.ts";
import * as geo from "../places/service.ts";
import * as sms from "../../lib/sms.ts";

export type { DriverSubmission };
export const get = repo.get;
export const list = repo.list;

/** Create or resubmit a driver's licence, vehicle and documents for verification. */
export function submit(userId: number, data: DriverSubmission, docs: { licenseDoc?: string | null; rcDoc?: string | null }): DriverRow {
    const existing = repo.get(userId);
    if (existing && existing.verification_status === "approved") {
        throw new AppError("CONFLICT", "Your driver profile is already approved.");
    }
    const licenseDoc = docs.licenseDoc || existing?.license_doc;
    const rcDoc = docs.rcDoc || existing?.rc_doc;
    if (!licenseDoc || !rcDoc) {
        throw new AppError("VALIDATION_FAILED", "Please upload both your driving licence and vehicle RC.");
    }

    repo.upsert(userId, data, licenseDoc, rcDoc);
    audit.log(userId, "driver.submit", "driver", userId);
    bus.emit("driver.submitted", { userId });
    return repo.get(userId)!;
}

export function requireApproved(userId: number): DriverRow {
    const driver = repo.get(userId);
    if (!driver || driver.verification_status !== "approved") {
        throw new AppError("DRIVER_NOT_APPROVED", "Your driver profile isn't approved yet.");
    }
    return driver;
}

/** Latest GPS position reported by the driver's phone or browser. */
export function setLocation(userId: number, point: Point): void {
    requireApproved(userId);
    if (!geo.isPoint(point)) throw new AppError("VALIDATION_FAILED", "Invalid location.");
    repo.setLocation(userId, point.lat, point.lng);
    bus.emit("driver.location_updated", { userId });
}

export function setOnline(userId: number, online: boolean): DriverRow {
    const driver = requireApproved(userId);
    if (online && driver.lat == null) {
        throw new AppError("BAD_REQUEST", "Turn on location so riders can find you before going online.");
    }
    repo.setOnline(userId, online);
    if (Boolean(driver.is_online) !== online) bus.emit("driver.online_changed", { userId, online });
    return repo.get(userId)!;
}

export function review(driverId: number, adminId: number, decision: VerificationStatus, reason: string | null = null): void {
    const driver = repo.get(driverId);
    if (!driver) throw new AppError("NOT_FOUND", "Driver not found.");
    if (decision !== "approved" && decision !== "rejected") throw new AppError("BAD_REQUEST", "Unknown decision.");
    if (decision === "rejected" && !reason) throw new AppError("VALIDATION_FAILED", "Please give a reason for rejecting.");

    const savedReason = decision === "rejected" ? reason : null;
    repo.review(driverId, decision, savedReason, adminId);

    sms.send({
        userId: driverId,
        phone: driver.phone,
        message:
            decision === "approved"
                ? "Your RideShare driver profile is approved. Go online to start receiving rides!"
                : `Your RideShare driver profile needs changes: ${reason}`
    });
    audit.log(adminId, `driver.${decision === "approved" ? "approve" : "reject"}`, "driver", driverId, { reason });
    bus.emit("driver.reviewed", { userId: driverId, decision, reason: savedReason, actorId: adminId });
}
