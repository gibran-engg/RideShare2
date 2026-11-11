import { z } from "zod";
import config from "../../../../lib/config.ts";
import * as drivers from "../../../../services/drivers/service.ts";
import * as security from "../../../../lib/security.ts";
import * as sms from "../../../../lib/sms.ts";
import * as users from "../../../../services/users/service.ts";
import { createModule } from "../../core/route.ts";
import { toDriver } from "../drivers/schemas.ts";
import { Me, ProfileBody, toUser } from "./schemas.ts";

/** The signed-in user, plus which onboarding step the app should show. */
export function me(userId: number) {
    const user = users.getById(userId)!;
    const next = users.onboardingStep(user);
    return {
        user: toUser(user),
        driver: user.role === "driver" ? toDriver(drivers.get(user.id)) : null,
        next,
        // In development the OTP SMS isn't really sent, so show it in the app.
        ...(!config.isProduction && next === "verify" ? { devSms: sms.latestForUser(user.id, 1)[0]?.message ?? null } : {})
    };
}

const { router, add } = createModule();
const tags = ["Account"];
const tenMinutes = 10 * 60 * 1000;

add({ method: "get", path: "/me", summary: "The signed-in user and their next onboarding step", tags, response: Me }, ({ user }) =>
    me(user.id)
);

add(
    {
        method: "post",
        path: "/onboarding/profile",
        summary: "Save name, phone and role; sends an SMS code",
        tags,
        before: [security.rateLimit({ windowMs: tenMinutes, max: 10 })],
        body: ProfileBody,
        response: Me,
        errors: [429]
    },
    ({ user, body }) => me(users.saveProfile(user.id, body).id)
);

add(
    {
        method: "post",
        path: "/onboarding/verify",
        summary: "Verify the phone with the SMS code",
        tags,
        before: [security.rateLimit({ windowMs: tenMinutes, max: 15 })],
        body: z.object({ code: z.string({ message: "Enter the 6-digit code." }).trim().max(10) }),
        response: Me,
        errors: [429]
    },
    ({ user, body }) => {
        users.verifyPhone(user, body.code);
        return me(user.id);
    }
);

add(
    {
        method: "post",
        path: "/onboarding/resend",
        summary: "Send a new SMS code",
        tags,
        before: [security.rateLimit({ windowMs: tenMinutes, max: 5 })],
        response: Me,
        errors: [429]
    },
    ({ user }) => {
        users.resendCode(user);
        return me(user.id);
    }
);

export default router;
