import { data, redirect } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, Form } from "react-router";
import {
  Page,
  Layout,
  Card,
  Button,
  IndexTable,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  EmptyState,
  TextField,
  Modal,
  FormLayout,
  Banner,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const affiliates = await db.affiliate.findMany({
    where: { shop: session.shop },
    include: {
      _count: { select: { conversions: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return data({ affiliates });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const code = (formData.get("code") as string)?.toUpperCase().trim();
    const name = formData.get("name") as string;
    const email = (formData.get("email") as string) || "";
    const commissionPct = parseFloat(formData.get("commissionPct") as string);

    if (!code || !name || isNaN(commissionPct) || commissionPct < 0 || commissionPct > 100) {
      return data({ error: "Invalid fields. Commission must be between 0 and 100." }, { status: 400 });
    }

    const codeRegex = /^[A-Z0-9_-]{3,30}$/;
    if (!codeRegex.test(code)) {
      return data(
        { error: "Code must be 3-30 alphanumeric characters (A-Z, 0-9, _, -)." },
        { status: 400 }
      );
    }

    const existing = await db.affiliate.findUnique({
      where: { shop_code: { shop: session.shop, code } },
    });
    if (existing) {
      return data({ error: `Code "${code}" is already taken.` }, { status: 409 });
    }

    await db.affiliate.create({
      data: { shop: session.shop, code, name, email, commissionPct },
    });
    return redirect("/app/affiliates");
  }

  if (intent === "toggle") {
    const id = formData.get("id") as string;
    const affiliate = await db.affiliate.findFirst({
      where: { id, shop: session.shop },
    });
    if (!affiliate) return data({ error: "Not found" }, { status: 404 });
    await db.affiliate.update({
      where: { id },
      data: { isActive: !affiliate.isActive },
    });
    return redirect("/app/affiliates");
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await db.affiliate.deleteMany({ where: { id, shop: session.shop } });
    return redirect("/app/affiliates");
  }

  return data({ error: "Unknown intent" }, { status: 400 });
}

export default function AffiliatesPage() {
  const { affiliates } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [showModal, setShowModal] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [commissionPct, setCommissionRate] = useState("10");
  const [formError, setFormError] = useState("");

  const handleCreate = useCallback(() => {
    if (!code || !name) {
      setFormError("Code and Name are required.");
      return;
    }
    setFormError("");
    submit(
      { intent: "create", code, name, email, commissionPct },
      { method: "post" }
    );
    setShowModal(false);
    setCode("");
    setName("");
    setEmail("");
    setCommissionRate("10");
  }, [code, name, email, commissionPct, submit]);

  const resourceName = { singular: "affiliate", plural: "affiliates" };
  const rowMarkup = affiliates.map(({ id, code, name, email, commissionPct, isActive, _count }, index) => (
    <IndexTable.Row id={id} key={id} position={index}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {code}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{name}</IndexTable.Cell>
      <IndexTable.Cell>{email || "—"}</IndexTable.Cell>
      <IndexTable.Cell>{commissionPct}%</IndexTable.Cell>
      <IndexTable.Cell>{_count.conversions}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={isActive ? "success" : "critical"}>
          {isActive ? "Active" : "Inactive"}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Form method="post">
            <input type="hidden" name="intent" value="toggle" />
            <input type="hidden" name="id" value={id} />
            <Button submit size="slim" variant="plain">
              {isActive ? "Deactivate" : "Activate"}
            </Button>
          </Form>
          <Button url={`/app/affiliates/${id}`} size="slim" variant="plain">
            Edit
          </Button>
          <Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={id} />
            <Button submit size="slim" variant="plain" tone="critical">
              Delete
            </Button>
          </Form>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Affiliates"
      primaryAction={
        <Button variant="primary" onClick={() => setShowModal(true)}>
          Add Affiliate
        </Button>
      }
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {affiliates.length === 0 ? (
              <EmptyState
                heading="No affiliates yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{ content: "Add Affiliate", onAction: () => setShowModal(true) }}
              >
                <p>Create your first affiliate to start tracking referrals.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={resourceName}
                itemCount={affiliates.length}
                headings={[
                  { title: "Code" },
                  { title: "Name" },
                  { title: "Email" },
                  { title: "Commission" },
                  { title: "Conversions" },
                  { title: "Status" },
                  { title: "Actions" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Create Affiliate"
        primaryAction={{ content: "Create", onAction: handleCreate, loading: isSubmitting }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowModal(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {formError && <Banner tone="critical">{formError}</Banner>}
            <FormLayout>
              <TextField
                label="Affiliate Code"
                value={code}
                onChange={setCode}
                helpText="Unique identifier used in links: ?ref=CODE (A-Z, 0-9, _, -)"
                autoComplete="off"
              />
              <TextField
                label="Name"
                value={name}
                onChange={setName}
                autoComplete="off"
              />
              <TextField
                label="Email (optional)"
                value={email}
                onChange={setEmail}
                type="email"
                autoComplete="email"
              />
              <TextField
                label="Commission Rate (%)"
                value={commissionPct}
                onChange={setCommissionRate}
                type="number"
                min="0"
                max="100"
                suffix="%"
                helpText="Percentage of each referred sale paid to the affiliate"
                autoComplete="off"
              />
            </FormLayout>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
