import { createFileRoute } from "@tanstack/react-router";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAutopilotJobs } from "@/lib/schedule/autopilot-cron.server";

function assertCronSecret(request: Request) {
  const expected = process.env.AUTOPILOT_CRON_SECRET;
  if (!expected) {
    throw new Response(JSON.stringify({ error: "AUTOPILOT_CRON_SECRET not configured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  const bearer = request.headers.get("authorization");
  const headerSecret =
    (bearer?.startsWith("Bearer ") ? bearer.slice(7) : null) ??
    request.headers.get("x-cron-secret");
  if (headerSecret !== expected) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
}

export const Route = createFileRoute("/api/cron/autopilot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        assertCronSecret(request);
        const result = await runAutopilotJobs(supabaseAdmin);
        return Response.json({ ok: true, ...result });
      },
      GET: async ({ request }) => {
        assertCronSecret(request);
        return Response.json({
          ok: true,
          message: "ewatv autopilot cron endpoint — POST to run jobs",
        });
      },
    },
  },
});
