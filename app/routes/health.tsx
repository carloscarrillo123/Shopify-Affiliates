import type { LoaderFunctionArgs } from "react-router";
import { db } from "~/db.server";

export async function loader(_: LoaderFunctionArgs) {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok", timestamp: new Date().toISOString() });
  } catch {
    return Response.json(
      { status: "degraded", db: "error", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
