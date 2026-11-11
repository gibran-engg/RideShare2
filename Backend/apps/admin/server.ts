import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../lib/errors.ts";
import * as activity from "../../services/activity/service.ts";
import * as auth from "../../services/auth/oidc.ts";
import config from "../../lib/config.ts";
import { isMain } from "../../lib/is-main.ts";
import * as security from "../../lib/security.ts";
import * as users from "../../services/users/service.ts";
import * as web from "../../lib/web-app.ts";
import router from "./routes.ts";

const app = web.createWebApp({
    name: "RideShare Admin",
    cookieName: "rideshare-admin.sid",
    viewsDir: path.join(import.meta.dirname, "views")
});

// Admin decisions (approvals, suspensions, refunds) appear on the affected user's timeline.
activity.startRecording();

/**
 * Who may use the admin app is decided in Auth0: the "admin" role, which reaches us in the signed ID
 * token. The session only lasts as long as that token, so removing the role in Auth0 takes effect at
 * the next sign-in at the latest; suspending the account here takes effect at once.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
    const adminId = req.session.adminId;
    if (!adminId) return next();
    const user = users.getById(adminId);
    if (!user || user.status !== "active" || !req.session.adminUntil || req.session.adminUntil <= Date.now()) {
        return req.session.destroy(() => res.redirect("/login"));
    }
    req.admin = user;
    res.locals.currentUser = user;
    next();
});

app.use(
    auth.createAuthRouter({
        appKey: "admin",
        baseUrl: config.urls.admin,
        onSignIn(req, profile, { returnTo, expiresAt }) {
            if (!profile.roles?.includes("admin")) {
                throw new AppError("FORBIDDEN", `${profile.email || "This account"} doesn't have the admin role in Auth0.`);
            }
            const { user } = users.signIn(profile, "admin");
            if (user.status !== "active") throw new AppError("FORBIDDEN", "This account is suspended.");
            req.session.adminId = user.id;
            req.session.adminUntil = expiresAt;
            return returnTo || "/";
        }
    })
);

app.get("/login", (req, res) => {
    if (req.admin) return res.redirect("/");
    res.render("login", {
        title: "Admin sign-in",
        bare: true,
        bodyClass: "auth-page",
        providers: auth.enabledProviders(),
        returnTo: security.safeReturnTo(req.query.returnTo, "")
    });
});

app.use((req, res, next) => {
    if (req.admin) return next();
    if (req.method === "GET") return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    res.redirect("/login");
});

app.use(router);

app.use(security.notFound);
app.use(security.errorHandler);

if (isMain(import.meta.url)) {
    web.listen(app, config.ports.admin, "RideShare Admin app");
}

export default app;
