import { z } from "zod";
import * as geo from "../../../../services/places/service.ts";
import { createModule } from "../../core/route.ts";
import { LatLng } from "../../core/schemas.ts";
import { Place, SearchQuery } from "./schemas.ts";

/** Place search and reverse geocoding (OpenStreetMap / Nominatim). */
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

export default router;
