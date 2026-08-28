import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { type UrlSafetyPolicy } from "./url-safety.js";

/**
 * Deterministic local HTTP fixtures.
 *
 * Registration is a network operation, and the interesting failures are
 * network failures: a redirect into a private range, an oversized body, a
 * hostile content type. Those cannot be exercised against a mocked fetch
 * function, so tests run a real server on loopback instead. Nothing here
 * reaches the public internet, so required CI never depends on it.
 */

export interface FixtureRoute {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Send a redirect to this location instead of a body. */
  redirectTo?: string;
  /** Redirect status to use with `redirectTo`. */
  redirectStatus?: number;
  /** Delay before the response starts, for timeout tests. */
  delayMs?: number;
  /** Declare a `Content-Length` that disagrees with the body, for size tests. */
  declaredContentLength?: number;
}

export interface FixtureSite {
  /** Origin the fixture is served from, e.g. `http://127.0.0.1:45123`. */
  origin: string;
  /** Absolute URL for a site-root-relative path. */
  url(path: string): string;
  /** Every path requested so far, in order. */
  readonly requests: string[];
  /** Mutable routing table: a test can republish a path between captures. */
  routes: Map<string, FixtureRoute>;
  close(): Promise<void>;
}

/** The only policy under which a loopback fixture is reachable. */
export const FIXTURE_URL_SAFETY_POLICY: UrlSafetyPolicy = {
  allowInsecureHttp: true,
  allowLoopback: true,
  allowNonStandardPorts: true,
};

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export async function startFixtureSite(
  initialRoutes: Record<string, FixtureRoute | string> = {},
): Promise<FixtureSite> {
  const routes = new Map<string, FixtureRoute>();
  for (const [path, route] of Object.entries(initialRoutes)) {
    routes.set(normalizePath(path), typeof route === "string" ? { body: route } : route);
  }
  const requests: string[] = [];

  const server: Server = createServer((request, response) => {
    const path = normalizePath((request.url ?? "/").split("?")[0]!);
    requests.push(path);
    const route = routes.get(path);
    const respond = () => {
      if (route === undefined) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not found");
        return;
      }
      if (route.redirectTo !== undefined) {
        response.writeHead(route.redirectStatus ?? 302, { location: route.redirectTo });
        response.end();
        return;
      }
      const body = route.body ?? "";
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...(route.headers ?? {}),
      };
      if (route.declaredContentLength !== undefined) {
        headers["content-length"] = String(route.declaredContentLength);
      }
      response.writeHead(route.status ?? 200, headers);
      response.end(bytes);
    };
    if (route?.delayMs !== undefined) setTimeout(respond, route.delayMs);
    else respond();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    url: (path: string) => `${origin}${normalizePath(path)}`,
    requests,
    routes,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
