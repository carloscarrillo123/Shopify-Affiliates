import { type RouteConfig, route, index, layout } from "@react-router/dev/routes";

export default [
  route("auth/login", "routes/auth.login.tsx"),
  route("auth/*", "routes/auth.$.tsx"),
  route("exitiframe", "routes/exitiframe.tsx"),

  route("health", "routes/health.tsx"),
  route("webhooks", "routes/webhooks.tsx"),
  route("billing/callback", "routes/billing.callback.tsx"),
  route("api/conversion", "routes/api.conversion.tsx"),

  layout("routes/app.tsx", [
    index("routes/app._index.tsx"),
    route("app/affiliates", "routes/app.affiliates.tsx"),
    route("app/affiliates/:id", "routes/app.affiliates.$id.tsx"),
    route("app/conversions", "routes/app.conversions.tsx"),
  ]),
] satisfies RouteConfig;
