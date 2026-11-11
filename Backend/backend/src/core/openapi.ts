import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

/** Every /api/v1 route registers itself here (see route.ts), so the document can't drift from the code. */
export const registry = new OpenAPIRegistry();

export const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Auth0 access token (RS256 JWT) issued for this API's audience"
});

export const ErrorSchema = registry.register(
    "Error",
    z.object({
        error: z.object({
            code: z.string().openapi({ example: "RIDE_NOT_FOUND" }),
            message: z.string().openapi({ example: "Ride not found." }),
            details: z.unknown().optional()
        })
    })
);

let document: ReturnType<OpenApiGeneratorV31["generateDocument"]> | null = null;

export function openApiDocument() {
    if (!document) {
        document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
            openapi: "3.1.0",
            info: {
                title: "RideShare API",
                version: "1.0.0",
                description:
                    "JSON API for the RideShare web and mobile apps. Errors always look like `{ error: { code, message, details? } }`. " +
                    "POSTs that create things accept an `Idempotency-Key` header; retries with the same key return the original response."
            },
            servers: [{ url: "/api/v1" }]
        });
    }
    return document;
}
