import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAutopilotJobs } from "@/lib/schedule/autopilot-cron.server";

function checkCronSecret(request: Request): Response | null {
  const expected = process.env.AUTOPILOT_CRON_SECRET;
  if (!expected) {
    return Response.json({ error: "AUTOPILOT_CRON_SECRET not configured" }, { status: 503 });
  }
  const bearer = request.headers.get("authorization");
  const headerSecret =
    (bearer?.startsWith("Bearer ") ? bearer.slice(7) : null) ??
    request.headers.get("x-cron-secret");
  if (headerSecret !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export const Route = createFileRoute("/api/cron/autopilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const deny = checkCronSecret(request);
        if (deny) return deny;
        const result = await runAutopilotJobs(supabaseAdmin);
        return Response.json({ ok: true, ...result });
      },
      GET: async ({ request }) => {
        const deny = checkCronSecret(request);
        if (deny) return deny;
        return Response.json({
          ok: true,
          message: "ewatv autopilot cron endpoint — POST to run jobs",
        });
      },
    },
  },
});
