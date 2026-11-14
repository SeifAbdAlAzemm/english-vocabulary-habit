import { LoginForm } from "@/components/login-form";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (configured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) redirect("/");
  }
  return <main id="main" className="login-page"><section className="login-story"><span className="eyebrow">ENGLISH VOCABULARY HABIT</span><h1>A little practice.<br />Words that stay.</h1><p>Understand a word. Make it your own.<br />Come back and remember it.</p><div className="word-art" aria-hidden="true"><span>analysis</span><span>approach</span><span>one day at a time.</span></div><small>Your personal 14-day learning pilot</small></section><section className="login-panel"><div className="card login-card"><span className="eyebrow">YOUR LEARNING SPACE</span><h2>Welcome back.</h2><p className="muted">Sign in to keep your words and original work together.</p>{configured ? <LoginForm /> : <p role="alert" className="notice">Add the two Supabase variables from .env.example to .env.local, then restart the app.</p>}<p className="fine-print">Use your learner account created in Supabase Authentication. Account creation is managed privately.</p></div></section></main>;
}
