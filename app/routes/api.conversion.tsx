import type { ActionFunctionArgs } from "react-router";
import { db } from "~/db.server";
import shopify from "~/shopify.server";
import crypto from "crypto";

const APP_FEE_RATE = 0.05;

interface ConversionPayload {
  shop: string;
  affiliateCode: string;
  orderId: string;
  orderName?: string;
  orderTotal: number;
  currency?: string;
  signature: string;
  timestamp: number;
}

function verifySignature(payload: Omit<ConversionPayload, "signature">, signature: string): boolean {
  const secret = process.env.PIXEL_SIGNING_SECRET || "change-me-in-production";
  const data = `${payload.shop}:${payload.affiliateCode}:${payload.orderId}:${payload.orderTotal}:${payload.timestamp}`;
  const expected = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsJson(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export async function loader({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return corsJson({ error: "Method not allowed" }, 405);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return corsJson({ error: "Method not allowed" }, 405);
  }

  let payload: ConversionPayload;
  try {
    payload = await request.json();
  } catch {
    return corsJson({ error: "Invalid JSON" }, 400);
  }

  const { shop, affiliateCode, orderId, orderName, orderTotal, currency, signature, timestamp } = payload;

  if (!shop || !affiliateCode || !orderId || !orderTotal || !signature || !timestamp) {
    return corsJson({ error: "Missing required fields" }, 400);
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
    return corsJson({ error: "Request expired" }, 401);
  }

  if (!verifySignature({ shop, affiliateCode, orderId, orderName, orderTotal, currency, timestamp }, signature)) {
    return corsJson({ error: "Invalid signature" }, 401);
  }

  const affiliate = await db.affiliate.findUnique({
    where: { shop_code: { shop, code: affiliateCode.toUpperCase() } },
  });

  if (!affiliate || !affiliate.isActive) {
    return corsJson({ error: "Affiliate not found or inactive" }, 404);
  }

  const existing = await db.conversion.findUnique({
    where: { shop_orderId: { shop, orderId } },
  });
  if (existing) {
    return corsJson({ message: "Conversion already processed", id: existing.id });
  }

  const appFee = parseFloat((orderTotal * APP_FEE_RATE).toFixed(2));
  const affiliatePayout = parseFloat((orderTotal * (affiliate.commissionPct / 100)).toFixed(2));

  const conversion = await db.conversion.create({
    data: {
      shop,
      affiliateId: affiliate.id,
      orderId,
      orderName: orderName || `#${orderId}`,
      orderTotal,
      appFee,
      affiliatePayout,
      currency: currency ?? "USD",
      status: "pending",
    },
  });

  let billingChargeId: string | null = null;
  let billingError: string | null = null;

  try {
    const subscription = await db.appSubscription.findUnique({ where: { shop } });
    if (!subscription || subscription.status !== "ACTIVE") {
      throw new Error("No active subscription");
    }

    const session = await (shopify.sessionStorage as any).loadSession(`offline_${shop}`);
    if (!session) throw new Error("Session not found");

    const { admin } = await shopify.authenticate.admin(
      new Request(`https://${shop}/admin`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
    );

    const chargeResult = await createUsageRecordWithRetry(
      admin,
      subscription.subscriptionId,
      appFee
    );

    billingChargeId = chargeResult.id;

    await db.$transaction([
      db.conversion.update({
        where: { id: conversion.id },
        data: { status: "processed", billingChargeId, processedAt: new Date() },
      }),
      db.appSubscription.update({
        where: { shop },
        data: { currentBalance: { increment: appFee } },
      }),
    ]);
  } catch (err) {
    billingError = err instanceof Error ? err.message : "Unknown billing error";
    console.error(`[BillingError] shop=${shop} order=${orderId}`, err);
  }

  return new Response(
    JSON.stringify({ success: true, conversionId: conversion.id, appFee, affiliatePayout, billingChargeId, billingError }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
}

async function createUsageRecordWithRetry(
  admin: any,
  subscriptionId: string,
  fee: number,
  maxRetries = 3
): Promise<{ id: string }> {
  const mutation = `#graphql
    mutation appUsageRecordCreate($subscriptionLineItemId: ID!, $price: MoneyInput!, $description: String!) {
      appUsageRecordCreate(
        subscriptionLineItemId: $subscriptionLineItemId
        price: $price
        description: $description
      ) {
        userErrors { field message }
        appUsageRecord { id }
      }
    }
  `;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await admin.graphql(mutation, {
        variables: {
          subscriptionLineItemId: subscriptionId,
          price: { amount: fee.toFixed(2), currencyCode: "USD" },
          description: `Affiliate Engine service fee — 5% of referred sale`,
        },
      });

      const data = await response.json();
      const result = data?.data?.appUsageRecordCreate;

      if (result?.userErrors?.length > 0) {
        const errorMsg = result.userErrors.map((e: any) => e.message).join(", ");
        throw new Error(`GraphQL userErrors: ${errorMsg}`);
      }

      return { id: result.appUsageRecord.id };
    } catch (err: any) {
      const isThrottled =
        err?.message?.includes("THROTTLED") ||
        err?.extensions?.code === "THROTTLED";

      if (isThrottled && attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 1000;
        console.warn(`[RateLimit] Attempt ${attempt}/${maxRetries}, retrying in ${backoff}ms`);
        await new Promise((res) => setTimeout(res, backoff));
        continue;
      }

      throw err;
    }
  }

  throw new Error("Max retries exceeded for usage record creation");
}

