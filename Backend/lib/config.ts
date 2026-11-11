import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";

// The project root (this file is in lib/). .env, data/ and uploads are resolved from here.
const ROOT_DIR = path.resolve(import.meta.dirname, "..");

dotenv.config({ path: path.join(ROOT_DIR, ".env"), quiet: true });

const env = process.env;
const isProduction = env.NODE_ENV === "production";

function port(name: string, fallback: number): number {
    return Number.parseInt(env[name] || "", 10) || fallback;
}

/** The PC's Wi-Fi/LAN address, so a phone on the same network can reach the dev servers. */
function lanAddress(): string {
    const candidates = Object.values(os.networkInterfaces())
        .flat()
        .filter((iface): iface is os.NetworkInterfaceInfo => Boolean(iface && iface.family === "IPv4" && !iface.internal))
        .map((iface) => iface.address);
    return (
        candidates.find((ip) => ip.startsWith("192.168.")) || candidates.find((ip) => ip.startsWith("10.")) || candidates[0] || "localhost"
    );
}

const ports = {
    api: port("API_PORT", port("PORT", 3000)),
    admin: port("ADMIN_APP_PORT", 3002),
    mockOAuth: port("MOCK_OAUTH_PORT", 4000),
    web: port("WEB_PORT", 5173)
};

// Host the phone uses to reach this machine in development.
const devHost = env.DEV_HOST || lanAddress();

function secret(name: string): string {
    const value = env[name];
    if (value) return value;
    if (isProduction) throw new Error(`${name} must be set in production.`);
    // Dev fallback: anything signed with it stops working after a restart.
    return crypto.randomBytes(32).toString("hex");
}

// Auth0 tenant, e.g. "dev-abc123.us.auth0.com" (with or without https://).
const auth0Domain = (env.AUTH0_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
const auth0Enabled = Boolean(auth0Domain && env.AUTH0_AUDIENCE && env.AUTH0_APP_CLIENT_ID);
if (isProduction && !auth0Enabled) throw new Error("AUTH0_DOMAIN, AUTH0_AUDIENCE and AUTH0_APP_CLIENT_ID must be set in production.");

// The dev provider stands in for Auth0 only while Auth0 isn't configured, so the API trusts exactly one issuer.
const mockOAuthEnabled = !isProduction && !auth0Enabled && env.MOCK_OAUTH_ENABLED !== "false";

const apiUrl = env.API_URL || `http://${devHost}:${ports.api}`;
const webUrl = (env.WEB_URL || `http://localhost:${ports.web}`).replace(/\/$/, "");
const mockOAuthUrl = env.MOCK_OAUTH_URL || `http://${devHost}:${ports.mockOAuth}`;
const auth0Issuer = `https://${auth0Domain}/`;

const maptilerKey = env.MAPTILER_KEY || "";
const mapStyle = env.MAPTILER_STYLE || "dataviz-dark";

/** OAuth clients: the Android/browser app (public, PKCE) and the admin website (confidential). */
export type AppKey = "app" | "admin";

const config = {
    isProduction,
    ports,
    devHost,
    urls: {
        // Public URL of the API; the mobile app's OAuth redirect URIs are built from it.
        api: apiUrl,
        // The web app (Vite in development). Its sign-in runs through the API at <web>/web/auth/*.
        web: webUrl,
        admin: env.ADMIN_APP_URL || `http://localhost:${ports.admin}`,
        mockOAuth: mockOAuthUrl
    },
    databasePath: path.resolve(ROOT_DIR, env.DATABASE_PATH || "data/rideshare.db"),
    uploadDir: path.resolve(ROOT_DIR, env.UPLOAD_DIR || "data/uploads"),
    sessionSecret: secret("SESSION_SECRET"),
    /**
     * Who signs users in and issues the JWT access tokens the API accepts: Auth0, or the dev
     * provider in mock-oauth/ when Auth0 isn't configured (never in production).
     */
    identity: {
        provider: auth0Enabled ? "auth0" : "mock",
        issuer: auth0Enabled ? auth0Issuer : mockOAuthUrl,
        jwksUri: auth0Enabled ? `${auth0Issuer}.well-known/jwks.json` : `${mockOAuthUrl}/jwks`,
        userinfoUrl: auth0Enabled ? `${auth0Issuer}userinfo` : `${mockOAuthUrl}/userinfo`,
        // The Auth0 API identifier; access tokens must be issued for it (the JWT "aud" claim).
        audience: env.AUTH0_AUDIENCE || "https://api.rideshare.local",
        // The Native application the Android (and browser) app signs in with.
        appClientId: auth0Enabled ? env.AUTH0_APP_CLIENT_ID! : "rideshare-app",
        // Custom claim the Auth0 Post-Login Action fills with the user's roles (admin, rider, driver).
        rolesClaim: env.AUTH0_ROLES_CLAIM || "https://rideshare.app/roles"
    },
    oauth: {
        auth0: {
            // Admin sign-in; needs the admin application's credentials on top of the tenant settings.
            enabled: Boolean(auth0Enabled && env.AUTH0_ADMIN_CLIENT_ID && env.AUTH0_ADMIN_CLIENT_SECRET),
            issuer: auth0Issuer,
            // The Regular Web Application the admin website signs in with.
            adminClientId: env.AUTH0_ADMIN_CLIENT_ID || "",
            adminClientSecret: env.AUTH0_ADMIN_CLIENT_SECRET || ""
        },
        mock: {
            enabled: mockOAuthEnabled,
            // Registered like the two Auth0 applications: a public app client and a confidential admin client.
            clients: {
                app: { clientId: "rideshare-app", clientSecret: null },
                admin: { clientId: "rideshare-admin-app", clientSecret: "dev-admin-app-secret" }
            } satisfies Record<AppKey, { clientId: string; clientSecret: string | null }>
        }
    },
    map: {
        // MapTiler (free key at cloud.maptiler.com). Without a key the apps fall back to CARTO,
        // which now shows an "API key required" watermark.
        configured: Boolean(maptilerKey),
        styleUrl: maptilerKey ? `https://api.maptiler.com/maps/${mapStyle}/style.json?key=${maptilerKey}` : null,
        tileUrl: maptilerKey
            ? `https://api.maptiler.com/maps/${mapStyle}/256/{z}/{x}/{y}@2x.png?key=${maptilerKey}`
            : "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        attribution: maptilerKey ? "© MapTiler © OpenStreetMap contributors" : "© OpenStreetMap contributors © CARTO"
    },
    payments: {
        provider: env.PAYMENT_PROVIDER || "mock",
        // Signs the payment gateway's callbacks (webhook-style), so a forged "paid" is rejected.
        webhookSecret: secret("PAYMENT_WEBHOOK_SECRET"),
        currency: "INR"
    },
    geo: {
        // OpenStreetMap services. The public demo servers are fine for development;
        // self-host or use a commercial provider for production traffic.
        nominatimUrl: env.NOMINATIM_URL || "https://nominatim.openstreetmap.org",
        osrmUrl: env.OSRM_URL || "https://router.project-osrm.org",
        userAgent: env.GEO_USER_AGENT || "RideShare-dev/1.0 (student project)",
        // Bias place search toward the service area (Mumbai by default).
        viewbox: env.GEO_VIEWBOX || "72.75,19.30,73.10,18.88",
        countryCodes: env.GEO_COUNTRY_CODES || "in",
        // OSRM assumes empty roads; multiply its durations for city traffic.
        trafficFactor: Number(env.GEO_TRAFFIC_FACTOR) || 1.8
    },
    sms: { provider: env.SMS_PROVIDER || "console" }
};

export type Config = typeof config;
export default config;
