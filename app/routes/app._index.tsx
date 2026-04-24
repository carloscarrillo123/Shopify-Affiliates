import { data, redirect } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "react-router";
import { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineGrid,
  Box,
  Divider,
  Banner,
  Button,
  InlineStack,
  TextField,
  FormLayout,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";

async function ensureWebPixel(admin: any, appUrl: string) {
  const pixelSettings = JSON.stringify({
    affiliateCode: "TRACKING",
    apiUrl: `${appUrl}/api/conversion`,
  });

  try {
    // Try create first; if already exists, update instead
    const createRes = await admin.graphql(
      `#graphql
      mutation webPixelCreate($webPixel: WebPixelInput!) {
        webPixelCreate(webPixel: $webPixel) {
          userErrors { field message code }
          webPixel { id }
        }
      }`,
      { variables: { webPixel: { settings: pixelSettings } } }
    );
    const createData = await createRes.json();
    const errors = createData?.data?.webPixelCreate?.userErrors ?? [];
    const alreadyExists = errors.some((e: any) =>
      e.message?.toLowerCase().includes("already") || e.code === "TAKEN"
    );

    if (alreadyExists) {
      const updateRes = await admin.graphql(
        `#graphql
        mutation webPixelUpdate($webPixel: WebPixelInput!) {
          webPixelUpdate(webPixel: $webPixel) {
            userErrors { field message }
            webPixel { id }
          }
        }`,
        { variables: { webPixel: { settings: pixelSettings } } }
      );
      const updateData = await updateRes.json();
      console.log("[Pixel] updated:", JSON.stringify(updateData?.data?.webPixelUpdate?.webPixel));
    } else if (errors.length > 0) {
      console.error("[Pixel] create errors:", errors);
    } else {
      console.log("[Pixel] created:", JSON.stringify(createData?.data?.webPixelCreate?.webPixel));
    }
  } catch (err: any) {
    if (err?.body instanceof ReadableStream) {
      const text = await new Response(err.body).text();
      console.error("[Pixel] HTTP error body:", text);
    } else {
      console.error("[Pixel] Failed:", err?.message ?? err);
    }
  }
}

async function createBillingSubscription(
  admin: any,
  shop: string,
  appUrl: string,
  cappedAmount: number
) {
  const amount = cappedAmount.toFixed(2);
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
        returnUrl: `${appUrl}/billing/callback`,
        lineItems: [
          {
            plan: {
              appUsagePricingDetails: {
                cappedAmount: { amount, currencyCode: "USD" },
                terms: `5% service fee on each referred sale. Max $${amount}/month.`,
              },
            },
          },
        ],
      },
    }
  );

  const resData = await response.json();
  const sub = resData?.data?.appSubscriptionCreate?.appSubscription;
  const confirmationUrl = resData?.data?.appSubscriptionCreate?.confirmationUrl;

  if (sub?.id) {
    await db.appSubscription.upsert({
      where: { shop },
      create: { shop, subscriptionId: sub.id, status: sub.status, cappedAmount },
      update: { subscriptionId: sub.id, status: sub.status, cappedAmount },
    });
  }

  return confirmationUrl ?? null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const appUrl = process.env.SHOPIFY_APP_URL || "";

  if (process.env.NODE_ENV !== "development") {
    await ensureWebPixel(admin, appUrl);
  }

  const existingSub = await db.appSubscription.findUnique({ where: { shop } });
  if (!existingSub || existingSub.status !== "ACTIVE") {
    return data({ needsBilling: true as const });
  }

  const [totalConversions, affiliatesCount, subscription] = await Promise.all([
    db.conversion.aggregate({
      where: { shop },
      _sum: { orderTotal: true, affiliatePayout: true, appFee: true },
      _count: true,
    }),
    db.affiliate.count({ where: { shop, isActive: true } }),
    db.appSubscription.findUnique({ where: { shop } }),
  ]);

  const recentConversions = await db.conversion.findMany({
    where: { shop },
    include: { affiliate: { select: { name: true, code: true } } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const affiliates = await db.affiliate.findMany({
    where: { shop, isActive: true },
    select: { id: true, code: true, name: true },
  });

  return data({
    metrics: {
      totalReferredSales: totalConversions._sum.orderTotal ?? 0,
      totalAppFees: totalConversions._sum.appFee ?? 0,
      totalAffiliatePayout: totalConversions._sum.affiliatePayout ?? 0,
      conversionCount: totalConversions._count,
      activeAffiliates: affiliatesCount,
    },
    subscription: subscription
      ? {
          status: subscription.status,
          cappedAmount: subscription.cappedAmount,
          currentBalance: subscription.currentBalance,
        }
      : null,
    recentConversions,
    affiliates,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "activate_billing") {
    const raw = parseFloat(formData.get("cappedAmount") as string);
    const cappedAmount = isNaN(raw) || raw < 1 ? 100 : raw;

    if (process.env.NODE_ENV === "development") {
      await db.appSubscription.upsert({
        where: { shop },
        create: { shop, subscriptionId: "dev-mock", status: "ACTIVE", cappedAmount },
        update: { status: "ACTIVE", cappedAmount },
      });
      return redirect("/");
    }

    const appUrl = process.env.SHOPIFY_APP_URL || "";
    try {
      const confirmationUrl = await createBillingSubscription(admin, shop, appUrl, cappedAmount);
      if (confirmationUrl) return data({ confirmationUrl });
    } catch (err) {
      console.error("[Billing] Action error:", err);
    }
    return data({ error: "Could not create billing subscription." });
  }

  const affiliateId = formData.get("affiliateId") as string;

  const affiliate = await db.affiliate.findFirst({ where: { id: affiliateId, shop } });
  if (!affiliate) return data({ error: "Affiliate not found" }, { status: 404 });

  const orderTotal = 99.99;
  const appFee = parseFloat((orderTotal * 0.05).toFixed(2));
  const affiliatePayout = parseFloat((orderTotal * (affiliate.commissionPct / 100)).toFixed(2));
  const orderId = `test-${Date.now()}`;

  await db.conversion.create({
    data: {
      shop,
      affiliateId: affiliate.id,
      orderId,
      orderName: `#TEST-${Math.floor(Math.random() * 9000) + 1000}`,
      orderTotal,
      appFee,
      affiliatePayout,
      currency: "USD",
      status: "pending",
    },
  });

  return redirect("/");
}

function MetricCard({
  title,
  value,
  helpText,
}: {
  title: string;
  value: string;
  helpText?: string;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" variant="bodyMd" tone="subdued">
          {title}
        </Text>
        <Text as="p" variant="heading2xl" fontWeight="bold">
          {value}
        </Text>
        {helpText && (
          <Text as="p" variant="bodySm" tone="subdued">
            {helpText}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

function BillingSetup() {
  const [cappedAmount, setCappedAmount] = useState("100");
  const submit = useSubmit();
  const navigation = useNavigation();
  const actionData = useActionData<{ confirmationUrl?: string; error?: string }>();
  const isActivating = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.confirmationUrl) {
      // Escape the Shopify iframe so the billing approval page loads in the parent frame
      (window.top ?? window).location.href = actionData.confirmationUrl;
    }
  }, [actionData]);

  const handleActivate = () => {
    submit({ _action: "activate_billing", cappedAmount }, { method: "post" });
  };

  return (
    <Page title="Activate Affiliate Engine">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              {actionData?.error && (
                <Banner title="Billing error" tone="critical">
                  <p>{actionData.error}</p>
                </Banner>
              )}
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Set your monthly billing cap
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Affiliate Engine charges a 5% service fee on each referred sale.
                  Set a monthly maximum — Shopify will never charge you beyond this amount.
                </Text>
              </BlockStack>
              <FormLayout>
                <TextField
                  label="Monthly cap (USD)"
                  type="number"
                  value={cappedAmount}
                  onChange={setCappedAmount}
                  prefix="$"
                  min={1}
                  autoComplete="off"
                  helpText="Minimum $1. You can request a cap increase from Shopify at any time."
                />
              </FormLayout>
              <InlineStack>
                <Button
                  variant="primary"
                  loading={isActivating}
                  onClick={handleActivate}
                >
                  Activate Plan
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export default function Dashboard() {
  const loaderData = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSimulating = navigation.state === "submitting";

  if ("needsBilling" in loaderData && loaderData.needsBilling) {
    return <BillingSetup />;
  }

  const { metrics, subscription, recentConversions, affiliates } = loaderData as Exclude<
    typeof loaderData,
    { needsBilling: true }
  >;

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(n);

  return (
    <Page title="Affiliate Engine — Dashboard">
      <BlockStack gap="600">
        {!subscription && (
          <Banner title="Billing not configured" tone="warning">
            <p>Please complete the billing setup to enable commission tracking.</p>
          </Banner>
        )}

        {subscription && subscription.status !== "ACTIVE" && (
          <Banner title={`Subscription status: ${subscription.status}`} tone="critical">
            <p>Your billing subscription is not active.</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              <MetricCard
                title="Total Referred Sales"
                value={fmt(metrics.totalReferredSales)}
                helpText={`${metrics.conversionCount} conversions total`}
              />
              <MetricCard
                title="App Revenue (5% fee)"
                value={fmt(metrics.totalAppFees)}
                helpText={
                  subscription
                    ? `Cap: ${fmt(subscription.cappedAmount)}/mo`
                    : undefined
                }
              />
              <MetricCard
                title="Affiliate Payouts"
                value={fmt(metrics.totalAffiliatePayout)}
                helpText={`${metrics.activeAffiliates} active affiliates`}
              />
            </InlineGrid>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Recent Conversions
                  </Text>
                  <Button url="/app/conversions" variant="plain">
                    View all
                  </Button>
                </InlineStack>
                <Divider />
                {recentConversions.length === 0 ? (
                  <Box padding="400">
                    <Text as="p" tone="subdued" alignment="center">
                      No conversions yet. Share affiliate links to start tracking.
                    </Text>
                  </Box>
                ) : (
                  <BlockStack gap="300">
                    {recentConversions.map((c) => (
                      <InlineStack key={c.id} align="space-between">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {c.orderName || c.orderId}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Affiliate:{" "}
                            <strong>
                              {c.affiliate.name} ({c.affiliate.code})
                            </strong>
                          </Text>
                        </BlockStack>
                        <BlockStack gap="100" inlineAlign="end">
                          <Text as="p" variant="bodyMd">
                            {fmt(c.orderTotal)}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Fee: {fmt(c.appFee)}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {affiliates.length > 0 && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Simulate Conversion (Dev)
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Creates a test conversion of $99.99 to demonstrate the tracking pipeline.
                  </Text>
                  <InlineStack gap="300" wrap>
                    {affiliates.map((a) => (
                      <Button
                        key={a.id}
                        loading={isSimulating}
                        onClick={() =>
                          submit({ affiliateId: a.id }, { method: "post" })
                        }
                      >
                        Simulate for {a.code}
                      </Button>
                    ))}
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
