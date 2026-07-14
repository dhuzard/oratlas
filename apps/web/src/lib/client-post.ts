"use client";

/**
 * Shared client-side JSON POST for editorial forms. Returns null on success
 * or the API error envelope's message for display.
 */
export async function postJson(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const payload = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return payload?.error?.message ?? `Request failed (${res.status}).`;
}
