import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { isPlayoutBackend } from "@/lib/playout-backend/config";
import { playoutAuth } from "@/lib/playout-backend/api";
import { setSession, isLoggedIn } from "@/lib/playout-backend/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Tv } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — ewatv" },
      { name: "description", content: "Sign in to manage your linear TV channels." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const playout = isPlayoutBackend();

  useEffect(() => {
    if (playout) {
      if (isLoggedIn()) navigate({ to: "/collections", replace: true });
      return;
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate({ to: "/collections", replace: true });
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/collections", replace: true });
    });
    return () => subscription.unsubscribe();
  }, [navigate, playout]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (playout) {
        const res =
          mode === "signup"
            ? await playoutAuth.register(email, password)
            : await playoutAuth.login(email, password);
        setSession(res.token, {
          id: String(res.user.id),
          email: res.user.email,
          role: res.user.role ?? "user",
          display_name: res.user.display_name,
        });
        navigate({ to: "/collections", replace: true });
        toast.success(mode === "signup" ? "Account created" : "Signed in");
        return;
      }
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/collections` },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (playout) {
      toast.error("Google sign-in is not available in standalone playout mode");
      return;
    }
    setLoading(true);
    const res = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/collections",
    });
    if (res.error) {
      toast.error(res.error.message ?? "Google sign-in failed");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Tv className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">ewatv</CardTitle>
          <CardDescription>
            {playout
              ? "Standalone playout control room"
              : mode === "signin"
                ? "Sign in to your control room"
                : "Create your account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!playout && (
            <>
              <Button onClick={handleGoogle} disabled={loading} variant="outline" className="w-full">
                Continue with Google
              </Button>
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}
          <form onSubmit={handleEmail} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <p className="text-center text-sm text-muted-foreground">
            {mode === "signin" ? "No account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="font-medium text-primary hover:underline"
            >
              {mode === "signin" ? "Sign up" : "Sign in"}
            </button>
          </p>
          {playout && (
            <p className="text-center text-xs text-muted-foreground">
              Backend: {import.meta.env.VITE_PLAYOUT_API ?? "localhost:8090"}
            </p>
          )}
          <p className="text-center text-xs text-muted-foreground">
            <Link to="/" className="hover:underline">← Back to home</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
