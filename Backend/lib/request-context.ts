import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is making the current request, available anywhere in the call stack without threading it
 * through every function (used to stamp activity events with IP and user agent).
 */
export interface RequestContext {
    requestId: string;
    ip: string | null;
    userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
    return storage.getStore();
}
