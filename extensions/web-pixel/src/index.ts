import { register } from "@shopify/web-pixels-extension";

const AFFILIATE_KEY = "affiliate_ref";

register(({ analytics, browser, settings }) => {
  const apiUrl = (settings as any).apiUrl as string;
  if (!apiUrl) return;
  analytics.subscribe("page_viewed", async (event) => {
    try {
      const href = event.context?.document?.location?.href ?? "";
      const url = new URL(href);
      const ref = url.searchParams.get("ref");
      if (ref) {
        await browser.sessionStorage.setItem(AFFILIATE_KEY, ref.toUpperCase());
        await browser.cookie.set("_affiliate_ref", ref.toUpperCase(), {
          maxAge: 30 * 24 * 60 * 60,
          sameSite: "Lax",
          secure: true,
        });
      }
    } catch (_) {}
  });

  analytics.subscribe("checkout_completed", async (event) => {
    try {
      const affiliateCode =
        (await browser.sessionStorage.getItem(AFFILIATE_KEY)) ||
        (await browser.cookie.get("_affiliate_ref"));

      if (!affiliateCode) return;

      const order = event.data?.checkout;
      if (!order) return;

      const shop = event.context?.shop?.myshopifyDomain
        || (settings as any).shop
        || "afiliate-1.myshopify.com";
      const orderId = String(order.order?.id ?? order.token ?? "");
      const orderName = order.order?.name || "";
      const orderTotal = parseFloat(
        String(order.totalPrice?.amount ?? order.subtotalPrice?.amount ?? 0)
      );
      const currency = order.currencyCode ?? "USD";

      if (!orderId || orderTotal <= 0 || !shop) return;

      const secret = ((settings as any).signingSecret as string) || "change-me-in-production";

      const timestamp = Date.now();
      const signature = await generateHmacSignature(
        shop,
        affiliateCode,
        orderId,
        orderTotal,
        timestamp,
        secret
      );

      const payload = {
        shop,
        affiliateCode,
        orderId,
        orderName,
        orderTotal,
        currency,
        timestamp,
        signature,
      };

      await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });

      await browser.sessionStorage.removeItem(AFFILIATE_KEY);
    } catch (err) {
      console.error("[WebPixel] Error processing conversion:", err);
    }
  });
});

async function generateHmacSignature(
  shop: string,
  affiliateCode: string,
  orderId: string,
  orderTotal: number,
  timestamp: number,
  secret: string
): Promise<string> {
  const data = `${shop}:${affiliateCode}:${orderId}:${orderTotal}:${timestamp}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, msgData);
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
