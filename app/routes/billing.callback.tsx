import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);

  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");

  if (!chargeId) {
    return redirect("/app?billing=failed");
  }

  try {
    const response = await (billing as any).check({ plans: ["Affiliate Engine Plan"] });

    const sub = response?.appSubscriptions?.[0];
    if (sub) {
      const lineItem = sub.lineItems?.find((li: any) => li.plan?.appUsagePricingDetails);

      await db.appSubscription.upsert({
        where: { shop: session.shop },
        create: {
          shop: session.shop,
          subscriptionId: lineItem?.id ?? sub.id,
          status: sub.status,
          cappedAmount: lineItem?.plan?.appUsagePricingDetails?.cappedAmount?.amount ?? 100.0,
        },
        update: {
          subscriptionId: lineItem?.id ?? sub.id,
          status: sub.status,
        },
      });
    }
  } catch (err) {
    console.error("[Billing Callback Error]", err);
  }

  return redirect("/app?billing=success");
}
