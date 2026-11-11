import * as activity from "../../../../services/activity/service.ts";
import { createModule } from "../../core/route.ts";
import { PageQuery, page, toPage } from "../../core/schemas.ts";
import { Activity, toActivity } from "./schemas.ts";

const { router, add } = createModule();

add(
    { method: "get", path: "/me/activity", summary: "My activity timeline", tags: ["History"], query: PageQuery, response: page(Activity) },
    ({ user, query }) => toPage(activity.listFor(user.id, query), toActivity)
);

export default router;
