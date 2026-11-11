/**
 * Every error the API returns has a stable machine-readable code (clients branch on it) and a
 * human message (clients show it). The HTTP status is derived from the code, so a code can never
 * be sent with the wrong status.
 */
export const ERROR_STATUS = {
    VALIDATION_FAILED: 400,
    BAD_REQUEST: 400,
    OTP_INVALID: 400,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    ACCOUNT_SUSPENDED: 403,
    ONBOARDING_INCOMPLETE: 403,
    DRIVER_NOT_APPROVED: 403,
    NOT_FOUND: 404,
    RIDE_NOT_FOUND: 404,
    PAYMENT_NOT_FOUND: 404,
    CONFLICT: 409,
    ACTIVE_RIDE_EXISTS: 409,
    RIDE_UNAVAILABLE: 409,
    RIDE_STATE_CONFLICT: 409,
    PAYMENT_STATE_CONFLICT: 409,
    IDEMPOTENCY_KEY_REUSED: 422,
    RATE_LIMITED: 429,
    INTERNAL: 500,
    SERVICE_UNAVAILABLE: 503
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
    readonly code: ErrorCode;
    readonly status: number;
    readonly details: unknown;
    // The message is safe to show users; any other error is hidden behind a generic message.
    readonly expose = true;

    constructor(code: ErrorCode, message: string, details?: unknown) {
        super(message);
        this.name = "AppError";
        this.code = code;
        this.status = ERROR_STATUS[code];
        this.details = details;
    }
}
