import * as db from "../../db/index.ts";
import type { ActivityRow, Page, PageQuery } from "../../lib/types.ts";
import { pageLimit, toPage } from "../../lib/pagination.ts";

export interface NewActivity {
    userId: number;
    type: string;
    entityType?: string | null;
    entityId?: number | null;
    metadata?: Record<string, unknown> | null;
    ip?: string | null;
    userAgent?: string | null;
}

export function insert(event: NewActivity): void {
    db.get()
        .prepare(
            "INSERT INTO activity_events (user_id, type, entity_type, entity_id, metadata, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
            event.userId,
            event.type,
            event.entityType ?? null,
            event.entityId ?? null,
            event.metadata ? JSON.stringify(event.metadata) : null,
            event.ip ?? null,
            event.userAgent ? event.userAgent.slice(0, 300) : null
        );
}

export function listFor(userId: number, page: PageQuery = {}): Page<ActivityRow> {
    const limit = pageLimit(page);
    const rows = db
        .get()
        .prepare("SELECT * FROM activity_events WHERE user_id = ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?")
        .all(userId, page.cursor ?? null, page.cursor ?? null, limit + 1) as unknown as ActivityRow[];
    return toPage(rows, limit);
}
