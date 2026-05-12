@AGENTS.md

# app/ — WhatsApp SaaS multi-tenant

App principal do projecto OpenBSP-Convex. Plano completo em `../PLAN.md`. Visão geral em `../PROJECT.md`.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind v4
- Convex (banco + reactive + scheduler + actions + storage + auth)
- Convex Auth (magic link / OAuth)
- convex-helpers (customFunctions wrappers)

**Atenção:** Next.js 16 tem breaking changes vs versões anteriores. Ler `node_modules/next/dist/docs/` antes de assumir APIs.

## Princípios inegociáveis

1. **Multi-tenant por código.** Toda query/mutation usa `tenantQuery`/`tenantMutation` (em `convex/lib/customFunctions.ts`) — derivam `tenantId` do session, NUNCA dos args do caller.
2. **`ctx.db.*` SÓ em queries/mutations.** Em actions e httpActions usar `ctx.runQuery`/`ctx.runMutation`.
3. **`loadByIdInTenant` para todo `ctx.db.get(id)`.** Valida tenant fence — throws `CROSS_TENANT_ACCESS` se ID pertence a outro tenant.
4. **Healthcare mode obrigatório quando `vertical=clinic`.** Allowlist templates + denylist regex + DPIA + DPA antes de connect WABA.
5. **Idempotência explícita.** Webhook events com state machine, outbound com `businessKey` + status `unknown` (sem auto-retry).
6. **Append-only audit log com hash chain.** Writes só via `internalMutation appendAudit`.

## Estrutura

```
convex/
├── schema.ts                    ← schema base (tenants, members, sessions, +authTables)
├── auth.ts                      ← Convex Auth setup
├── lib/
│   ├── customFunctions.ts       ← tenantQuery/tenantMutation/loadByIdInTenant
│   └── roles.ts                 ← roles + capabilities matrix
└── _test/                       ← integration tests (cross-tenant isolation)

src/
├── app/                         ← Next.js routes
└── ...
```

## Próximos passos (executar manualmente)

1. **`npx convex dev`** — login interactivo + criar deployment dev. Cria `convex/_generated/` automaticamente. Mantém a correr em background para hot-reload.
2. Após `_generated/` existir, `npx tsc --noEmit` para verificar tipos.
3. Implementar `convex/_test/tenantIsolation.test.ts` antes de qualquer feature.
4. Schema additions só com migration plan (expand → migrate → contract).
