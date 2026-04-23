import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { login } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return login(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return login(request);
}
