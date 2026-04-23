# Affiliate Engine — Shopify App

MVP de una aplicación de afiliados para Shopify que permite a los merchants crear campañas, rastrear ventas mediante enlaces de afiliados y cobrar una tarifa de servicio del 5% por cada venta referida.

---

## Requisitos Previos

- Node.js >= 18.20.4
- npm >= 9
- Cuenta de Shopify Partners + Development Store
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`cloudflared`) para exponer el servidor local

---

## Instalación

### 1. Clonar e instalar dependencias

```bash
git clone <repo-url>
cd affiliate-engine
npm install
```

### 2. Configurar variables de entorno

Crea un archivo `.env` en la raíz:

```env
SHOPIFY_API_KEY="tu_client_id_del_partner_dashboard"
SHOPIFY_API_SECRET="tu_client_secret"
SHOPIFY_APP_URL="https://tu-tunnel-url.trycloudflare.com"
SCOPES="read_customers,read_orders,read_pixels,read_customer_events,write_orders,write_pixels,write_script_tags"
DATABASE_URL="file:./dev.db"
NODE_ENV="development"
```

> **Importante:** `SHOPIFY_API_KEY` debe coincidir exactamente con el `client_id` del archivo `shopify.app.*.toml` activo. Si no coinciden, la app entrará en un loop de autenticación.

### 3. Configurar la app en Shopify Partner Dashboard

1. Ve a [partners.shopify.com](https://partners.shopify.com) → Apps → Create App
2. Copia el **Client ID** al `.env` como `SHOPIFY_API_KEY`
3. Copia el **Client Secret** al `.env` como `SHOPIFY_API_SECRET`
4. Actualiza el `client_id` en el archivo `shopify.app.*.toml` con el mismo Client ID

### 4. Inicializar la base de datos

```bash
npx prisma migrate dev --name init
npx prisma generate
```

---

## Ejecución en Desarrollo (3 terminales)

El setup de desarrollo requiere **3 terminales abiertas simultáneamente**. El Shopify CLI no levanta automáticamente el servidor de React Router, por lo que hay que hacerlo por separado.

### Terminal 1 — Servidor de la app

```bash
npm run dev
```

Espera hasta ver:
```
Local:   http://localhost:3000/
```

### Terminal 2 — Túnel Cloudflare

```bash
npx cloudflared tunnel --url http://localhost:3000
```

Espera hasta ver una línea como:
```
Your quick Tunnel has been created! https://xxxx-xxxx-xxxx.trycloudflare.com
```

> **Nota:** El URL cambia cada vez que reinicias el túnel. Cuando cambie, actualiza `SHOPIFY_APP_URL` en `.env` y la `application_url` + `redirect_urls` en el archivo `shopify.app.*.toml`, luego reinicia las 3 terminales.

### Terminal 3 — Shopify CLI

```bash
npm run shopify-dev -- --tunnel-url https://xxxx-xxxx-xxxx.trycloudflare.com:443
```

Reemplaza la URL con la que generó el Terminal 2. Espera hasta ver:
```
✅ Ready, watching for changes in your app
app_home │ └ Using URL: https://xxxx-xxxx-xxxx.trycloudflare.com
```

### Abrir la app

Presiona `p` en Terminal 3 para abrir el Preview URL, o accede directamente desde Shopify Admin → Apps.

---

## Variables de entorno — Referencia completa

| Variable | Descripción | Requerida |
|---|---|---|
| `SHOPIFY_API_KEY` | Client ID de la app en Partner Dashboard. Debe coincidir con `client_id` en el toml | ✅ |
| `SHOPIFY_API_SECRET` | Client Secret de la app | ✅ |
| `SHOPIFY_APP_URL` | URL pública del servidor (túnel en dev, dominio real en prod) | ✅ |
| `SCOPES` | Permisos OAuth separados por coma | ✅ |
| `DATABASE_URL` | Conexión a la base de datos. `file:./dev.db` para SQLite local | ✅ |
| `NODE_ENV` | `development` o `production` | ✅ |

---

## Flujo de la Aplicación

```
1. Merchant instala la app
   └─ OAuth → sesión creada → web pixel conectado automáticamente
   └─ Se solicita plan Capped Amount ($100/mes) en el primer acceso

2. Merchant crea afiliados (ej: PROMO10)
   └─ Panel Admin → Affiliates → Add Affiliate
   └─ Configura nombre, email, código único y % de comisión

3. Afiliado comparte su link
   └─ mitienda.myshopify.com/?ref=PROMO10

4. Cliente visita la tienda
   └─ Web Pixel detecta ?ref= en el URL via page_viewed
   └─ Persiste el código en sessionStorage + cookie (30 días)

5. Cliente completa la compra
   └─ Web Pixel recibe evento checkout_completed
   └─ Recupera el código de afiliado del sessionStorage/cookie
   └─ Genera firma HMAC-SHA256 con Web Crypto API
   └─ Envía payload firmado a POST /api/conversion

6. Backend procesa la conversión
   └─ Verifica firma HMAC + ventana de timestamp (5 min)
   └─ Verifica idempotencia: UNIQUE(shop, orderId)
   └─ Calcula: appFee = orderTotal × 5%, affiliatePayout = orderTotal × commissionPct%
   └─ Crea AppUsageRecord en Shopify via GraphQL (con retry exponencial)
   └─ Dashboard muestra métricas actualizadas
```

---

## Decisiones de Arquitectura

### Framework: React Router v7

Framework oficial de Shopify en 2025-2026. El modelo loaders/actions elimina la necesidad de un API layer separado. `data()` reemplaza a `json()` (cambio breaking en v7).

### Web Pixel (no ScriptTags)

El spec de la prueba requiere Web Pixel Extension — la forma moderna y aprobada por Shopify para tracking de eventos de checkout. Los ScriptTags están deprecados para este caso de uso. El pixel corre en un sandbox estricto (`runtime_context = "strict"`) con acceso a Web Crypto API para HMAC.

### Seguridad: HMAC-SHA256

El Web Pixel corre en el navegador del cliente y no puede usar tokens de sesión del Admin. La solución es firmar el payload con HMAC-SHA256 usando `SHOPIFY_API_SECRET`. El backend verifica la firma y el timestamp (ventana de 5 minutos) antes de procesar cualquier conversión.

### Idempotencia

`Conversion` tiene `@@unique([shop, orderId])`. Si el pixel dispara el evento múltiples veces, el backend devuelve el registro existente sin crear duplicados ni cobros dobles.

### Billing: Capped Amount + UsageRecord

- Plan Capped Amount de $100/mes creado en el primer acceso del merchant
- Por cada venta referida: `AppUsageRecord` vía GraphQL por el 5% del total
- Retry con exponential backoff para errores de rate limiting (leaky bucket de Shopify)

### Base de Datos: SQLite → PostgreSQL

SQLite en desarrollo (sin configuración, reproducible). Prisma abstrae el dialecto — migrar a PostgreSQL en producción es cambiar una línea en `schema.prisma`.

---

## Notas sobre el Pixel en Desarrollo

El evento `checkout_completed` puede no dispararse correctamente en development stores con **Bogus Gateway**. Esto es una limitación del entorno de desarrollo de Shopify, no del código.

En producción con una tienda real y un payment provider real, el flujo completo funciona. Para demostrar el pipeline en desarrollo, el dashboard incluye un botón **"Simulate Conversion"** que ejecuta el mismo código del backend (verificación, cálculo de fees, billing) con datos de prueba.

El pixel se conecta automáticamente a la tienda mediante `webPixelCreate` la primera vez que el merchant accede al dashboard, y aparece en **Shopify Admin → Settings → Customer events** como activo.

---

## Escalabilidad (Alta Concurrencia)

### SQLite → PostgreSQL

SQLite tiene escrituras seriales. Con múltiples tiendas en paralelo es un cuello de botella. PostgreSQL con PgBouncer soporta miles de conexiones concurrentes.

### Procesamiento asíncrono con colas

```
Web Pixel → POST /api/conversion (responde <50ms, solo encola)
                ↓
         Redis Queue (BullMQ)
                ↓
         Workers (N instancias)
                ↓
         Shopify GraphQL API (respetando rate limits por tienda)
```

### Indexación para millones de registros

```sql
-- Cubiertos por Prisma @@unique
CREATE INDEX idx_conversion_shop_created ON "Conversion"(shop, "createdAt" DESC);
CREATE INDEX idx_conversion_affiliate ON "Conversion"("affiliateId");

-- Para producción
CREATE INDEX idx_conversion_shop_status ON "Conversion"(shop, status)
  WHERE status = 'pending';  -- Partial index para reprocesamiento

-- Particionamiento PostgreSQL 12+
CREATE TABLE "Conversion" (...) PARTITION BY HASH(shop);
```

---

## Arquitectura de Base de Datos

### Esquema actual y justificación

El esquema tiene cuatro modelos, cada uno con una responsabilidad única:

```
Session         → Sesiones OAuth. Gestionadas por shopify-app-session-storage-prisma.
                  Separadas del dominio de negocio para simplificar rotación de tokens.

Affiliate       → Entidad central. @@unique([shop, code]) permite que el mismo código
                  exista en tiendas distintas (multi-tenant) pero sea único por tienda.

Conversion      → Registro de ventas referidas. @@unique([shop, orderId]) como clave de
                  idempotencia a nivel de base de datos — la segunda inserción lanza una
                  excepción conocida que el backend captura y convierte en 200 OK.

AppSubscription → Una fila por tienda. Guarda el subscriptionId de Shopify y el balance
                  mensual acumulado para evitar llamadas repetidas a la Billing API.
```

**Decisiones de diseño:**
- `commissionPct` y `orderTotal` son `Float` en SQLite. Al migrar a PostgreSQL se cambian a `Decimal(10,4)` para evitar errores de punto flotante en cálculos monetarios (IEEE 754 acumula error al sumar miles de comisiones).
- `status` en `Conversion` es un `String` libre en SQLite; en PostgreSQL se convierte a un `ENUM ('pending', 'paid', 'failed')` para garantizar integridad sin lógica en la aplicación.
- No hay FK de `Session` hacia ningún modelo de negocio porque las sesiones tienen un ciclo de vida independiente (expiran, se revocan) y no deben bloquear borrados en cascada.

### Integridad ante picos de tráfico

**A nivel de base de datos:**
- Las restricciones `@@unique` existen en la DB, no solo en la aplicación. Si dos workers procesan el mismo `orderId` en paralelo, el segundo falla en el `INSERT` — no en la validación de negocio — garantizando exactamente una conversión por orden incluso con N procesos concurrentes.
- Las operaciones críticas (crear conversión + crear `AppUsageRecord`) se ejecutan en una transacción `prisma.$transaction([...])`. Si el registro de billing falla, el registro de conversión se revierte, evitando inconsistencias (conversión registrada pero no cobrada).
- PostgreSQL usa MVCC (Multi-Version Concurrency Control): los lectores nunca bloquean a los escritores. Un dashboard con 50 queries de agregación en paralelo no retrasa el procesamiento de eventos entrantes.
- PgBouncer en modo `transaction` permite que miles de conexiones HTTP compartan un pool pequeño (20-50 conexiones reales a PostgreSQL), evitando el `connection exhaustion` que ocurre cuando cada request serverless abre su propia conexión.

**A nivel de aplicación:**
- El endpoint `POST /api/conversion` responde en < 50 ms encolando la tarea en Redis/BullMQ y devolviendo un `202 Accepted`. El procesamiento pesado (GraphQL a Shopify, escritura a DB) ocurre en workers desacoplados, sin que el pixel del cliente espere.
- Retry con exponential backoff (`1s → 2s → 4s`) para errores transitorios de Shopify API. Los reintentos no duplican cargos porque el `orderId` actúa como idempotency key en la DB.

### Migración SQLite → PostgreSQL para millones de eventos

**Paso 1 — Cambio de provider (sin lógica de negocio):**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```
Prisma genera automáticamente las migraciones; el código de la aplicación no cambia.

**Paso 2 — Precisión monetaria:**
```prisma
orderTotal    Decimal @db.Decimal(10, 4)
commissionPct Decimal @db.Decimal(5, 4)
appFee        Decimal @db.Decimal(10, 4)
payout        Decimal @db.Decimal(10, 4)
```

**Paso 3 — Índices para consultas frecuentes:**
```sql
-- Dashboard: métricas por tienda ordenadas por fecha
CREATE INDEX idx_conversion_shop_created
  ON "Conversion"(shop, "createdAt" DESC);

-- Historial de afiliado
CREATE INDEX idx_conversion_affiliate
  ON "Conversion"("affiliateId", "createdAt" DESC);

-- Reprocesamiento de conversiones fallidas (partial index — solo indexa las filas relevantes)
CREATE INDEX idx_conversion_pending
  ON "Conversion"(shop, "createdAt")
  WHERE status = 'pending';
```

**Paso 4 — Particionamiento cuando la tabla supera ~50M filas:**
```sql
-- Particionar por rango de fecha: cada mes es una partición independiente
CREATE TABLE "Conversion" (
  ...
) PARTITION BY RANGE ("createdAt");

CREATE TABLE conversion_2025_01
  PARTITION OF "Conversion"
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

-- O por hash de tienda para distribución uniforme en multi-tenant:
CREATE TABLE "Conversion" (...) PARTITION BY HASH(shop);
```

**Paso 5 — Separación de OLTP y OLAP:**
Para millones de eventos, las queries analíticas del dashboard (`GROUP BY`, `SUM`, `COUNT`) compiten con las inserciones en tiempo real. La solución es una arquitectura de dos capas:

```
Escritura (OLTP):  PostgreSQL principal — inserciones de conversiones en tiempo real
Lectura (OLAP):    Read replica PostgreSQL — queries del dashboard
                   o ClickHouse / TimescaleDB para analytics de alta velocidad
Cache de métricas: Redis con TTL de 5 min — los totales del dashboard se sirven
                   desde cache, se invalidan cuando llega una nueva conversión
```

---

## Infraestructura y DevOps

### Gestión de Entornos

Cada entorno es completamente aislado tanto en infraestructura como en el Partner Dashboard de Shopify:

| Entorno | Infraestructura | Base de Datos | Partner Dashboard |
|---|---|---|---|
| `development` | Local + Cloudflare Tunnel | SQLite local | App `affiliate-dev` — solo dev stores |
| `staging` | Fly.io (`affiliate-engine-staging`) | PostgreSQL managed (Fly) | App `affiliate-staging` — test stores |
| `production` | Fly.io (`affiliate-engine`) | PostgreSQL managed (Fly) | App `affiliate-prod` — tiendas reales |

**¿Por qué apps separadas en Partner Dashboard?**

Una app de Shopify tiene un `client_id` único. Si usáramos la misma app en staging y prod, compartirían el mismo `SHOPIFY_API_SECRET` — cualquier bug en staging que exponga el secret comprometería producción. Además, las extensiones (Web Pixel) están ligadas al `client_id`, por lo que un deploy de la extensión en staging no puede afectar la extensión activa en tiendas de producción.

**Ciclo de vida de los entornos:**

```
feature/* ──→ develop ──→ staging branch ──→ main (prod)
                │              │                  │
              local          Fly.io staging    Fly.io prod
             (manual)       (auto-deploy)     (auto-deploy)
```

- `develop`: rama de integración. Los PRs se mergean aquí. CI corre tests pero no despliega.
- `staging`: se actualiza con cada merge a `develop`. Base de datos de staging con seed de datos de prueba. La URL pública es `affiliate-engine-staging.fly.dev` — configurada en la app del Partner Dashboard de staging.
- `main`: solo se actualiza mediante PR aprobado desde `staging`. Requiere aprobación manual en GitHub Actions para el paso de deploy. La app en Partner Dashboard de producción apunta a `affiliate-engine.fly.dev`.

**Variables de entorno por entorno:**

```bash
# development (.env — gitignored)
SHOPIFY_API_KEY="client_id_dev"
SHOPIFY_APP_URL="https://<tunnel>.trycloudflare.com"
DATABASE_URL="file:./dev.db"
NODE_ENV="development"

# staging (fly secrets — staging app)
SHOPIFY_API_KEY="client_id_staging"
SHOPIFY_APP_URL="https://affiliate-engine-staging.fly.dev"
DATABASE_URL="postgresql://..."
NODE_ENV="production"

# production (fly secrets — prod app)
SHOPIFY_API_KEY="client_id_prod"
SHOPIFY_APP_URL="https://affiliate-engine.fly.dev"
DATABASE_URL="postgresql://..."
NODE_ENV="production"
```

---

### Pipeline de CI/CD (GitHub Actions)

Un deploy seguro a producción requiere superar todas estas gates en orden:

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [main]

jobs:
  # ─── GATE 1: Calidad de código ───────────────────────────────────────────
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run lint          # ESLint: errores de estilo y bugs estáticos
      - run: npm run typecheck     # tsc --noEmit: sin errores de tipos

  # ─── GATE 2: Seguridad de dependencias ───────────────────────────────────
  security-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm audit --audit-level=high   # Falla si hay CVE alto o crítico
      - uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          severity: HIGH,CRITICAL           # Escaneo de dependencias con Trivy

  # ─── GATE 3: Tests ───────────────────────────────────────────────────────
  test:
    runs-on: ubuntu-latest
    needs: lint-and-typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm test -- --coverage        # Vitest / Jest con coverage report
      - uses: codecov/codecov-action@v4    # Publica coverage en PR

  # ─── GATE 4: Build de producción ─────────────────────────────────────────
  build:
    runs-on: ubuntu-latest
    needs: [lint-and-typecheck, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npx prisma generate
      - run: npm run build
      - uses: actions/upload-artifact@v4   # Persiste el artefacto para el deploy
        with: { name: build, path: build/ }

  # ─── GATE 5: Deploy a Staging (solo en push a develop) ───────────────────
  deploy-staging:
    runs-on: ubuntu-latest
    needs: [build, security-audit]
    if: github.ref == 'refs/heads/develop'
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - name: Run DB migrations (staging)
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --app affiliate-engine-staging --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_STAGING }}
      - name: Smoke test
        run: |
          curl --fail https://affiliate-engine-staging.fly.dev/health \
          || (echo "Health check failed" && exit 1)

  # ─── GATE 6: Deploy a Producción (solo en push a main, con aprobación) ───
  deploy-production:
    runs-on: ubuntu-latest
    needs: [build, security-audit]
    if: github.ref == 'refs/heads/main'
    environment: production          # Requiere aprobación manual en GitHub
    steps:
      - uses: actions/checkout@v4
      - name: Run DB migrations (prod)
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --app affiliate-engine --remote-only --strategy rolling
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN_PROD }}
      - name: Smoke test
        run: |
          curl --fail https://affiliate-engine.fly.dev/health \
          || (echo "Health check failed" && exit 1)
      - name: Notify on failure
        if: failure()
        uses: slackapi/slack-github-action@v1
        with:
          payload: '{"text":"🚨 Deploy a producción falló en ${{ github.sha }}"}'
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

**Por qué este orden importa:**
- Las migraciones van **antes** del deploy del código: el nuevo código siempre es compatible con el schema nuevo, pero el código viejo también debe serlo (migraciones aditivas, sin DROP column en el mismo deploy).
- `--strategy rolling` en Fly.io: arranca instancias nuevas antes de apagar las viejas, garantizando zero-downtime.
- El smoke test post-deploy falla el pipeline si el `/health` no responde — lo que dispara un rollback manual o automático.

---

### Estrategia de Despliegue

#### Dockerfile (multi-stage, sin root)

```dockerfile
# ── Etapa 1: compilación ──────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npx prisma generate
RUN npm run build

# ── Etapa 2: imagen de producción (mínima) ────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Usuario sin privilegios para reducir superficie de ataque
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/build        ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma       ./prisma
COPY --from=builder /app/package.json .

USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["npm", "run", "start"]
```

`.dockerignore` excluye: `node_modules`, `.env`, `*.db`, `.git`, `extensions/` — reduce la imagen de ~800 MB a ~180 MB.

#### Gestión de secretos

| Entorno | Mecanismo | Por qué |
|---|---|---|
| Development | `.env` (gitignored) | Simplicidad. Nunca en el repositorio |
| CI/CD | GitHub Secrets | Encriptados en reposo, solo visibles durante la ejecución del workflow |
| Staging / Prod | `fly secrets set` | Encriptados, inyectados como env vars en runtime, nunca en la imagen Docker |

```bash
# Configurar secretos en producción (una sola vez)
fly secrets set \
  SHOPIFY_API_KEY="client_id_prod" \
  SHOPIFY_API_SECRET="..." \
  DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" \
  SHOPIFY_APP_URL="https://affiliate-engine.fly.dev" \
  PIXEL_HMAC_SECRET="..." \
  SCOPES="read_customers,read_orders,read_pixels,read_customer_events,write_orders,write_pixels,write_script_tags" \
  --app affiliate-engine
```

`PIXEL_HMAC_SECRET` es distinto de `SHOPIFY_API_SECRET` en producción — rotar uno no invalida el otro.

#### Configuración de Fly.io (`fly.toml`)

```toml
app = "affiliate-engine"
primary_region = "mad"   # Madrid — latencia mínima para merchants EU

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3000
  force_https = true
  [http_service.concurrency]
    type = "requests"
    hard_limit = 250
    soft_limit = 200

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1

[checks]
  [checks.health]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    path = "/health"
    timeout = "5s"
```

#### Base de datos en Fly.io

```bash
# Crear PostgreSQL managed (Fly gestiona backups diarios y failover)
fly postgres create --name affiliate-engine-db --region mad --vm-size shared-cpu-1x

# Conectar la DB a la app (inyecta DATABASE_URL automáticamente)
fly postgres attach affiliate-engine-db --app affiliate-engine
```

#### Alternativas de despliegue

**Vercel / Serverless:**
- Requiere base de datos serverless-compatible: Neon o Supabase (PostgreSQL con HTTP pooling). Prisma en serverless necesita `@prisma/adapter-neon` para evitar abrir una conexión TCP por invocación.
- Las funciones serverless en Vercel tienen un límite de 10s por defecto (50s en Pro) — adecuado para este caso de uso.
- Ventaja: escala a cero, sin gestión de infraestructura.

**AWS (ECS + RDS):**
- App en ECS Fargate (contenedores Docker sin gestionar EC2).
- PostgreSQL en RDS con Multi-AZ para failover automático.
- Secretos en AWS Secrets Manager, inyectados como env vars en la task definition.
- ALB con target groups para zero-downtime deploys.

**VPS (DigitalOcean / Hetzner):**
- Docker Compose con PostgreSQL en el mismo servidor (aceptable para < 100k req/día).
- Caddy como reverse proxy (HTTPS automático vía Let's Encrypt).
- Backups de PostgreSQL con `pg_dump` a S3/R2 via cron.
- Para HA: dos VPS + Keepalived (IP flotante) + replicación de Postgres.

#### Health Check endpoint

```typescript
// app/routes/health.ts
export async function loader() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok" });
  } catch {
    return Response.json({ status: "ok", db: "error" }, { status: 503 });
  }
}
```

Fly.io saca la instancia del load balancer si devuelve 503 tres veces consecutivas y arranca una nueva.

---

## Estructura del Proyecto

```
affiliate-engine/
├── app/
│   ├── routes/
│   │   ├── app.tsx                 # Layout: PolarisAppProvider + AppProvider + NavMenu
│   │   ├── app._index.tsx          # Dashboard con métricas + Simulate Conversion
│   │   ├── app.affiliates.tsx      # CRUD de afiliados (crear, activar, eliminar)
│   │   ├── app.affiliates.$id.tsx  # Editar afiliado + historial de conversiones
│   │   ├── app.conversions.tsx     # Lista de conversiones con filtros
│   │   ├── api.conversion.tsx      # Endpoint HMAC-protegido para el Web Pixel
│   │   ├── billing.callback.tsx    # Callback del flujo de billing
│   │   ├── auth.login.tsx          # Ruta de login OAuth
│   │   ├── auth.$.tsx              # Catch-all para callbacks OAuth
│   │   ├── exitiframe.tsx          # Rompe el iframe para redirects OAuth
│   │   └── webhooks.tsx            # APP_UNINSTALLED webhook
│   ├── db.server.ts                # Singleton de Prisma Client
│   ├── shopify.server.ts           # Configuración Shopify: auth, billing, webhooks
│   ├── root.tsx
│   ├── entry.client.tsx
│   └── entry.server.tsx
├── extensions/
│   └── web-pixel/
│       ├── src/
│       │   └── index.ts            # Pixel: page_viewed + checkout_completed + HMAC
│       └── shopify.extension.toml
├── prisma/
│   └── schema.prisma
├── shopify.app.affiliate-dev3.toml # Configuración activa del CLI
├── vite.config.ts                  # allowedHosts: true para túnel Cloudflare
├── react-router.config.ts
└── .env
```

---

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Framework | React Router v7 + TypeScript |
| UI | Shopify Polaris + App Bridge |
| ORM | Prisma v6 |
| Base de datos | SQLite (dev) / PostgreSQL (prod) |
| Auth | @shopify/shopify-app-react-router |
| Pixel | Shopify Web Pixel Extension (strict mode) |
| Billing | Shopify Billing API — Capped Amount + UsageRecords |
| Tunnel | Cloudflare Tunnel (cloudflared) |
| Deploy | Fly.io + Docker |
| CI/CD | GitHub Actions |
