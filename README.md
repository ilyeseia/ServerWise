# ServerWise

**Smarter Servers. Better Decisions.**
AI-Powered Server & Infrastructure Management — a platform for running a server installation, infrastructure deployment and IT maintenance business in Algeria (Sétif and surrounding regions).

> **Status: Stage 1 — application foundation.** Shell, i18n (ar/fr), database, CI and Docker are in place; business modules arrive in later stages. See the roadmap below.

## الملخص بالعربية

ServerWise منصة لإدارة دورة عمل شركة تركيب الخوادم والصيانة: من أول استفسار للعميل، إلى عرض السعر، ثم تنفيذ المشروع، ثم الصيانة والتجديد، مع مساعد ذكي اختياري لا يتحكم أبدًا في الأسعار أو الصلاحيات. اللغة الأساسية العربية (RTL) والثانوية الفرنسية (LTR). المشروع يُبنى على مراحل، وكل مرحلة تنتظر موافقة صريحة قبل النشر.

## Planned stack (details: [docs/TECHNOLOGY_DECISIONS.md](docs/TECHNOLOGY_DECISIONS.md))

Next.js 16 · React 19 · TypeScript 6 · Tailwind 4 + shadcn/ui · PostgreSQL 18 + Prisma 7 · Better Auth · next-intl (ar/fr) · Vitest + Playwright · Docker + GitHub Actions.

## Documentation

| Document                                                 | Content                                         |
| -------------------------------------------------------- | ----------------------------------------------- |
| [PRODUCT_REQUIREMENTS](docs/PRODUCT_REQUIREMENTS.md)     | Scope, roles, requirements, risks               |
| [ARCHITECTURE](docs/ARCHITECTURE.md)                     | Modular monolith, layers, AI design, deployment |
| [TECHNOLOGY_DECISIONS](docs/TECHNOLOGY_DECISIONS.md)     | Verified versions, alternatives, limits         |
| [SECURITY_MODEL](docs/SECURITY_MODEL.md)                 | Threats, controls, secrets, AI safety           |
| [IMPLEMENTATION_ROADMAP](docs/IMPLEMENTATION_ROADMAP.md) | Stages 0–11 with acceptance criteria            |

## Roadmap

0 Blueprint ✅ → 1 Foundation (in review) → 2 Auth/RBAC → 3 CRM → 4 Hardware & suppliers → 5 SmartQuote → 6 ProjectFlow → 7 Inventory & maintenance → 8 Backups & remote access → 9 AI → 10 Analytics → 11 Hardening.

## Development

Prerequisites: Node.js 24 LTS (>= 22.18 works locally), pnpm 12.14.0 (`npm install -g pnpm@12.14.0`), Docker.

```bash
cp .env.example .env              # set POSTGRES_PASSWORD and the same password inside DATABASE_URL
docker compose -f compose.dev.yml up -d --wait   # PostgreSQL 18 on 127.0.0.1:5432
pnpm install
pnpm db:generate && pnpm db:deploy               # generate client, apply migrations
pnpm dev                                         # http://localhost:3000 -> redirects to /ar
```

| Command                                              | Purpose                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Static checks                                                             |
| `pnpm test`                                          | Vitest unit + integration (integration needs `DATABASE_URL` + migrations) |
| `pnpm build && pnpm test:e2e`                        | Production build, then Playwright (ar-RTL, fr-LTR, axe, health)           |
| `docker compose up -d --build`                       | Full stack: db + one-shot migrations + app on 127.0.0.1:3000              |

Health endpoints: `GET /api/health` (liveness) and `GET /api/ready` (database).

## License

Not yet chosen (private commercial project).
