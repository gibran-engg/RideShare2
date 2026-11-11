import * as db from "../../db/index.ts";
import type { Role, UserListRow, UserRow, UserStatus } from "../../lib/types.ts";

export function getById(id: number): UserRow | null {
    return (db.get().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ?? null;
}

export function getByEmail(email: string): UserRow | null {
    return (db.get().prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined) ?? null;
}

export function findIdentity(provider: string, subject: string): { user_id: number } | null {
    return (
        (db.get().prepare("SELECT user_id FROM identities WHERE provider = ? AND subject = ?").get(provider, subject) as
            { user_id: number } | undefined) ?? null
    );
}

export function insert(email: string, name: string | null, picture: string | null): number {
    return Number(db.get().prepare("INSERT INTO users (email, name, picture) VALUES (?, ?, ?)").run(email, name, picture).lastInsertRowid);
}

export function linkIdentity(userId: number, provider: string, subject: string, email: string): void {
    db.get()
        .prepare("INSERT INTO identities (user_id, provider, subject, email) VALUES (?, ?, ?, ?)")
        .run(userId, provider, subject, email);
}

export function recordLogin(userId: number, name: string | null, picture: string | null): void {
    db.get()
        .prepare(
            `UPDATE users SET last_login_at = datetime('now'),
                    name = COALESCE(name, ?), picture = COALESCE(?, picture)
             WHERE id = ?`
        )
        .run(name, picture, userId);
}

export function saveProfile(userId: number, profile: { name: string; phone: string; role: Role }, resetPhoneVerification: boolean): void {
    db.get()
        .prepare(
            `UPDATE users SET name = ?, phone = ?, role = ?,
                    phone_verified = CASE WHEN ? THEN 0 ELSE phone_verified END,
                    updated_at = datetime('now')
             WHERE id = ?`
        )
        .run(profile.name, profile.phone, profile.role, resetPhoneVerification ? 1 : 0, userId);
}

export function setRole(userId: number, role: Role): void {
    db.get().prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(role, userId);
}

export function markPhoneVerified(userId: number): void {
    db.get().prepare("UPDATE users SET phone_verified = 1, updated_at = datetime('now') WHERE id = ?").run(userId);
}

export function completeOnboarding(userId: number): void {
    db.get().prepare("UPDATE users SET onboarding_complete = 1, updated_at = datetime('now') WHERE id = ?").run(userId);
}

export function setStatus(userId: number, status: UserStatus): boolean {
    return db.get().prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, userId).changes > 0;
}

export function list({ search = "", role = "" }: { search?: string; role?: Role | "" } = {}): UserListRow[] {
    const like = `%${search}%`;
    return db
        .get()
        .prepare(
            `SELECT u.*, d.verification_status,
                    (SELECT COUNT(*) FROM rides r WHERE r.rider_id = u.id OR r.driver_id = u.id) AS ride_count
             FROM users u LEFT JOIN drivers d ON d.user_id = u.id
             WHERE (? = '' OR u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)
               AND (? = '' OR u.role = ?)
             ORDER BY u.id DESC LIMIT 200`
        )
        .all(search, like, like, like, role, role) as unknown as UserListRow[];
}

// ---- Phone verification codes ----

export interface OtpRow {
    id: number;
    phone: string;
    code_hash: string;
    expires_at: number;
    attempts: number;
}

export function lastOtpSentAt(userId: number): number | null {
    const row = db.get().prepare("SELECT created_at FROM otp_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId) as
        { created_at: number } | undefined;
    return row?.created_at ?? null;
}

/** Invalidates earlier codes and stores the new one. */
export function replaceOtp(userId: number, phone: string, codeHash: string, expiresAt: number): void {
    const conn = db.get();
    conn.prepare("UPDATE otp_codes SET consumed = 1 WHERE user_id = ? AND consumed = 0").run(userId);
    conn.prepare("INSERT INTO otp_codes (user_id, phone, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
        userId,
        phone,
        codeHash,
        expiresAt,
        Date.now()
    );
}

export function currentOtp(userId: number): OtpRow | null {
    return (
        (db.get().prepare("SELECT * FROM otp_codes WHERE user_id = ? AND consumed = 0 ORDER BY id DESC LIMIT 1").get(userId) as
            OtpRow | undefined) ?? null
    );
}

export function recordOtpFailure(id: number): void {
    db.get().prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?").run(id);
}

export function consumeOtp(id: number): void {
    db.get().prepare("UPDATE otp_codes SET consumed = 1 WHERE id = ?").run(id);
}
