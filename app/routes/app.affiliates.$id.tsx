import { data, redirect } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, Form } from "react-router";
import {
  Page,
  Layout,
  Card,
  Button,
  FormLayout,
  TextField,
  BlockStack,
  Banner,
  Text,
  InlineStack,
  Divider,
  Badge,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const affiliate = await db.affiliate.findFirst({
    where: { id: params.id, shop: session.shop },
    include: {
      conversions: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
  if (!affiliate) throw new Response("Not Found", { status: 404 });
  return data({ affiliate });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "update") {
    const name = formData.get("name") as string;
    const email = (formData.get("email") as string) || null;
    const commissionRate = parseFloat(formData.get("commissionRate") as string);

    if (!name || isNaN(commissionRate) || commissionRate < 0 || commissionRate > 100) {
      return data({ error: "Invalid fields." }, { status: 400 });
    }

    await db.affiliate.updateMany({
      where: { id: params.id, shop: session.shop },
      data: { name, email, commissionRate },
    });
    return redirect("/app/affiliates");
  }

  return data({ error: "Unknown intent" }, { status: 400 });
}

export default function EditAffiliate() {
  const { affiliate } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [name, setName] = useState(affiliate.name);
  const [email, setEmail] = useState(affiliate.email ?? "");
  const [commissionRate, setCommissionRate] = useState(
    String(affiliate.commissionRate)
  );

  const appUrl = typeof window !== "undefined" ? window.location.origin : "";
  const affiliateLink = `${appUrl}/?ref=${affiliate.code}`;

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  return (
    <Page
      title={`Edit Affiliate: ${affiliate.name}`}
      backAction={{ content: "Affiliates", url: "/app/affiliates" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Affiliate Details
              </Text>
              <Banner tone="info">
                <p>
                  Affiliate link:{" "}
                  <strong>
                    ?ref={affiliate.code}
                  </strong>
                </p>
              </Banner>
              <Form method="post">
                <input type="hidden" name="intent" value="update" />
                <FormLayout>
                  <TextField
                    label="Affiliate Code"
                    value={affiliate.code}
                    disabled
                    autoComplete="off"
                    helpText="Code cannot be changed after creation."
                  />
                  <TextField
                    label="Name"
                    name="name"
                    value={name}
                    onChange={setName}
                    autoComplete="off"
                  />
                  <TextField
                    label="Email"
                    name="email"
                    value={email}
                    onChange={setEmail}
                    type="email"
                    autoComplete="email"
                  />
                  <TextField
                    label="Commission Rate (%)"
                    name="commissionRate"
                    value={commissionRate}
                    onChange={setCommissionRate}
                    type="number"
                    min="0"
                    max="100"
                    suffix="%"
                    autoComplete="off"
                  />
                  <Button variant="primary" submit loading={isSubmitting}>
                    Save Changes
                  </Button>
                </FormLayout>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Recent Conversions
              </Text>
              <Divider />
              {affiliate.conversions.length === 0 ? (
                <Text as="p" tone="subdued">
                  No conversions yet.
                </Text>
              ) : (
                <BlockStack gap="300">
                  {affiliate.conversions.map((c) => (
                    <InlineStack key={c.id} align="space-between">
                      <BlockStack gap="100">
                        <Text as="p" fontWeight="semibold">
                          {c.orderName ?? c.orderId}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </Text>
                      </BlockStack>
                      <BlockStack gap="100" inlineAlign="end">
                        <Text as="p">{fmt(c.orderTotal)}</Text>
                        <Badge tone={c.status === "processed" ? "success" : "attention"}>
                          {c.status}
                        </Badge>
                      </BlockStack>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
