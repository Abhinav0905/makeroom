import { integrationStatus } from "@/lib/config";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    {
      application: "MakeRoom",
      status: "ok",
      payments: "sandbox-only",
      integrations: integrationStatus(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
