# OpenBSP-Convex (codinome temporário)

Fork do **wakit** (ex-OpenBSP) — plataforma WhatsApp Business open-source — reescrita sobre **Convex + Vercel + Next.js** em vez de Supabase + Cloudflare Pages.

## Origem

- Upstream: <https://github.com/matiasbattocchia/wakit-api> + <https://github.com/matiasbattocchia/wakit-ui>
- Managed instance original: <https://app.wakit.ai>
- Licença: **Unlicense** (public domain) — liberdade total para copiar, modificar, vender, sublicenciar
- Mantenedor: Matias Battocchia (trabalha na Mirlo.com, que opera produto comercial em cima do wakit)
- Comunidade: <https://chat.whatsapp.com/Ch6AwZizSDt5quzHodcYh5>

## Decisões fixas

| Eixo | Decisão | Razão |
|---|---|---|
| Backend | **Convex** | Reactive queries nativas, durable functions, scheduled jobs, agents, schema TypeScript em vez de PL/pgSQL |
| Deploy frontend | **Vercel** | Edge functions, preview deployments, Next.js first-class |
| Frontend | **Next.js** (não Vite, ao contrário do wakit-ui) | Vercel SSR/RSC, App Router |
| Versionamento | GitHub | Standard |
| Jurisdição WABA | **PT / UE** | Mercado conhecido, Meta path mais limpo, KYC standard. MZ adiado |
| Horizonte | Projecto de futuro, sem cliente já validado | "Bem feito" prevalece sobre "rápido" |
| Língua | Código em inglês, docs internos em PT-MZ | Standard do Dani |

## Não-decisões (em aberto)

- Status BSP: directo ou via parceiro? Depende da resposta do Matias + Meta
- Subset de features do wakit a portar (97 triggers SQL, 42 funções PL/pgSQL — não tudo)
- Modelo de negócio: open-core vs SaaS vs uso próprio
- Nome final do projecto

## Roadmap (3 actos do conselho)

### Acto 1 — Due diligence pré-código (em curso)

- [ ] Email/mensagem ao Matias (draft em `acto-1/EMAIL_MATIAS.md`)
- [ ] Aplicar Meta Business Verification PT (checklist em `acto-1/META_BSP_PT.md`)
- [ ] Aplicar Tech Provider Programme em paralelo
- [ ] Decidir modelo de negócio com base nas respostas

### Acto 2 — Correr o original (2-4 semanas)

- [ ] `docker compose up` do wakit-api local
- [ ] Ligar a sandbox WhatsApp
- [ ] Mandar 100 mensagens reais — observar comportamento
- [ ] Mapear cada um dos 97 triggers SQL: input → output → side effects → categoria (idempotência / state machine / rate limit / auth / business logic)
- [ ] Documento spec da reescrita Convex

### Acto 3 — Reescrita Convex deliberada (4-8 semanas)

- [ ] Schema Convex (12 entidades core: organizations, organizations_addresses, contacts, contacts_addresses, conversations, messages, agents, api_keys, webhooks, quick_replies, logs, users)
- [ ] HTTP action: `whatsappWebhook` (com idempotência por `messageId`)
- [ ] Mutation: `appendMessage` + scheduled action `dispatchOutgoing`
- [ ] Action: `agentClient` (chama Chat Completions / A2A externos)
- [ ] Helper `requireTenant(ctx)` — disciplina inegociável em toda function
- [ ] UI Next.js: inbox real-time, conversação, agentes, settings
- [ ] Auth: Convex Auth + magic link / Google
- [ ] Storage: Convex file storage para media WhatsApp

### Acto 4 — Plataforma (adiado)

- Marketplace de agentes (idea Prototype Inheritance do Matias em `reference/api/IDEAS.md`)
- BSP-as-a-Service para PALOP
- MCP server embutido (já existe no wakit, portar)
- Open-core monetization

## Estrutura do repo

```
~/openbsp/
├── PROJECT.md                 ← este ficheiro
├── reference/                 ← clones read-only do upstream
│   ├── api/                   ← wakit-api (Deno + Supabase)
│   └── ui/                    ← wakit-ui (React + Vite)
├── acto-1/                    ← due diligence em curso
│   ├── EMAIL_MATIAS.md        ← draft mensagem comunidade/email
│   ├── META_BSP_PT.md         ← checklist Meta Business Verification PT
│   └── INVESTIGATION.md       ← descobertas técnicas
└── app/                       ← (a criar no Acto 3) — fork Convex+Next.js
```

## Princípios de execução

1. **Não traduzir, redesenhar.** Convex tem modelo mental diferente — mutations + actions + scheduler. Tentar mapear 1:1 triggers Postgres produz Frankenstein.
2. **Idempotência explícita.** Toda mutation que processa webhook Meta começa com check em tabela `webhookDedup` por `messageId`. Sem excepção.
3. **Auth disciplina.** `requireTenant(ctx)` na primeira linha de toda mutation/query/action. Sem RLS de rede de segurança, a disciplina é nossa.
4. **Multi-tenant por `orgId`** em toda a row, validado em toda a function.
5. **Agentes externos.** Manter a decisão de arquitectura do wakit: agents AI são serviços externos via Chat Completions / A2A. Não embutir lógica de LLM no Convex.
