import path from "node:path";
import express from "express";
import type { Express } from "express";
import config from "./config.ts";
import * as db from "../db/index.ts";
import { sessionMiddleware } from "./session-store.ts";
import { csrf, flash, securityHeaders } from "./security.ts";
import * as helpers from "./view-helpers.ts";

// Layout partials and the error page (views/), and the stylesheet and browser script (public/).
const VIEWS_DIR = path.join(import.meta.dirname, "..", "views");
const PUBLIC_DIR = path.join(import.meta.dirname, "..", "public");

/** Common Express setup for the server-rendered apps. Routes are added by each app. */
export function createWebApp({ name, cookieName, viewsDir }: { name: string; cookieName: string; viewsDir: string }): Express {
    db.open();

    const app = express();
    app.disable("x-powered-by");
    if (config.isProduction) app.set("trust proxy", 1);

    app.set("view engine", "ejs");
    app.set("views", [viewsDir, VIEWS_DIR]);

    app.use(securityHeaders);
    app.use("/static", express.static(PUBLIC_DIR, { maxAge: config.isProduction ? "7d" : 0 }));
    app.use(express.urlencoded({ extended: false, limit: "100kb" }));
    app.use(sessionMiddleware(cookieName));
    app.use(flash);
    app.use(csrf);

    app.locals.appName = name;
    app.locals.h = helpers;
    app.use((req, res, next) => {
        res.locals.path = req.path;
        res.locals.currentUser = null;
        next();
    });

    return app;
}

export function listen(app: Express, port: number, label: string) {
    return app.listen(port, () => {
        console.log(`${label} running at http://localhost:${port}`);
    });
}
