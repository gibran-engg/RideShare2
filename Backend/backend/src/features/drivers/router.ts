import { z } from "zod";
import { AppError } from "../../../../lib/errors.ts";
import * as drivers from "../../../../services/drivers/service.ts";
import * as rides from "../../../../services/rides/service.ts";
import * as users from "../../../../services/users/service.ts";
import { requireReady } from "../../core/auth.ts";
import { createModule } from "../../core/route.ts";
import { LatLng, Ok } from "../../core/schemas.ts";
import { Ride, toRide } from "../rides/schemas.ts";
import { me } from "../users/router.ts";
import { Me } from "../users/schemas.ts";
import { parseUpload, saveDocument } from "./documents.ts";
import { Driver, DriverBody, Earnings, toDriver } from "./schemas.ts";

const { router, add } = createModule();
const tags = ["Driver"];
const driverOnly = requireReady("driver");

add(
    {
        method: "post",
        path: "/onboarding/driver",
        summary: "Submit licence, vehicle and documents for approval",
        tags: ["Account"],
        bodyType: "multipart",
        before: [parseUpload],
        body: DriverBody,
        response: Me
    },
    ({ user, body }, req) => {
        if (user.role !== "driver") throw new AppError("BAD_REQUEST", "Only drivers add a vehicle.");
        if (!user.phone_verified) throw new AppError("BAD_REQUEST", "Verify your phone number first.");
        const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
        const { licenseDoc: _l, rcDoc: _r, ...data } = body;
        drivers.submit(user.id, data, { licenseDoc: saveDocument(files.licenseDoc?.[0]), rcDoc: saveDocument(files.rcDoc?.[0]) });
        users.completeOnboarding(user.id);
        return me(user.id);
    }
);

add(
    {
        method: "get",
        path: "/driver/requests",
        summary: "Requested rides near the driver, for their vehicle type",
        tags,
        before: [driverOnly],
        response: z.object({ rides: z.array(Ride) })
    },
    ({ user }) => ({ rides: rides.openRequestsFor(drivers.get(user.id)).map((ride) => toRide(ride, user.id)) })
);

add(
    {
        method: "post",
        path: "/driver/location",
        summary: "Report the driver's GPS position",
        tags,
        before: [driverOnly],
        body: LatLng,
        response: Ok
    },
    ({ user, body }) => {
        drivers.setLocation(user.id, body);
        return { ok: true };
    }
);

add(
    {
        method: "post",
        path: "/driver/online",
        summary: "Go online or offline",
        tags,
        before: [driverOnly],
        body: z.object({ online: z.boolean().default(false) }),
        response: z.object({ driver: Driver }),
        errors: [409]
    },
    ({ user, body }) => {
        if (!body.online && rides.activeForDriver(user.id))
            throw new AppError("CONFLICT", "Finish your current ride before going offline.");
        return { driver: toDriver(drivers.setOnline(user.id, body.online)) };
    }
);

add(
    {
        method: "get",
        path: "/driver/earnings",
        summary: "Today, this week and all time",
        tags,
        before: [driverOnly],
        response: z.object({ earnings: Earnings })
    },
    ({ user }) => ({ earnings: rides.earnings(user.id) })
);

export default router;
