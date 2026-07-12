import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "./lib/content-security-policy";

export function middleware(request: NextRequest) {
  // 128 bits of request-local entropy, represented using CSP nonce-safe hex.
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const policy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");
  const requestHeaders = new Headers(request.headers);

  // Next.js reads the nonce from the request CSP and applies it to framework
  // scripts. Server components use x-nonce for application-owned scripts.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
