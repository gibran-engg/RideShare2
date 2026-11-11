/**
 * Minimal browser-like HTTP client for tests: keeps cookies per origin, follows redirects
 * manually, and can sign in through the dev OAuth provider like a real user would.
 */
export interface PageResult {
    status: number;
    url: string;
    text: string;
}

interface RequestOptions {
    method?: string;
    form?: Record<string, string>;
    multipart?: FormData;
    headers?: Record<string, string>;
}

export class Client {
    cookies = new Map<string, Map<string, string>>(); // host -> (name -> value)

    cookieHeader(url: URL): string {
        const jar = this.cookies.get(url.host);
        return jar ? [...jar].map(([name, value]) => `${name}=${value}`).join("; ") : "";
    }

    store(url: URL, response: Response): void {
        const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
        if (!setCookies.length) return;
        const jar = this.cookies.get(url.host) || new Map<string, string>();
        for (const header of setCookies) {
            const [pair] = header.split(";");
            const index = pair!.indexOf("=");
            jar.set(pair!.slice(0, index).trim(), pair!.slice(index + 1).trim());
        }
        this.cookies.set(url.host, jar);
    }

    /** Request that follows redirects. */
    async request(href: string, { method = "GET", form, multipart, headers = {} }: RequestOptions = {}): Promise<PageResult> {
        let url = new URL(href);
        let body: string | FormData | undefined = multipart || (form ? new URLSearchParams(form).toString() : undefined);
        for (let hops = 0; hops < 10; hops++) {
            const response = await fetch(url, {
                method,
                body,
                redirect: "manual",
                headers: {
                    ...headers,
                    ...(body && !multipart ? { "content-type": "application/x-www-form-urlencoded" } : {}),
                    cookie: this.cookieHeader(url),
                    referer: headers.referer || url.href
                }
            });
            this.store(url, response);
            const location = response.headers.get("location");
            if (response.status >= 300 && response.status < 400 && location) {
                url = new URL(location, url);
                // A redirect to the mobile app's deep link (exp://, rideshare://) ends here.
                if (!url.protocol.startsWith("http")) return { status: response.status, url: url.href, text: "" };
                method = "GET";
                body = undefined;
                continue;
            }
            return { status: response.status, url: url.href, text: await response.text() };
        }
        throw new Error("Too many redirects");
    }

    get(href: string): Promise<PageResult> {
        return this.request(href);
    }

    /** POST a form from `fromPage` (its CSRF token is picked up automatically). */
    async post(href: string, form: Record<string, string> = {}, fromPage?: PageResult): Promise<PageResult> {
        const page = fromPage || (await this.get(new URL("/", href).href));
        const match = page.text.match(/name="_csrf" value="([^"]+)"/);
        return this.request(href, { method: "POST", form: { _csrf: match ? match[1]! : "", ...form }, headers: { referer: page.url } });
    }

    /** Full OAuth Authorization Code + PKCE sign-in through the mock provider. */
    async signIn(appUrl: string, email: string, name = email.split("@")[0]!, query = ""): Promise<PageResult> {
        const authorize = await this.get(`${appUrl}/auth/mock${query}`);
        const hidden = Object.fromEntries(
            [...authorize.text.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
                m[1]!,
                m[2]!.replace(/&amp;/g, "&")
            ])
        );
        delete hidden.email;
        delete hidden.name;
        const authorizeUrl = new URL(authorize.url);
        return this.request(`${authorizeUrl.origin}/authorize`, { method: "POST", form: { ...hidden, email, name } });
    }
}
