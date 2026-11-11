import { z } from "zod";
import type { UserRow } from "../../../../lib/types.ts";
import { registry } from "../../core/openapi.ts";
import { Driver } from "../drivers/schemas.ts";

export const User = registry.register(
    "User",
    z.object({
        id: z.number(),
        email: z.string(),
        name: z.string().nullable(),
        picture: z.string().nullable(),
        role: z.enum(["rider", "driver"]).nullable(),
        phone: z.string().nullable(),
        phoneVerified: z.boolean(),
        createdAt: z.string()
    })
);

export const Me = z.object({
    user: User,
    driver: Driver.nullable(),
    next: z.enum(["profile", "verify", "driver", "pending", "rejected", "ready"]),
    devSms: z.string().nullable().optional().openapi({ description: "Development only: the last SMS sent, so the OTP can be read" })
});

export const ProfileBody = z.object({
    name: z.string({ message: "Please enter your full name." }).trim().min(2, "Please enter your full name.").max(80),
    phone: z
        .string({ message: "Enter a valid mobile number, e.g. 98765 43210." })
        .transform((value) => value.replace(/[\s()-]/g, ""))
        .transform((value) => (/^\d{10}$/.test(value) ? `+91${value}` : value))
        .refine((value) => /^\+\d{10,15}$/.test(value), "Enter a valid mobile number, e.g. 98765 43210."),
    role: z.enum(["rider", "driver"], { message: "Choose whether you want to ride or drive." })
});

export function toUser(row: UserRow | null) {
    if (!row) return null;
    return {
        id: row.id,
        email: row.email,
        name: row.name,
        picture: row.picture,
        role: row.role,
        phone: row.phone,
        phoneVerified: Boolean(row.phone_verified),
        createdAt: row.created_at
    };
}
