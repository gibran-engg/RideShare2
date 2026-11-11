import { z } from "zod";
import type { Page } from "../../../lib/types.ts";
import "./openapi.ts";

/** Request pieces and response helpers used by several features. */

export const IdParams = z.object({ id: z.coerce.number().int().positive().openapi({ example: 42 }) });

export const PageQuery = z.object({
    cursor: z.coerce.number().int().positive().optional().openapi({ description: "nextCursor from the previous page" }),
    limit: z.coerce.number().int().min(1).max(100).optional().openapi({ example: 20 })
});

const finite = (label: string) =>
    z.coerce.number({ message: `${label} must be a number.` }).refine(Number.isFinite, `${label} must be a number.`);

export const LatLng = z.object({
    lat: finite("lat").refine((v) => Math.abs(v) <= 90, "lat must be between -90 and 90."),
    lng: finite("lng").refine((v) => Math.abs(v) <= 180, "lng must be between -180 and 180.")
});

export const VehicleType = z.enum(["bike", "auto", "car"]);
export const PaymentMethod = z.enum(["cash", "card", "upi"]);
export const Ok = z.object({ ok: z.literal(true) });

/** Response schema for a cursor-paginated list. */
export function page<T extends z.ZodType>(item: T) {
    return z.object({ items: z.array(item), nextCursor: z.number().nullable() });
}

/** Maps a repository page to its JSON form. */
export function toPage<T, R>(result: Page<T>, map: (item: T) => R) {
    return { items: result.items.map(map), nextCursor: result.nextCursor };
}
