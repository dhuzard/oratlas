import { expect, type Page } from "@playwright/test";

/**
 * The mock sign-in action redirects to a page the dev server may not have
 * compiled yet. Measured on a cold server that first redirect takes several
 * seconds (a warm one about one second), longer than the default 5 s
 * assertion. Only this redirect gets the larger allowance, so passing runs
 * are not slowed and a broken redirect still fails.
 */
export const SIGN_IN_REDIRECT_TIMEOUT_MS = 45_000;

const ROLES = {
  submitter: { button: /Sign in as submitter/, landing: /\/submit/ },
  editor: { button: /Sign in as editor/, landing: /\/editorial/ },
} as const;

export async function signInAs(page: Page, role: keyof typeof ROLES): Promise<void> {
  await page.goto("/signin");
  await page.getByRole("button", { name: ROLES[role].button }).click();
  await expect(page).toHaveURL(ROLES[role].landing, { timeout: SIGN_IN_REDIRECT_TIMEOUT_MS });
}
