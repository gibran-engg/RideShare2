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

export function calculate(vehicleType: VehicleType, distanceKm: number, durationMin: number): number {
    const rate = RATE_CARD[vehicleType];
    if (!rate) throw new Error(`Unknown vehicle type "${vehicleType}"`);
    const fare = rate.base + rate.perKm * distanceKm + rate.perMin * durationMin;
    return Math.max(rate.minimum, Math.round(fare));
}
