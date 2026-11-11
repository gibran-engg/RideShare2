import config from "./config.ts";
import * as db from "../db/index.ts";

/**
 * SMS / messaging service. The "console" provider logs messages and records them in the
 * notifications table (visible in the Admin app). Plug a real gateway (Twilio, MSG91) in here.
 */
interface SmsProvider {
    deliver(recipient: string, message: string): void;
}

const providers: Record<string, SmsProvider> = {
    console: {
        deliver(recipient, message) {
            console.log(`[sms] -> ${recipient}: ${message}`);
        }
    }
};

export interface NotificationRow {
    id: number;
    user_id: number | null;
    channel: string;
    recipient: string;
    message: string;
    created_at: string;
    user_name?: string | null;
}

export function send({
    userId = null,
    phone,
    message
}: {
    userId?: number | null;
    phone: string | null | undefined;
    message: string;
}): void {
    if (!phone) return;
    const provider = providers[config.sms.provider];
    if (!provider) throw new Error(`Unknown SMS_PROVIDER "${config.sms.provider}"`);

    db.get()
        .prepare("INSERT INTO notifications (user_id, channel, recipient, message) VALUES (?, 'sms', ?, ?)")
        .run(userId, phone, message);
    provider.deliver(phone, message);
}

export function recent(limit = 100): NotificationRow[] {
    return db
        .get()
        .prepare(
            `SELECT n.*, u.name AS user_name FROM notifications n
             LEFT JOIN users u ON u.id = n.user_id
             ORDER BY n.id DESC LIMIT ?`
        )
        .all(limit) as unknown as NotificationRow[];
}

export function latestForUser(userId: number, limit = 5): NotificationRow[] {
    return db
        .get()
        .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?")
        .all(userId, limit) as unknown as NotificationRow[];
}
