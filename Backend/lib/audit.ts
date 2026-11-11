import * as db from "../db/index.ts";

/** Admin actions (who approved, suspended, cancelled, refunded what). */
export interface AuditRow {
    id: number;
    actor_id: number | null;
    action: string;
    target_type: string | null;
    target_id: number | null;
    details: string | null;
    created_at: string;
    actor_name: string | null;
    actor_email: string | null;
}

export function log(
    actorId: number | null,
    action: string,
    targetType: string | null = null,
    targetId: number | null = null,
    details: unknown = null
): void {
    db.get()
        .prepare("INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)")
        .run(actorId, action, targetType, targetId, details ? JSON.stringify(details) : null);
}

export function recent(limit = 100): AuditRow[] {
    return db
        .get()
        .prepare(
            `SELECT a.*, u.name AS actor_name, u.email AS actor_email FROM audit_log a
             LEFT JOIN users u ON u.id = a.actor_id
             ORDER BY a.id DESC LIMIT ?`
        )
        .all(limit) as unknown as AuditRow[];
}
