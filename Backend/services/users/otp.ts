import crypto from "node:crypto";
import * as sms from "../../lib/sms.ts";
import * as repo from "./repository.ts";

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 30 * 1000;

function hash(code: string): string {
    return crypto.createHash("sha256").update(code).digest("hex");
}

/** Sends a 6-digit phone verification code. Returns false if asked again too soon. */
export function issue(userId: number, phone: string): boolean {
    const lastSentAt = repo.lastOtpSentAt(userId);
    if (lastSentAt && Date.now() - lastSentAt < RESEND_COOLDOWN_MS) return false;

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    repo.replaceOtp(userId, phone, hash(code), Date.now() + TTL_MS);
    sms.send({ userId, phone, message: `${code} is your RideShare verification code. It expires in 5 minutes.` });
    return true;
}

export function verify(userId: number, phone: string | null, code: unknown): { ok: true } | { ok: false; reason: string } {
    const row = repo.currentOtp(userId);
    if (!row || row.phone !== phone) return { ok: false, reason: "Please request a new code." };
    if (row.expires_at < Date.now()) return { ok: false, reason: "That code has expired. Please request a new one." };
    if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "Too many wrong attempts. Please request a new code." };

    const given = Buffer.from(hash(String(code || "")));
    if (!crypto.timingSafeEqual(given, Buffer.from(row.code_hash))) {
        repo.recordOtpFailure(row.id);
        return { ok: false, reason: "That code is not correct." };
    }

    repo.consumeOtp(row.id);
    return { ok: true };
}
