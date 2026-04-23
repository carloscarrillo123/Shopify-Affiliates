import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get("redirectUri");

  if (redirectUri && URL.canParse(redirectUri)) {
    return Response.redirect(redirectUri);
  }

  return new Response("", { status: 204 });
}
