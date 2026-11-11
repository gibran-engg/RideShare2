import type { UserRow } from "./types.ts";
import type { AccessToken } from "../services/auth/jwt.ts";

export interface OAuthPending {
    provider: string;
    codeVerifier: string;
    state: string;
    nonce: string;
    returnTo: string;
    extra: unknown;
    startedAt: number;
}

declare module "express-session" {
    interface SessionData {
        csrfToken?: string;
        flash?: { type: string; message: string }[];
        oauth?: OAuthPending;
        adminId?: number;
        /** The admin session ends when the Auth0 ID token it was created from expires. */
        adminUntil?: number;
    }
}

declare global {
    namespace Express {
        interface Request {
            /** Signed-in app user (API) */
            user?: UserRow;
            /** Verified JWT access token of the request (API) */
            auth?: AccessToken;
            /** Signed-in admin (admin app) */
            admin?: UserRow;
            requestId?: string;
            flash?: (type: string, message: string) => void;
        }
    }
}
