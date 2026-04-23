import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import { db } from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const conversions = await db.conversion.findMany({
    where: { shop: session.shop },
    include: { affiliate: { select: { name: true, code: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return data({ conversions });
}

export default function ConversionsPage() {
  const { conversions } = useLoaderData<typeof loader>();

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const rowMarkup = conversions.map(
    ({ id, orderId, orderName, orderTotal, affiliatePayout, appFee, status, affiliate, createdAt }, index) => (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell>
          <Text as="span" fontWeight="semibold">
            {orderName || orderId}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {affiliate.name} ({affiliate.code})
        </IndexTable.Cell>
        <IndexTable.Cell>{fmt(orderTotal)}</IndexTable.Cell>
        <IndexTable.Cell>{fmt(appFee)}</IndexTable.Cell>
        <IndexTable.Cell>{fmt(affiliatePayout)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={status === "processed" ? "success" : "attention"}>
            {status}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(createdAt).toLocaleDateString()}
        </IndexTable.Cell>
      </IndexTable.Row>
    )
  );

  return (
    <Page title="Conversions">
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {conversions.length === 0 ? (
              <EmptyState
                heading="No conversions yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Conversions will appear here once customers purchase via affiliate links.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "conversion", plural: "conversions" }}
                itemCount={conversions.length}
                headings={[
                  { title: "Order" },
                  { title: "Affiliate" },
                  { title: "Order Total" },
                  { title: "App Fee (5%)" },
                  { title: "Affiliate Payout" },
                  { title: "Status" },
                  { title: "Date" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
