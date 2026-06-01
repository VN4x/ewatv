import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tv } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ewatv — headless linear TV" },
      { name: "description", content: "Run your own 24/7 linear TV channel with frame-accurate scheduling and smooth playout." },
      { property: "og:title", content: "ewatv — headless linear TV" },
      { property: "og:description", content: "Run your own 24/7 linear TV channel with frame-accurate scheduling and smooth playout." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/collections", replace: true });
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <Tv className="h-7 w-7" />
      </div>
      <h1 className="text-4xl font-semibold tracking-tight">ewatv</h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        Headless 24/7 linear TV. Organize your library, build frame-accurate schedules, stream smoothly.
      </p>
      <div className="mt-6 flex gap-2">
        <Button asChild>
          <Link to="/login">Sign in</Link>
        </Button>
      </div>
    </div>
  );
}
