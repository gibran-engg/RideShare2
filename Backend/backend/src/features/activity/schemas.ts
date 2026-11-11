import { z } from "zod";
import * as activity from "../../../../services/activity/service.ts";
import type { ActivityRow } from "../../../../lib/types.ts";
import { registry } from "../../core/openapi.ts";

export const Activity = registry.register(
    "Activity",
    z.object({
        id: z.number(),
        type: z.string().openapi({ example: "ride.completed" }),
        label: z.string().openapi({ example: "Trip completed" }),
        entity: z.object({ type: z.string(), id: z.number() }).nullable(),
        metadata: z.record(z.string(), z.unknown()),
        createdAt: z.string()
    })
);

function parseMetadata(value: string | null): Record<string, unknown> {
    try {
        return value ? (JSON.parse(value) as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

export function toActivity(row: ActivityRow) {
    return {
        id: row.id,
        type: row.type,
        label: activity.ACTIVITY_LABELS[row.type] || row.type,
        entity: row.entity_type && row.entity_id != null ? { type: row.entity_type, id: row.entity_id } : null,
        metadata: parseMetadata(row.metadata),
        createdAt: row.created_at
    };
}
