import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { fetchCurrentUser, type CurrentUser } from "../lib/auth";

const navClass = ({ isActive }: { isActive: boolean }): string =>
  `text-sm font-medium ${isActive ? "text-slate-900" : "text-slate-500 hover:text-slate-800"}`;

export function Layout(): JSX.Element {
  const [user, setUser] = useState<CurrentUser | null>(null);
  useEffect(() => {
    void fetchCurrentUser().then(setUser);
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link to="/" className="text-base font-semibold tracking-tight text-slate-900">
              Marketing Copilot
            </Link>
            <nav className="flex gap-4" aria-label="Hauptnavigation">
              <NavLink to="/" end className={navClass}>
                Website Auditor
              </NavLink>
              <NavLink to="/audits" className={navClass}>
                Verlauf
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            {user && <span title={user.userId}>{user.userDetails}</span>}
            <a href="/.auth/logout" className="text-slate-500 hover:text-slate-800">
              Abmelden
            </a>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
