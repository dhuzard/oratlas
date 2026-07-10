"use server";
import { redirect } from "next/navigation";
import { AuthError, destroySession, mockLogin } from "@/lib/auth";

export async function mockSignInAction(formData: FormData): Promise<void> {
  const role = formData.get("role") === "EDITOR" ? "EDITOR" : "USER";
  try {
    await mockLogin(role);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect(`/signin?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(role === "EDITOR" ? "/editorial" : "/submit");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}
