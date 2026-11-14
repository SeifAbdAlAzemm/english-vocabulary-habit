"use client";
import { useActionState } from "react";
import { signIn } from "@/app/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, { error: "" });
  return <form action={action} className="stack">
    <label>Email address<input autoComplete="username" type="email" name="email" required maxLength={254} placeholder="you@example.com" /></label>
    <label>Password<input autoComplete="current-password" type="password" name="password" required maxLength={1024} /></label>
    {state.error && <p role="alert" className="error-message">{state.error}</p>}
    <button className="button" disabled={pending}>{pending ? "Signing in…" : "Sign in →"}</button>
  </form>;
}
