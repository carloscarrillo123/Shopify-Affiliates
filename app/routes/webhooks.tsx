import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, session, payload } = await authenticate.webhook(request);

  console.log(`[Webhook] topic=${topic} shop=${shop}`);

  switch (topic) {
    case "APP_UNINSTALLED":
      if (session) {
        await db.session.deleteMany({ where: { shop } });
        await db.appSubscription.updateMany({
          where: { shop },
          data: { status: "CANCELLED" },
        });
      }
      break;

    default:
      console.log(`[Webhook] Unhandled topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
}
