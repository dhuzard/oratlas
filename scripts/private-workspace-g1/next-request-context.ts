import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The single place the G1 harness touches private Next.js internals. It reproduces how Next
 * 15.5's app-route module gives a route handler its request context — a request store from
 * `createRequestStoreForAPI` and a work store from `createWorkStore`, both entered through Next's
 * own `workAsyncStorage`/`workUnitAsyncStorage` instances — so production `cookies()` (and through
 * it `getCurrentUser`, the session token reader and Prisma) run unmodified. It does not run a Next
 * server: there is no routing, middleware, RSC/HTML rendering, response serialization or network.
 *
 * Every assumption fails fast: the pinned Next version, the real AsyncLocalStorage (Next silently
 * substitutes a fake that drops context when `globalThis.AsyncLocalStorage` is absent at import),
 * module identity with the copy the application resolves for `next/headers`, and store presence
 * inside and absence outside a run.
 */

export const PINNED_NEXT_VERSION = "15.5.20";
export const G1_BUILD_ID = "g1-deterministic-build";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_PACKAGE = resolve(HERE, "../../apps/web/package.json");

export class NextContextError extends Error {
  override readonly name = "NextContextError";
}

type ImplicitTags = { tags: string[]; expirationsByCacheKind: Map<string, unknown> };
type RequestStore = { type: "request"; phase: string; mutableCookies: unknown };
type WorkStore = { route: string; isStaticGeneration: boolean };
type Storage<T> = { run<R>(store: T, callback: () => R): R; getStore(): T | undefined };

type NextInternals = {
  version: string;
  createRequestStoreForAPI: (
    req: { headers: Headers },
    url: { pathname: string; search: string },
    implicitTags: ImplicitTags,
    onUpdateCookies: undefined,
    previewProps: undefined,
  ) => RequestStore;
  createWorkStore: (context: {
    page: string;
    renderOpts: Record<string, unknown>;
    buildId: string;
    previouslyRevalidatedTags: string[];
  }) => WorkStore;
  workAsyncStorage: Storage<WorkStore>;
  workUnitAsyncStorage: Storage<RequestStore>;
  appendMutableCookies: (headers: Headers, mutableCookies: unknown) => boolean;
};

let internals: NextInternals | undefined;

/** Install Node's AsyncLocalStorage where Next looks for it; must run before Next is imported. */
export function installAsyncLocalStorage(): void {
  const scope = globalThis as { AsyncLocalStorage?: unknown };
  if (scope.AsyncLocalStorage === undefined) scope.AsyncLocalStorage = AsyncLocalStorage;
  if (scope.AsyncLocalStorage !== AsyncLocalStorage) {
    throw new NextContextError("globalThis.AsyncLocalStorage is not node:async_hooks");
  }
}

/** Load and verify the pinned Next internals (memoized). */
export function nextInternals(): NextInternals {
  if (internals) return internals;
  if ((globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage !== AsyncLocalStorage) {
    throw new NextContextError(
      "globalThis.AsyncLocalStorage must be installed before Next is imported (setup file)",
    );
  }
  const fromWeb = createRequire(WEB_PACKAGE);
  const version = (fromWeb("next/package.json") as { version: string }).version;
  if (version !== PINNED_NEXT_VERSION) {
    throw new NextContextError(`Next ${version} is not the pinned ${PINNED_NEXT_VERSION}`);
  }
  // `next/headers` (what lib/auth.ts imports) and these internals must be the same module copy,
  // otherwise the stores entered here are invisible to `cookies()`.
  const headersFile = realpathSync(fromWeb.resolve("next/headers"));
  const workFile = realpathSync(
    fromWeb.resolve("next/dist/server/app-render/work-async-storage.external"),
  );
  if (dirname(headersFile) !== resolve(dirname(workFile), "../../..")) {
    throw new NextContextError("next/headers and Next internals resolve to different copies");
  }
  const loaded: NextInternals = {
    version,
    createRequestStoreForAPI: (
      fromWeb("next/dist/server/async-storage/request-store") as Pick<
        NextInternals,
        "createRequestStoreForAPI"
      >
    ).createRequestStoreForAPI,
    createWorkStore: (
      fromWeb("next/dist/server/async-storage/work-store") as Pick<NextInternals, "createWorkStore">
    ).createWorkStore,
    workAsyncStorage: (
      fromWeb("next/dist/server/app-render/work-async-storage.external") as {
        workAsyncStorage: Storage<WorkStore>;
      }
    ).workAsyncStorage,
    workUnitAsyncStorage: (
      fromWeb("next/dist/server/app-render/work-unit-async-storage.external") as {
        workUnitAsyncStorage: Storage<RequestStore>;
      }
    ).workUnitAsyncStorage,
    appendMutableCookies: (
      fromWeb("next/dist/server/web/spec-extension/adapters/request-cookies") as Pick<
        NextInternals,
        "appendMutableCookies"
      >
    ).appendMutableCookies,
  };
  for (const [name, value] of Object.entries(loaded)) {
    if (value === undefined) throw new NextContextError(`Next internal ${name} is missing`);
  }
  // Next falls back to a FakeAsyncLocalStorage whose run() throws and getStore() is always
  // undefined; prove both storages are real.
  for (const [name, storage] of [
    ["workAsyncStorage", loaded.workAsyncStorage],
    ["workUnitAsyncStorage", loaded.workUnitAsyncStorage],
  ] as const) {
    const marker = { probe: name } as never;
    let seen: unknown;
    try {
      seen = storage.run(marker, () => storage.getStore());
    } catch {
      throw new NextContextError(`${name} is not a real AsyncLocalStorage`);
    }
    if (seen !== marker) throw new NextContextError(`${name} did not retain its store`);
  }
  internals = loaded;
  return loaded;
}

/** Whether any Next work or work-unit store is visible from the caller. */
export function activeNextStores(): { work: boolean; workUnit: boolean } {
  const next = nextInternals();
  return {
    work: next.workAsyncStorage.getStore() !== undefined,
    workUnit: next.workUnitAsyncStorage.getStore() !== undefined,
  };
}

/**
 * Run `callback` inside a fresh dynamic API-route request context for `request`, as Next 15.5's
 * app-route module does. Each call creates its own stores (no sharing across calls).
 */
export function runInRouteContext<T>(
  request: Request,
  page: string,
  callback: () => Promise<T>,
): Promise<{ result: T; requestStore: RequestStore; workStore: WorkStore }> {
  const next = nextInternals();
  const url = new URL(request.url);
  const requestStore = next.createRequestStoreForAPI(
    request,
    { pathname: url.pathname, search: url.search },
    { tags: [], expirationsByCacheKind: new Map() },
    undefined,
    undefined,
  );
  const workStore = next.createWorkStore({
    page,
    renderOpts: {
      supportsDynamicResponse: true,
      dev: false,
      experimental: { isRoutePPREnabled: false, cacheComponents: false, authInterrupts: false },
    },
    buildId: G1_BUILD_ID,
    previouslyRevalidatedTags: [],
  });
  if (requestStore.type !== "request" || requestStore.phase !== "action") {
    throw new NextContextError("request store is not a dynamic API request store");
  }
  if (workStore.isStaticGeneration) throw new NextContextError("work store is static");
  return next.workAsyncStorage.run(workStore, () =>
    next.workUnitAsyncStorage.run(requestStore, async () => ({
      result: await callback(),
      requestStore,
      workStore,
    })),
  );
}

/**
 * Invoke a route handler in its own request context and merge cookies the handler set through
 * `cookies()` into the response, exactly as the app-route module does after the handler returns.
 */
export async function invokeRouteHandler(
  request: Request,
  page: string,
  handler: () => Promise<Response> | Response,
): Promise<Response> {
  const next = nextInternals();
  const { result, requestStore } = await runInRouteContext(request, page, async () => handler());
  const headers = new Headers(result.headers);
  if (next.appendMutableCookies(headers, requestStore.mutableCookies)) {
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers,
    });
  }
  return result;
}
