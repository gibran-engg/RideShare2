import type { VehicleType } from "../../lib/types.ts";

interface Rate {
    label: string;
    seats: number;
    base: number;
    perKm: number;
    perMin: number;
    minimum: number;
}

/** Fare card in rupees. */
export const RATE_CARD: Record<VehicleType, Rate> = {
    bike: { label: "Bike", seats: 1, base: 20, perKm: 7, perMin: 1, minimum: 30 },
    auto: { label: "Auto", seats: 3, base: 30, perKm: 12, perMin: 1.5, minimum: 40 },
    car: { label: "Car", seats: 4, base: 50, perKm: 16, perMin: 2, minimum: 80 }
};

export const VEHICLE_TYPES = Object.keys(RATE_CARD) as VehicleType[];

export function isVehicleType(value: unknown): value is VehicleType {
    return typeof value === "string" && Object.hasOwn(RATE_CARD, value);
}

export type PricingSegmentId = "normal" | "peak" | "night";

export interface PricingSegment {
    id: PricingSegmentId;
    label: string;
    multiplier: number;
    /** Hours of the day (India time) the segment covers, as [from, to) pairs. */
    hours: [number, number][];
}

/**
 * The three pricing segments, by the time a ride is booked (India time). Hours not listed under
 * peak or night are normal. Change the windows or multipliers here.
 */
export const PRICING_SEGMENTS: Record<PricingSegmentId, PricingSegment> = {
    normal: { id: "normal", label: "Normal", multiplier: 1, hours: [] },
    peak: {
        id: "peak",
        label: "Peak hours",
        multiplier: 1.5,
        hours: [
            [8, 11],
            [17, 20]
        ]
    },
    night: { id: "night", label: "Late night", multiplier: 1.3, hours: [[0, 5]] }
};

export const PRICING_TIME_ZONE = "Asia/Kolkata";

/** Hour of the day (0-23) in India, whatever time zone the server runs in. */
export function indiaHour(at: Date): number {
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: PRICING_TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(at);
    return Number.parseInt(hour, 10);
}

export function segmentAt(at: Date = new Date()): PricingSegment {
    const hour = indiaHour(at);
    for (const segment of [PRICING_SEGMENTS.peak, PRICING_SEGMENTS.night]) {
        if (segment.hours.some(([from, to]) => hour >= from && hour < to)) return segment;
    }
    return PRICING_SEGMENTS.normal;
}

export interface FareQuote {
    /** What the rider pays, in whole rupees. */
    fare: number;
    base: number;
    distanceCharge: number;
    timeCharge: number;
    segment: PricingSegmentId;
    segmentLabel: string;
    multiplier: number;
    /** True when the vehicle's minimum fare applied instead of the calculated one. */
    minimumApplied: boolean;
}

/**
 * Fare with its breakdown: base + per km + per minute (at least the vehicle's minimum), times the
 * segment's multiplier. The multiplier applies to the whole fare, minimum included, as Uber and Ola do.
 */
export function quote(vehicleType: VehicleType, distanceKm: number, durationMin: number, at: Date = new Date()): FareQuote {
    const rate = RATE_CARD[vehicleType];
    if (!rate) throw new Error(`Unknown vehicle type "${vehicleType}"`);
    const segment = segmentAt(at);
    const base = rate.base;
    const distanceCharge = Math.round(rate.perKm * distanceKm * 100) / 100;
    const timeCharge = Math.round(rate.perMin * durationMin * 100) / 100;
    const calculated = base + distanceCharge + timeCharge;
    return {
        fare: Math.round(Math.max(rate.minimum, calculated) * segment.multiplier),
        base,
        distanceCharge,
        timeCharge,
        segment: segment.id,
        segmentLabel: segment.label,
        multiplier: segment.multiplier,
        minimumApplied: calculated < rate.minimum
    };
}

export function calculate(vehicleType: VehicleType, distanceKm: number, durationMin: number, at: Date = new Date()): number {
    return quote(vehicleType, distanceKm, durationMin, at).fare;
}
