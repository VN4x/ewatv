import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isPlayoutBackend } from "@/lib/playout-backend/config";
import { isLoggedIn, clearSession } from "@/lib/playout-backend/auth-store";
import { Button } from "@/components/ui/button";
import { Tv, Library, Calendar, MonitorPlay, LogOut, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const playout = isPlayoutBackend();

  useEffect(() => {
    let mounted = true;
    if (playout) {
      if (!isLoggedIn()) {
        navigate({ to: "/login", replace: true });
      } else {
        setAuthed(true);
        setChecking(false);
      }
      return;
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return;
      if (!session) {
        navigate({ to: "/login", replace: true });
      } else {
        setAuthed(true);
        setChecking(false);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        navigate({ to: "/login", replace: true });
      } else {
        setAuthed(true);
        setChecking(false);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, playout]);

  if (checking || !authed) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const nav = [
    { to: "/collections", label: "Collections", icon: Library },
    { to: "/schedules", label: "Schedules", icon: Calendar },
    { to: "/playout", label: "Playout", icon: MonitorPlay },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link to="/collections" className="flex items-center gap-2 font-semibold">
              <Tv className="h-5 w-5 text-primary" />
              ewatv
              {playout && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                  GO
                </span>
              )}
            </Link>
            <nav className="flex items-center gap-1">
              {nav.map((n) => {
                const active = path.startsWith(n.to);
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                      active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <n.icon className="h-4 w-4" />
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (playout) {
                  clearSession();
                } else {
                  await supabase.auth.signOut();
                }
                navigate({ to: "/login", replace: true });
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
