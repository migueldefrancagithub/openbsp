# OpenBSP — app

Sistema operacional de vendas e atendimento por WhatsApp para clínicas: Inbox, Leads, Campanhas, Agenda, Agentes de IA, Operação e Administração. Next.js 16 (App Router) + Convex. PT 🇲🇿 por defeito, EN opcional.

Regras de produto e arquitectura vivem em [`../PROJECT.md`](../PROJECT.md), [`../AGENTS.md`](../AGENTS.md) e nos ADRs em [`../docs/`](../docs/). Deploy e variáveis de ambiente: [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

## Desenvolvimento

```bash
npm ci
npx convex dev --once   # publica schema/funções no deployment de dev (não usar `codegen`)
npm run dev
```

Verificação por slice (todas têm de ficar verdes antes de um PR):

```bash
npm run typecheck && npm run check:errors && npm test && npm run build
```

`check:errors` falha se algum código `ConvexError` lançado no backend não tiver mensagem PT/EN em `src/lib/convexErrorMessage.ts`.

## Agentes de IA — modos de maturação

Cada agente tem um modo, com override por conversa no Inbox:

| Modo | Comportamento |
|---|---|
| **Sandbox** | Só responde no separador Sandbox do agente. Nunca toca em conversas reais. |
| **Co-Piloto** (predefinição) | Corre o pipeline completo, mas as ferramentas de escrita ficam em dry-run. A resposta e as acções propostas aparecem no Inbox como "Sugestão da IA"; a equipa edita, aprova (envia + executa as acções escolhidas) ou descarta. |
| **Automático** | Responde e marca consultas sozinho, dentro das regras, guards e orçamento diário. |

Onde se muda: cabeçalho do agente em **Agentes** (`[Sandbox | Co-Piloto | Automático]`, exige versão publicada para sair do Sandbox) e cabeçalho da conversa no **Inbox** (`[Co-Piloto | Automático]`, com volta ao modo do agente).

Feedback loop: cada aprovação, edição ou descarte fica em `aiFeedback`; as últimas 8 respostas aprovadas ou editadas entram no prompt do especialista como exemplos da equipa. O separador **Evolução** do agente mostra as contagens e permite remover exemplos.

Todo o envio automático (campanhas, follow-ups, respostas da IA aprovadas ou automáticas) passa pelo router `outboundJobs` e pelo único writer do canal. Chave de IA: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` no Convex, ou chave própria da clínica em **Definições › IA**.

## Smoke tests e release

| Documento | Cobre |
|---|---|
| [`scripts/smoke-phase-a.md`](scripts/smoke-phase-a.md) | Inbox, incidentes do piloto, leads, handoff humano |
| [`scripts/smoke-phase-b.md`](scripts/smoke-phase-b.md) | Campanhas no canal, agenda, follow-ups, RBAC/presença/SLA, admin |
| [`scripts/smoke-phase-c.md`](scripts/smoke-phase-c.md) | Agentes de IA C1–C7 e, na secção **M**, os modos de maturação (sugestão → aprovar/editar/descartar → exemplos) |
| [`scripts/release-phase-ab.md`](scripts/release-phase-ab.md) | Comandos de deploy Convex + backfills das Fases A/B |
| [`scripts/release-phase-c.sh`](scripts/release-phase-c.sh) | Release numa linha: deploy Convex de produção → backfills → merge |

Ordem de release: `npx convex deploy` **antes** do deploy do frontend (`vercel deploy --prod` a partir de `app/`), para a UI nunca chamar funções que ainda não existem.
