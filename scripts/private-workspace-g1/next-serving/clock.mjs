import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

// Trusted test preload: Date only. No timers, performance clock or RNG are mocked.
const fixed = Date.parse("2026-04-01T00:00:00.000Z");
const NativeDate = Date;
globalThis.Date = new Proxy(NativeDate, {
  apply() {
    return new NativeDate(fixed).toString();
  },
  construct(target, args, newTarget) {
    return Reflect.construct(target, args.length ? args : [fixed], newTarget);
  },
  get(target, property, receiver) {
    if (property === "now") return () => fixed;
    return Reflect.get(target, property, receiver);
  },
});
// The tested routes must not initiate HTTP/provider fetches. This is a Node
// guard, not an OS firewall; native engines and child processes are separate.
globalThis.fetch = async () => {
  throw new Error("G1 serving outbound fetch refused");
};
for (const transport of [http, https]) {
  transport.request = transport.get = () => {
    throw new Error("G1 serving outbound HTTP refused");
  };
}
syncBuiltinESMExports();
