import { installAsyncLocalStorage } from "./next-request-context.js";

// Dedicated G1 Vitest setup file: must run before any Next.js module is imported (Next captures
// `globalThis.AsyncLocalStorage` once at module load and otherwise falls back to a fake storage).
installAsyncLocalStorage();
