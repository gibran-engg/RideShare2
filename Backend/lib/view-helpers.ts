import { STATUS_LABELS } from "../services/rides/state.ts";
import { ACTIVITY_LABELS } from "../services/activity/service.ts";

const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function money(amount: number | null | undefined): string {
    return rupees.format(amount || 0);
}

/** SQLite datetime('now') values are UTC without a zone marker. */
function parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

export function dateTime(value: string | null | undefined): string {
    const date = parseDate(value);
    if (!date) return "-";
    return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

export function statusLabel(status: string): string {
    return STATUS_LABELS[status as keyof typeof STATUS_LABELS] || status;
}

export function activityLabel(type: string): string {
    return ACTIVITY_LABELS[type] || type;
}

export function initials(name: string | null | undefined): string {
    return (name || "?")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]!.toUpperCase())
        .join("");
}

export function vehicleLabel(type: string): string {
    return ({ bike: "Bike", auto: "Auto", car: "Car" } as Record<string, string>)[type] || type;
}

export function paymentLabel(status: string): string {
    return (
        (
            {
                unpaid: "Not due",
                pending: "Awaiting payment",
                paid: "Paid",
                failed: "Payment failed",
                refunded: "Refunded",
                succeeded: "Paid"
            } as Record<string, string>
        )[status] || status
    );
}

export function metadata(value: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
        return JSON.parse(value) as Record<string, unknown>;
    } catch {
        return {};
    }
}
