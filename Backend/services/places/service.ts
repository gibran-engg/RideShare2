import config from "../../lib/config.ts";
import { AppError } from "../../lib/errors.ts";
import type { Point, VehicleType } from "../../lib/types.ts";
import * as ola from "./ola.ts";

/**
 * Ola Maps is tried first for search, addresses and routes (see ola.ts). When it isn't configured
 * or fails, these OpenStreetMap services are used instead:
 *   - Nominatim for place search and reverse geocoding
 *   - OSRM for driving routes (distance, duration, geometry)
 * Both public servers ask for a descriptive User-Agent, light use and caching.
 */

export interface Place extends Point {
    name: string;
    area: string;
    address: string;
    distanceKm?: number;
}

export interface Route {
    distanceKm: number;
    durationMin: number;
    geometry: [number, number][];
    source: "ola" | "osrm" | "estimate";
}

interface NominatimPlace {
    name?: string;
    display_name: string;
    lat: string;
    lon: string;
    error?: string;
    address?: Record<string, string>;
}

const EARTH_RADIUS_KM = 6371;
// Straight-line distance understates real roads; used only when OSRM is unreachable.
const ROAD_FACTOR = 1.35;
export const AVERAGE_SPEED_KMH: Record<VehicleType, number> = { bike: 26, auto: 22, car: 24 };
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { value: unknown; expires: number }>();

function toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

export function haversineKm(a: Point, b: Point): number {
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function isPoint(point: unknown): point is Point {
    const p = point as Point | null | undefined;
    return Boolean(p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180);
}

async function fetchJson<T>(url: URL): Promise<T> {
    const key = url.href;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;

    const response = await fetch(url, {
        headers: { "User-Agent": config.geo.userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error(`${url.host} responded ${response.status}`);
    const value = (await response.json()) as T;

    cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return value;
}

// Nominatim's usage policy allows at most one request per second.
let lastNominatim: Promise<unknown> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = lastNominatim.then(fn);
    lastNominatim = run.catch(() => {}).then(() => new Promise((resolve) => setTimeout(resolve, 1000)));
    return run;
}

function shortName(place: NominatimPlace): { name: string; area: string } {
    const a = place.address || {};
    const first = place.name || a.road || a.neighbourhood || a.suburb || place.display_name.split(",")[0]!;
    const area = a.suburb || a.neighbourhood || a.city_district || a.city || a.town || "";
    return { name: first, area: area && area !== first ? area : "" };
}

/** Centre of the service area (GEO_VIEWBOX), used to bias search when the user's position is unknown. */
function serviceAreaCentre(): Point {
    const [lng1, lat1, lng2, lat2] = config.geo.viewbox.split(",").map(Number);
    return { lat: (lat1! + lat2!) / 2, lng: (lng1! + lng2!) / 2 };
}

/** Place search, biased to the service area, nearest first when `near` is given. */
export async function search(query: unknown, near?: Point | null): Promise<Place[]> {
    const q = String(query || "").trim();
    if (q.length < 2) return [];

    if (ola.enabled()) {
        try {
            const places = await ola.search(q, isPoint(near) ? near : serviceAreaCentre());
            if (places.length) return places;
        } catch (err) {
            console.error("Ola Maps search failed, using OpenStreetMap:", (err as Error).message);
        }
    }

    const url = new URL("/search", config.geo.nominatimUrl);
    url.search = new URLSearchParams({
        q,
        format: "jsonv2",
        addressdetails: "1",
        limit: "8",
        countrycodes: config.geo.countryCodes,
        viewbox: config.geo.viewbox
    }).toString();

    let results: NominatimPlace[];
    try {
        results = await throttled(() => fetchJson<NominatimPlace[]>(url));
    } catch (err) {
        console.error("Place search failed:", (err as Error).message);
        throw new AppError("SERVICE_UNAVAILABLE", "Place search is unavailable right now. Try dropping a pin on the map instead.");
    }

    return results
        .map((place): Place => ({ ...shortName(place), address: place.display_name, lat: Number(place.lat), lng: Number(place.lon) }))
        .map((place) => (isPoint(near) ? { ...place, distanceKm: Math.round(haversineKm(near, place) * 10) / 10 } : place))
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
}

/** Name for a dropped pin. Falls back to coordinates if Nominatim is unavailable. */
export async function reverse(point: Point): Promise<Place> {
    if (!isPoint(point)) throw new AppError("VALIDATION_FAILED", "Invalid location.");
    const fallback: Place = {
        name: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
        area: "",
        address: "",
        lat: point.lat,
        lng: point.lng
    };

    if (ola.enabled()) {
        try {
            return await ola.reverse(point);
        } catch (err) {
            console.error("Ola Maps reverse geocoding failed, using OpenStreetMap:", (err as Error).message);
        }
    }

    const url = new URL("/reverse", config.geo.nominatimUrl);
    // Round so nearby pins share a cache entry.
    url.search = new URLSearchParams({
        lat: point.lat.toFixed(5),
        lon: point.lng.toFixed(5),
        format: "jsonv2",
        addressdetails: "1",
        zoom: "18"
    }).toString();

    try {
        const place = await throttled(() => fetchJson<NominatimPlace>(url));
        if (!place || place.error) return fallback;
        return { ...shortName(place), address: place.display_name, lat: point.lat, lng: point.lng };
    } catch (err) {
        console.error("Reverse geocoding failed:", (err as Error).message);
        return fallback;
    }
}

function estimateWithoutRoads(from: Point, to: Point, vehicleType: VehicleType): Route {
    const distanceKm = Math.max(0.5, haversineKm(from, to) * ROAD_FACTOR);
    const speed = AVERAGE_SPEED_KMH[vehicleType] || AVERAGE_SPEED_KMH.car;
    return {
        distanceKm: Math.round(distanceKm * 10) / 10,
        durationMin: Math.max(3, Math.round((distanceKm / speed) * 60)),
        geometry: [
            [from.lat, from.lng],
            [to.lat, to.lng]
        ],
        source: "estimate"
    };
}

interface OsrmResponse {
    code: string;
    routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
}

/**
 * Driving route between two points: Ola Maps, then OSRM, then a straight-line estimate if both are down.
 */
export async function route(from: Point, to: Point, vehicleType: VehicleType = "car"): Promise<Route> {
    if (!isPoint(from) || !isPoint(to)) throw new AppError("VALIDATION_FAILED", "Pickup and drop need valid coordinates.");
    // Ola and OSRM both model cars; two-wheelers and autos get a duration adjusted for their typical city speed.
    const speedRatio = AVERAGE_SPEED_KMH.car / (AVERAGE_SPEED_KMH[vehicleType] || AVERAGE_SPEED_KMH.car);

    if (ola.enabled()) {
        try {
            const best = await ola.route(from, to);
            // Ola's durations already include traffic, so no traffic factor here.
            return { ...best, durationMin: Math.max(2, Math.round(best.durationMin * speedRatio)), source: "ola" };
        } catch (err) {
            console.error("Ola Maps routing failed, using OpenStreetMap:", (err as Error).message);
        }
    }

    const url = new URL(
        `/route/v1/driving/${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`,
        config.geo.osrmUrl
    );
    url.search = "overview=simplified&geometries=geojson";

    try {
        const data = await fetchJson<OsrmResponse>(url);
        const best = data.routes && data.routes[0];
        if (data.code !== "Ok" || !best) throw new Error(data.code || "no route");

        const distanceKm = best.distance / 1000;
        return {
            distanceKm: Math.max(0.1, Math.round(distanceKm * 10) / 10),
            durationMin: Math.max(2, Math.round((best.duration / 60) * speedRatio * config.geo.trafficFactor)),
            geometry: best.geometry.coordinates.map(([lng, lat]): [number, number] => [lat, lng]),
            source: "osrm"
        };
    } catch (err) {
        console.error("Routing failed, using straight-line estimate:", (err as Error).message);
        return estimateWithoutRoads(from, to, vehicleType);
    }
}
