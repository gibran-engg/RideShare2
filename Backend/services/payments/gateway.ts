import crypto from "node:crypto";
import config from "../../lib/config.ts";
import type { PaymentMethod, PaymentRow } from "../../lib/types.ts";

/**
 * What RideShare needs from a payment provider. Razorpay, Stripe or PhonePe each become one class
 * implementing this; nothing else in the code base knows which provider is in use.
 *
 * Flow (same as real hosted checkouts):
 *   1. createCheckout -> the rider's browser is sent to the provider's hosted page.
 *   2. The provider calls our webhook with a signed result -> verifyWebhook -> payment updated.
 *   3. The provider redirects the browser back to returnUrl.
 */
export interface CheckoutRequest {
    paymentId: number;
    amount: number;
    currency: string;
    method: PaymentMethod;
    description: string;
    returnUrl: string;
    /** Origin the rider's browser uses to reach the API (hosted mock page lives there). */
    baseUrl: string;
}

export interface CheckoutSession {
    id: string;
    url: string;
}

export interface WebhookEvent {
    sessionId: string;
    outcome: "succeeded" | "failed";
    reason?: string;
}

export interface PaymentGateway {
    readonly name: string;
    createCheckout(request: CheckoutRequest): CheckoutSession;
    /** Returns the event if the signature is valid, otherwise null. */
    verifyWebhook(rawBody: string, signature: string | undefined): WebhookEvent | null;
    refund(payment: PaymentRow): void;
}

export function sign(rawBody: string): string {
    return `sha256=${crypto.createHmac("sha256", config.payments.webhookSecret).update(rawBody).digest("hex")}`;
}

function signatureMatches(rawBody: string, signature: string | undefined): boolean {
    if (typeof signature !== "string") return false;
    const expected = Buffer.from(sign(rawBody));
    const given = Buffer.from(signature);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export interface MockSession extends CheckoutRequest {
    id: string;
    expiresAt: number;
}

/**
 * Test-mode provider. Its "hosted checkout" is a page served by the API at /pay/mock/:id with
 * Pay and Decline buttons; choosing one produces a signed webhook exactly like a real provider.
 */
export class MockGateway implements PaymentGateway {
    readonly name = "mock";
    private sessions = new Map<string, MockSession>();
    static readonly SESSION_TTL_MS = 30 * 60 * 1000;

    createCheckout(request: CheckoutRequest): CheckoutSession {
        this.prune();
        const id = `mock_cs_${crypto.randomBytes(12).toString("hex")}`;
        this.sessions.set(id, { ...request, id, expiresAt: Date.now() + MockGateway.SESSION_TTL_MS });
        return { id, url: `${request.baseUrl}/pay/mock/${id}` };
    }

    session(id: string): MockSession | null {
        const session = this.sessions.get(id);
        return session && session.expiresAt > Date.now() ? session : null;
    }

    /** What the provider would POST to our webhook when the rider pays or declines. */
    webhookFor(sessionId: string, outcome: WebhookEvent["outcome"]): { rawBody: string; signature: string } {
        const event: WebhookEvent =
            outcome === "failed" ? { sessionId, outcome, reason: "Declined in test checkout" } : { sessionId, outcome };
        const rawBody = JSON.stringify(event);
        this.sessions.delete(sessionId);
        return { rawBody, signature: sign(rawBody) };
    }

    verifyWebhook(rawBody: string, signature: string | undefined): WebhookEvent | null {
        if (!signatureMatches(rawBody, signature)) return null;
        try {
            const event = JSON.parse(rawBody) as WebhookEvent;
            if (typeof event.sessionId !== "string" || (event.outcome !== "succeeded" && event.outcome !== "failed")) return null;
            return event;
        } catch {
            return null;
        }
    }

    refund(): void {
        // Nothing to call in test mode.
    }

    private prune(): void {
        const now = Date.now();
        for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
    }
}

let gateway: PaymentGateway | undefined;

export function getGateway(): PaymentGateway {
    if (!gateway) {
        if (config.payments.provider !== "mock") throw new Error(`Unknown PAYMENT_PROVIDER "${config.payments.provider}"`);
        gateway = new MockGateway();
    }
    return gateway;
}
