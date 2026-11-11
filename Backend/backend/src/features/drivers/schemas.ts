import { z } from "zod";
import type { DriverRow } from "../../../../lib/types.ts";
import { registry } from "../../core/openapi.ts";
import { VehicleType } from "../../core/schemas.ts";

export const Driver = registry.register(
    "Driver",
    z.object({
        verificationStatus: z.enum(["pending", "approved", "rejected"]),
        rejectionReason: z.string().nullable(),
        licenseNumber: z.string(),
        vehicle: z.object({ type: VehicleType, make: z.string(), model: z.string(), plate: z.string(), color: z.string().nullable() }),
        isOnline: z.boolean(),
        location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
        submittedAt: z.string()
    })
);

const Bucket = z.object({ trips: z.number(), amount: z.number() });
export const Earnings = registry.register("Earnings", z.object({ today: Bucket, week: Bucket, total: Bucket }));

export const DriverBody = z.object({
    licenseNumber: z
        .string({ message: "Enter your driving licence number as printed (8-20 letters/digits)." })
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9 -]{8,20}$/, "Enter your driving licence number as printed (8-20 letters/digits)."),
    vehicleType: z.enum(["bike", "auto", "car"], { message: "Choose your vehicle type." }),
    vehicleMake: z
        .string({ message: "Enter the vehicle make, e.g. Maruti." })
        .trim()
        .min(2, "Enter the vehicle make, e.g. Maruti.")
        .max(40),
    vehicleModel: z
        .string({ message: "Enter the vehicle model, e.g. Swift." })
        .trim()
        .min(1, "Enter the vehicle model, e.g. Swift.")
        .max(40),
    vehiclePlate: z
        .string({ message: "Enter the registration number, e.g. MH 02 AB 1234." })
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9 -]{6,13}$/, "Enter the registration number, e.g. MH 02 AB 1234."),
    vehicleColor: z.string().trim().max(30).optional(),
    licenseDoc: z
        .any()
        .optional()
        .openapi({ type: "string", format: "binary", description: "Driving licence photo (JPG/PNG) or PDF, max 8 MB" }),
    rcDoc: z.any().optional().openapi({ type: "string", format: "binary", description: "Vehicle RC photo or PDF, max 8 MB" })
});

export function toDriver(row: DriverRow | null) {
    if (!row) return null;
    return {
        verificationStatus: row.verification_status,
        rejectionReason: row.rejection_reason,
        licenseNumber: row.license_number,
        vehicle: {
            type: row.vehicle_type,
            make: row.vehicle_make,
            model: row.vehicle_model,
            plate: row.vehicle_plate,
            color: row.vehicle_color
        },
        isOnline: Boolean(row.is_online),
        location: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null,
        submittedAt: row.submitted_at
    };
}
