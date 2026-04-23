import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { db } from "~/db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(db),
  distribution: AppDistribution.AppStore,
  hooks: {
    afterAuth: async ({ session }: { session: any }) => {
      shopify.registerWebhooks({ session });
    },
  },
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: "http" as any,
      callbackUrl: "/webhooks",
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
});

async function requestBillingIfNeeded(session: any): Promise<void> {
  try {
    const existing = await db.appSubscription.findUnique({
      where: { shop: session.shop },
    });

    if (existing?.status === "ACTIVE") return;

    const { admin } = await shopify.authenticate.admin(
      new Request(`https://${session.shop}/admin`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
    );

    const response = await admin.graphql(
      `#graphql
      mutation appSubscriptionCreate($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!) {
        appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems, test: true) {
          userErrors { field message }
          appSubscription { id status }
          confirmationUrl
        }
      }`,
      {
        variables: {
          name: "Affiliate Engine Plan",
          returnUrl: `${process.env.SHOPIFY_APP_URL}/billing/callback`,
          lineItems: [
            {
              plan: {
                appUsagePricingDetails: {
                  cappedAmount: { amount: "100.00", currencyCode: "USD" },
                  terms: "5% service fee on each referred sale. Max $100/month.",
                },
              },
            },
          ],
        },
      }
    );

    const responseData = await response.json();
    const sub = responseData?.data?.appSubscriptionCreate?.appSubscription;
    if (sub?.id) {
      await db.appSubscription.upsert({
        where: { shop: session.shop },
        create: {
          shop: session.shop,
          subscriptionId: sub.id,
          status: sub.status,
        },
        update: {
          subscriptionId: sub.id,
          status: sub.status,
        },
      });
    }
  } catch (err) {
    console.error("[Billing] Failed to create subscription:", err);
  }
}

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
