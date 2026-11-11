import { z } from "zod";
import * as geo from "../../../../services/places/service.ts";
import * as drivers from "../../../../services/drivers/service.ts";
import { MATCH_RADIUS_KM } from "../../../../services/rides/service.ts";
import { createModule } from "../../core/route.ts";
import { LatLng } from "../../core/schemas.ts";
import { Place, SearchQuery } from "./schemas.ts";

/** Place search and reverse geocoding (Ola Maps, falling back to OpenStreetMap), and nearby cabs. */
const { router, add } = createModule();
const tags = ["Places"];

add(
    {
        method: "get",
        path: "/places/search",
        summary: "Search places (biased to the service area, nearest first)",
        tags,
        query: SearchQuery,
        response: z.object({ places: z.array(Place) }),
        errors: [503]
    },
    async ({ query }) => {
        const near = query.lat != null && query.lng != null ? { lat: query.lat, lng: query.lng } : null;
        return { places: await geo.search(query.q, near) };
    }
);

add(
    {
        method: "get",
        path: "/places/reverse",
        summary: "Name for a point on the map",
        tags,
        query: LatLng,
        response: z.object({ place: Place })
    },
    async ({ query }) => ({ place: await geo.reverse(query) })
);

add(
    {
        method: "get",
        path: "/places/nearby-drivers",
        summary: "Online cabs near a point (positions and vehicle types only)",
        tags,
        query: LatLng,
        response: z.object({
            drivers: z.array(
                z.object({ id: z.number(), vehicleType: z.string(), lat: z.number(), lng: z.number(), distanceKm: z.number() })
            )
        })
    },
    ({ query }) => ({
        // No names or plates here: anyone signed in can see roughly where cabs are, not who they are.
        drivers: drivers.onlineNear(query, Math.min(5, MATCH_RADIUS_KM)).map((driver, index) => ({
            id: index + 1,
            vehicleType: driver.vehicle_type,
            lat: Math.round(driver.lat! * 2000) / 2000,
            lng: Math.round(driver.lng! * 2000) / 2000,
            distanceKm: driver.distance_km
        }))
    })
);

export default router;
