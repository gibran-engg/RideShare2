import express from "express";
import swaggerUi from "swagger-ui-express";
import * as activity from "../../services/activity/service.ts";
import config from "../../lib/config.ts";
import * as db from "../../db/index.ts";
import { errorHandler, notFound, requestContext } from "./core/errors.ts";
import { openApiDocument } from "./core/openapi.ts";
import activityRouter from "./features/activity/router.ts";
import authRouter from "./features/auth/router.ts";
import driversRouter from "./features/drivers/router.ts";
import mockCheckout from "./features/payments/mock-checkout.ts";
import paymentsRouter, { webhookRouter } from "./features/payments/router.ts";
import placesRouter from "./features/places/router.ts";
import ridesRouter from "./features/rides/router.ts";
import systemRouter from "./features/system/router.ts";
import usersRouter from "./features/users/router.ts";

db.open();
activity.startRecording();

/** Version 1 of the JSON API. Also served at /api for apps built before versioning. */
const v1 = express.Router();
for (const feature of [systemRouter, authRouter, usersRouter, driversRouter, placesRouter, ridesRouter, paymentsRouter, activityRouter]) {
    v1.use(feature);
}

const app = express();
app.disable("x-powered-by");
// Behind an HTTPS tunnel, a proxy or the web app's dev server, trust X-Forwarded-* headers.
app.set("trust proxy", config.isProduction || config.urls.api.startsWith("https://") ? 1 : "loopback");

app.use(requestContext);

// Signed webhooks need the raw body, so they are mounted before the JSON parser.
app.use("/api/v1", webhookRouter);
app.use(express.json({ limit: "100kb" }));

app.get("/", (req, res) => {
    res.json({
        message: "Welcome to RideShare API",
        version: "1",
        docs: "/docs",
        openapi: "/api/v1/openapi.json",
        health: "/api/v1/health"
    });
});
app.get("/api/v1/openapi.json", (req, res) => {
    res.json(openApiDocument());
});
if (!config.isProduction) {
    app.use(
        "/docs",
        swaggerUi.serve,
        swaggerUi.setup(undefined, { swaggerOptions: { url: "/api/v1/openapi.json" }, customSiteTitle: "RideShare API" })
    );
}
app.use("/api/v1", v1);
app.use("/api", v1);

// The test-mode checkout page (sign-in no longer goes through the API: the apps talk to Auth0 directly).
app.use(mockCheckout);

app.use(notFound);
app.use(errorHandler);

export default app;
