import express from "express";
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { z as zod } from "zod";
import type { ZodType, z } from "zod";
import { AppError } from "../../../lib/errors.ts";
import { ErrorSchema, bearerAuth, registry } from "./openapi.ts";
import { requireAuth } from "./auth.ts";
import { idempotent } from "./idempotency.ts";

type Method = "get" | "post";

export interface RouteSpec<P extends ZodType, Q extends ZodType, B extends ZodType> {
    method: Method;
    /** Express-style path relative to /api/v1, e.g. /rides/:id */
    path: string;
    summary: string;
    tags: string[];
    description?: string;
    /** Requires a bearer token (default true). */
    auth?: boolean;
    params?: P;
    query?: Q;
    body?: B;
    /** "multipart" bodies are parsed by `before` middleware (multer) and then validated. */
    bodyType?: "json" | "multipart";
    /** Documented response body (not validated at runtime). */
    response?: ZodType;
    status?: number;
    /** Honour the Idempotency-Key header. */
    idempotent?: boolean;
    /** Extra middleware run after authentication and before validation (rate limits, role checks, uploads). */
    before?: RequestHandler[];
    /** Documented error codes. */
    errors?: number[];
}

export interface Validated<P, Q, B> {
    params: P;
    query: Q;
    body: B;
    user: NonNullable<Request["user"]>;
}

const VALIDATION_SOURCES = ["params", "query", "body"] as const;

function issueList(error: z.ZodError, source: string) {
    return error.issues.map((issue) => ({ source, path: issue.path.join("."), message: issue.message }));
}

/** Parses params/query/body with the route's schemas; any failure is a 400 with every issue listed. */
function validate(spec: RouteSpec<ZodType, ZodType, ZodType>): RequestHandler {
    return (req, res, next) => {
        const parsed: Record<string, unknown> = {};
        const issues: ReturnType<typeof issueList> = [];
        for (const source of VALIDATION_SOURCES) {
            const schema = spec[source];
            if (!schema) continue;
            const result = schema.safeParse(source === "body" ? (req.body ?? {}) : req[source]);
            if (result.success) parsed[source] = result.data;
            else issues.push(...issueList(result.error, source));
        }
        if (issues.length) return next(new AppError("VALIDATION_FAILED", issues[0]!.message, { issues }));
        res.locals.valid = parsed;
        next();
    };
}

function openApiPath(path: string): string {
    return path.replace(/:([A-Za-z]+)/g, "{$1}");
}

const STATUS_TEXT: Record<number, string> = {
    400: "Invalid input",
    401: "Not signed in",
    403: "Not allowed",
    404: "Not found",
    409: "Conflicts with the current state",
    422: "Idempotency key reused with a different request",
    429: "Too many requests"
};

function document(spec: RouteSpec<ZodType, ZodType, ZodType>): void {
    const auth = spec.auth !== false;
    const errorCodes = new Set([...(spec.body || spec.query || spec.params ? [400] : []), ...(auth ? [401] : []), ...(spec.errors || [])]);
    const headers = spec.idempotent
        ? zod.object({
              "idempotency-key": zod
                  .string()
                  .max(100)
                  .optional()
                  .openapi({ description: "Retry-safe key; the same key returns the first response" })
          })
        : undefined;
    registry.registerPath({
        method: spec.method,
        path: openApiPath(spec.path),
        summary: spec.summary,
        description: spec.description,
        tags: spec.tags,
        security: auth ? [{ [bearerAuth.name]: [] }] : [],
        request: {
            params: spec.params as never,
            query: spec.query as never,
            headers: headers as never,
            body: spec.body
                ? { content: { [spec.bodyType === "multipart" ? "multipart/form-data" : "application/json"]: { schema: spec.body } } }
                : undefined
        },
        responses: {
            [spec.status || 200]: {
                description: "Success",
                content: spec.response ? { "application/json": { schema: spec.response } } : undefined
            },
            ...Object.fromEntries(
                [...errorCodes].map((code) => [
                    code,
                    { description: STATUS_TEXT[code] || "Error", content: { "application/json": { schema: ErrorSchema } } }
                ])
            )
        }
    });
}

/**
 * A module's routes. Each `add` registers the Express route (auth → extra middleware → idempotency
 * → validation → handler) and its OpenAPI description from the same schemas.
 */
export function createModule(): { router: Router; add: typeof add } {
    const router = express.Router();

    function add<P extends ZodType = ZodType, Q extends ZodType = ZodType, B extends ZodType = ZodType>(
        spec: RouteSpec<P, Q, B>,
        handler: (input: Validated<z.output<P>, z.output<Q>, z.output<B>>, req: Request, res: Response) => unknown
    ): void {
        const chain: RequestHandler[] = [];
        if (spec.auth !== false) chain.push(requireAuth);
        chain.push(...(spec.before || []));
        if (spec.idempotent) chain.push(idempotent);
        chain.push(validate(spec as RouteSpec<ZodType, ZodType, ZodType>));
        chain.push(async (req: Request, res: Response, next: NextFunction) => {
            const valid = (res.locals.valid || {}) as Record<string, unknown>;
            const result = await handler(
                { params: valid.params, query: valid.query, body: valid.body, user: req.user! } as never,
                req,
                res
            );
            if (res.headersSent) return;
            if (result === undefined) return next(new Error(`${spec.method.toUpperCase()} ${spec.path} returned nothing`));
            res.status(spec.status || 200).json(result);
        });
        router[spec.method](spec.path, ...chain);
        document(spec as RouteSpec<ZodType, ZodType, ZodType>);
    }

    return { router, add };
}
