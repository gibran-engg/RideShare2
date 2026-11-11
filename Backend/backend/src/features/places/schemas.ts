import { z } from "zod";
import { registry } from "../../core/openapi.ts";
import { LatLng } from "../../core/schemas.ts";

export const Place = registry.register(
    "Place",
    z.object({
        name: z.string(),
        area: z.string(),
        address: z.string(),
        lat: z.number(),
        lng: z.number(),
        distanceKm: z.number().optional()
    })
);

export const SearchQuery = LatLng.partial().extend({ q: z.string().max(200).default("") });
