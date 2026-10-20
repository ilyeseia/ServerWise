# ServerWise

**Smarter Servers. Better Decisions.**
AI-Powered Server & Infrastructure Management — a platform for running a server installation, infrastructure deployment and IT maintenance business in Algeria (Sétif and surrounding regions).

> **Status: Stage 0 — blueprint only.** No application code exists yet. See the roadmap below.

## الملخص بالعربية
ServerWise منصة لإدارة دورة عمل شركة تركيب الخوادم والصيانة: من أول استفسار للعميل، إلى عرض السعر، ثم تنفيذ المشروع، ثم الصيانة والتجديد، مع مساعد ذكي اختياري لا يتحكم أبدًا في الأسعار أو الصلاحيات. اللغة الأساسية العربية (RTL) والثانوية الفرنسية (LTR). المشروع يُبنى على مراحل، وكل مرحلة تنتظر موافقة صريحة قبل النشر.

## Planned stack (details: [docs/TECHNOLOGY_DECISIONS.md](docs/TECHNOLOGY_DECISIONS.md))
Next.js 16 · React 19 · TypeScript 6 · Tailwind 4 + shadcn/ui · PostgreSQL 18 + Prisma 7 · Better Auth · next-intl (ar/fr) · Vitest + Playwright · Docker + GitHub Actions.

## Documentation
| Document | Content |
|---|---|
| [PRODUCT_REQUIREMENTS](docs/PRODUCT_REQUIREMENTS.md) | Scope, roles, requirements, risks |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Modular monolith, layers, AI design, deployment |
| [TECHNOLOGY_DECISIONS](docs/TECHNOLOGY_DECISIONS.md) | Verified versions, alternatives, limits |
| [SECURITY_MODEL](docs/SECURITY_MODEL.md) | Threats, controls, secrets, AI safety |
| [IMPLEMENTATION_ROADMAP](docs/IMPLEMENTATION_ROADMAP.md) | Stages 0–11 with acceptance criteria |

## Roadmap
0 Blueprint ✅(awaiting approval) → 1 Foundation → 2 Auth/RBAC → 3 CRM → 4 Hardware & suppliers → 5 SmartQuote → 6 ProjectFlow → 7 Inventory & maintenance → 8 Backups & remote access → 9 AI → 10 Analytics → 11 Hardening.

## Development
Not available yet (Stage 1). Prerequisites will be Node.js 24 LTS, pnpm, Docker.

## License
Not yet chosen (private commercial project).
