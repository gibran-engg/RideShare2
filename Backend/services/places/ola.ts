import crypto from "node:crypto";
import config from "../../lib/config.ts";
import type { Point } from "../../lib/types.ts";

/**
 * Ola Maps (https://maps.olakrutrim.com): place search, reverse geocoding and directions.
 * Better Indian addresses than OpenStreetMap, and its route durations already include traffic.
 * Every function throws when Ola is unavailable, so places/service.ts can fall back to OpenStreetMap.
 */

export function enabled(): boolean {
    return Boolean(config.geo.olaKey);
}

async function call<T>(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<T> {
    const url = new URL(path, config.geo.olaUrl);
    url.search = new URLSearchParams({ ...params, api_key: config.geo.olaKey }).toString();
    const response = await fetch(url, {
        method,
        headers: { "X-Request-Id": crypto.randomUUID(), Accept: "application/json" },
        signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error(`Ola Maps ${path} responded ${response.status}`);
    return (await response.json()) as T;
}

export interface OlaPlace extends Point {
    name: string;
    area: string;
    address: string;
    distanceKm?: number;
}

interface Prediction {
    description: string;
    structured_formatting?: { main_text?: string; secondary_text?: string };
    geometry?: { location?: { lat: number; lng: number } };
    distance_meters?: number;
}

export async function search(query: string, near: Point): Promise<OlaPlace[]> {
    const data = await call<{ predictions?: Prediction[] }>("/places/v1/autocomplete", {
        input: query,
        location: `${near.lat},${near.lng}`
    });
    return (data.predictions || [])
        .filter((p) => p.geometry?.location)
        .slice(0, 8)
        .map((p) => {
            const name = p.structured_formatting?.main_text || p.description.split(",")[0]!;
            const area = (p.structured_formatting?.secondary_text || "").split(",")[0]!.trim();
            return {
                name,
                area: area !== name ? area : "",
                address: p.description,
                lat: p.geometry!.location!.lat,
                lng: p.geometry!.location!.lng,
                ...(p.distance_meters != null ? { distanceKm: Math.round(p.distance_meters / 100) / 10 } : {})
            };
        });
}

interface ReverseResult {
    name?: string;
    formatted_address?: string;
    address_components?: { long_name: string; types: string[] }[];
}

export async function reverse(point: Point): Promise<OlaPlace> {
    const data = await call<{ results?: ReverseResult[] }>("/places/v1/reverse-geocode", { latlng: `${point.lat},${point.lng}` });
    const best = data.results?.[0];
    if (!best?.formatted_address) throw new Error("Ola Maps found no address here");
    const name = best.name || best.formatted_address.split(",")[0]!;
    const area = best.address_components?.find((c) => c.types.includes("sublocality") || c.types.includes("locality"))?.long_name || "";
    return { name, area: area !== name ? area : "", address: best.formatted_address, lat: point.lat, lng: point.lng };
}

/** Decodes a Google-style encoded polyline (precision 5) into [lat, lng] pairs. */
export function decodePolyline(encoded: string): [number, number][] {
    const points: [number, number][] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < encoded.length) {
        for (const axis of [0, 1]) {
            let result = 0;
            let shift = 0;
            let byte: number;
            do {
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20 && index < encoded.length);
            const delta = result & 1 ? ~(result >> 1) : result >> 1;
            if (axis === 0) lat += delta;
            else lng += delta;
        }
        points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
}

interface Directions {
    routes?: { overview_polyline?: string; legs?: { distance: number; duration: number }[] }[];
}

/** Driving route; distance in km and a traffic-aware duration in minutes. */
export async function route(from: Point, to: Point): Promise<{ distanceKm: number; durationMin: number; geometry: [number, number][] }> {
    const data = await call<Directions>(
        "/routing/v1/directions",
        { origin: `${from.lat},${from.lng}`, destination: `${to.lat},${to.lng}` },
        "POST"
    );
    const best = data.routes?.[0];
    const legs = best?.legs || [];
    if (!best || !legs.length) throw new Error("Ola Maps found no route");
    const meters = legs.reduce((sum, leg) => sum + leg.distance, 0);
    const seconds = legs.reduce((sum, leg) => sum + leg.duration, 0);
    return {
        distanceKm: Math.max(0.1, Math.round(meters / 100) / 10),
        durationMin: Math.max(2, Math.round(seconds / 60)),
        geometry: best.overview_polyline
            ? decodePolyline(best.overview_polyline)
            : [
                  [from.lat, from.lng],
                  [to.lat, to.lng]
              ]
    };
}
