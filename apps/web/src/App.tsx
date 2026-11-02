import { Link, NavLink, Outlet } from "react-router-dom";
import { useSelector } from "react-redux";
import { useCurrentUserQuery, useLoginMutation } from "./services/api";
import type { RootState } from "./store";

function message(error: unknown): string {
  if (typeof error === "object" && error && "data" in error) {
    const body = (error as { data?: { error?: { message?: string } } }).data;
    if (body?.error?.message) return body.error.message;
  }
  return "We could not complete that request. Please try again.";
}

function SignIn() {
  const [login, result] = useLoginMutation();
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await login({ email: String(form.get("email")), password: String(form.get("password")), ...(String(form.get("totpCode")).trim() ? { totpCode: String(form.get("totpCode")).trim() } : {}) });
  };
  return <main className="auth-wrap"><div className="auth-card">
    <Link className="brand" to="/courses"><span className="brand-mark">L</span> LearnSphere</Link>
    <div className="eyebrow">YOUR LEARNING WORKSPACE</div><h1>Sign in to continue</h1><p className="muted">Use your LearnSphere account to teach or continue learning.</p>
    <form onSubmit={submit} className="stack-form">
      <label>Email address<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <label>Authenticator code <span className="optional">If enabled</span><input name="totpCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></label>
      {result.isError && <p className="inline-error" role="alert">{message(result.error)}</p>}
      <button className="button primary full" disabled={result.isLoading}>{result.isLoading ? "Signing in…" : "Sign in"}</button>
    </form>
  </div></main>;
}

export function App() {
  const session = useCurrentUserQuery();
  const expired = useSelector((state: RootState) => state.session.expired);
  if (expired) return <SignIn />;
  if (session.isLoading) return <div className="center-state"><span className="spinner" />Restoring your session…</div>;
  if (session.isError) {
    const status = (session.error as { status?: number | string }).status;
    if (status === 401) return <SignIn />;
    return <main className="center-state"><h1>LearnSphere is unavailable</h1><p className="muted">{message(session.error)}</p><button className="button secondary" onClick={() => void session.refetch()}>Try again</button></main>;
  }
  const user = session.data?.data.user;
  return <div className="app-shell">
    <header className="topbar">
      <Link className="brand" to="/courses"><span className="brand-mark">L</span> LearnSphere</Link>
      <nav className="main-nav" aria-label="Main navigation">
        <NavLink to="/courses">Discover</NavLink><NavLink to="/learn">My learning</NavLink><NavLink to="/teach">Teach</NavLink>
      </nav>
      <div className="profile-chip"><span className="avatar">{user?.displayName?.slice(0, 1).toUpperCase() ?? "L"}</span><span>{user?.displayName ?? user?.email}</span></div>
    </header>
    <Outlet />
    <footer className="site-footer"><span>LearnSphere</span><span>Make progress, one lesson at a time.</span></footer>
  </div>;
}

export { message };
