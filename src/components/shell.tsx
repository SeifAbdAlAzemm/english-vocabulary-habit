import Link from "next/link";
import { signOut } from "@/app/actions";

export function Shell({ children, active }: { children: React.ReactNode; active: "home" | "session" | "words" }) {
  return <div className="app-shell">
    <header className="site-header">
      <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">v<span>h</span></span><span>Vocabulary Habit<small>SMALL PRACTICE. LASTING WORDS.</small></span></Link>
      <nav aria-label="Main navigation"><Link aria-current={active === "home" ? "page" : undefined} href="/">Dashboard</Link><Link aria-current={active === "words" ? "page" : undefined} href="/words">My Words</Link><span className="nav-soon">Review <small>soon</small></span><span className="nav-soon">Progress <small>soon</small></span></nav>
      <form action={signOut}><button className="text-button">Sign out</button></form>
    </header>
    <main id="main" className="page-content">{children}</main>
    <footer className="site-footer"><span>Learn → Produce → Get feedback → Retrieve → Measure</span><span>14-day pilot · A fresh start</span></footer>
  </div>;
}
