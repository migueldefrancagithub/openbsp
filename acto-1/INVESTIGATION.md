# Investigação técnica — wakit (ex-OpenBSP)

Notas de leitura profunda dos repos `wakit-api` e `wakit-ui`. Material de input para o Acto 2 (mapeamento dos triggers) e Acto 3 (design do schema Convex).

## Inventário do upstream

| Métrica | Valor |
|---|---|
| Migrations SQL | 60 |
| Triggers SQL | 97 |
| Funções PL/pgSQL | 42 |
| Edge Functions (Deno) | 6 — `whatsapp-webhook`, `whatsapp-dispatcher`, `whatsapp-management`, `agent-client`, `media-preprocessor`, `mcp` |
| Tabelas core do schema | ~12 |
| Webhook subscriptions Meta | 5 — `account_update`, `messages`, `history`, `smb_app_state_sync`, `smb_message_echoes` |

## Modelo de dados (12 entidades core)

| Tabela | Papel |
|---|---|
| `users` | Mapeado para Supabase Auth — em Convex será mapeado para Convex Auth |
| `organizations` | Tenant. Tem `extra` JSONB com config (response delay, welcome msg, default agent, media preprocessing) |
| `organizations_addresses` | Endereços que a org possui — phone numbers WhatsApp principalmente |
| `contacts` | Pessoas associadas a uma org (entry de address-book) |
| `contacts_addresses` | Endereços de um contacto. **Independente de contacts** — sync triggers gerem linking/unlinking e cleanup de órfãos |
| `conversations` | Conversa entre `org_address` e `contact_address` (ou group_address) por serviço |
| `messages` | Mensagens dentro de uma conversation. Carregam direction, type, payload, status, timestamps |
| `agents` | Humanos ou AI. Podem estar linkados a um auth `user`. Roles: Owner / Admin / Member |
| `api_keys` | Scopadas a uma org. Podem ter scope adicional (`Allowed-Contacts`, `Allowed-Accounts`) |
| `webhooks` | Subscriptions outbound por org |
| `quick_replies` | Snippets reutilizáveis por org |
| `logs` | Erros / warnings de edge functions |

Bonus tables (não core, mas presentes):

- `onboarding_tokens` — JWT-only access para onboarding flows
- `billing.*` — schema de billing separado (plans, products, subscriptions, ledger)
- `storage.objects` — Supabase Storage para media

## Configurações estruturadas

### `OrganizationExtra`

```typescript
{
  response_delay_seconds?: number;        // default 3
  welcome_message?: string;
  authorized_contacts_only?: boolean;
  default_agent_id?: string;
  media_preprocessing?: {
    mode?: "active" | "inactive";
    model?: "gemini-2.5-pro" | "gemini-2.5-flash";
    api_key: string;
    language?: string;
    extra_prompt?: string;
  };
  error_messages_direction?: "internal" | "outgoing";
}
```

### `AgentExtra`

```typescript
{
  mode?: "active" | "draft" | "inactive";
  description?: string;
  api_url?: "openai" | "anthropic" | "google" | "groq" | string;
  api_key?: string;
  model?: string;                         // default gpt-5-mini
  protocol?: "chat_completions" | "a2a";
  assistant_id?: string;
  max_messages?: number;
  temperature?: number;
  max_tokens?: number;
  thinking?: "minimal" | "low" | "medium" | "high";
  instructions?: string;
  send_inline_files_up_to_size_mb?: number;
  tools?: ToolConfig[];
}
```

### Tools built-in (lightweight agents)

- MCP client
- SQL client
- HTTP client
- Calculator

## Fluxo end-to-end (incoming → agent → outgoing)

```
Meta Cloud API
     │
     ▼ POST webhook
whatsapp-webhook (Edge Function)
     │
     │ valida HMAC, parse payload
     ▼
INSERT INTO messages (direction='incoming')
     │
     │ SQL trigger ON INSERT
     ▼
agent-client (Edge Function)
     │
     │ build conversation context
     │ POST chat_completions / a2a → external agent
     │ ← response
     ▼
INSERT INTO messages (direction='outgoing')
     │
     │ SQL trigger ON INSERT (outgoing)
     ▼
whatsapp-dispatcher (Edge Function)
     │
     │ POST WhatsApp Cloud API
     ▼
Meta Cloud API → entrega
```

**Equivalente Convex (proposta):**

```
Meta Cloud API
     │
     ▼ POST
httpAction("whatsappWebhook")
     │
     │ valida HMAC
     │ check messageId em webhookDedup table (idempotência)
     │ ctx.runMutation(internal.messages.appendIncoming)
     ▼
mutation appendIncoming
     │
     │ insert message
     │ ctx.scheduler.runAfter(0, internal.agents.invoke, { messageId })
     ▼
internalAction agents.invoke
     │
     │ build context (ctx.runQuery)
     │ fetch agent config
     │ POST external agent API
     │ ← response
     │ ctx.runMutation(internal.messages.appendOutgoing)
     ▼
mutation appendOutgoing
     │
     │ insert message
     │ ctx.scheduler.runAfter(0, internal.dispatcher.send, { messageId })
     ▼
internalAction dispatcher.send
     │
     │ POST WhatsApp Cloud API
     │ ctx.runMutation(internal.messages.markStatus)
```

## Modelo de auth do wakit (referência)

3 headers, 3 caminhos:

| Header | Carrega | Quem consome |
|---|---|---|
| `apikey` | Supabase anon/publishable key | Kong → PostgREST (define role Postgres) |
| `Authorization` | `Bearer <jwt>` | PostgREST (valida JWT) ou Edge Function (passa) |
| `api-key` | Token wakit | RLS via `get_authorized_orgs()` |

**Equivalente Convex:** API keys via `Authorization: Bearer <wakit_key>` interceptado por middleware no `httpAction`. Resolve `orgId` consultando tabela `apiKeys`. Helper `requireTenant(ctx)` em toda mutation/query/action retorna `{ orgId, agentId, role }` ou throw.

## Features avançadas a notar

### MCP server (`functions/mcp`)

Expõe SSE com tools: `list_accounts`, `list_conversations`, `fetch_conversation`, `search_contacts`, `send_message` (enforça 24h service window), `list_templates`, `fetch_template`. Auth via `Authorization: Bearer <api_key>` + headers opcionais `Allowed-Contacts`, `Allowed-Accounts`.

**Convex:** Convex tem MCP support nativo crescente. Provavelmente expor via Vercel route handler em `/api/mcp/[...path]/route.ts` que proxy para Convex functions.

### Plugin Claude Code

`/plugin install wakit@matiasbattocchia-wakit-api` — extensão Claude Code que dá acesso a query + reply WhatsApp directamente da CLI. Reusa o MCP server.

### Coexistence

Conecta WhatsApp Business Accounts existentes via Embedded Signup. Subscribe a `smb_app_state_sync` e `smb_message_echoes` para sincronizar histórico. **Complexidade alta** — adiar para Acto 4.

### Prototype Inheritance (proposta em IDEAS.md, não implementada)

Org B cria agent que herda de agent publicado de Org A. Override por campo. Tools/instructions/model herdados, secrets ficam com publisher. **Visão correcta para marketplace de agentes** — fortemente alinhado com a recomendação Expansionista.

### Media preprocessing

Audio, image, video, PDF, CSV, HTML, TXT. Usa Gemini 2.5 Pro/Flash. Extração de informação para passar como contexto ao agent.

## Mudanças obrigatórias para Convex

1. **Triggers Postgres → Convex scheduler / mutation chains.** 97 triggers viram pipelines explícitos `mutation → ctx.scheduler.runAfter(0, action)`. Idempotência tem de ser explícita.
2. **PostgREST → Convex queries reactive.** UI deixa de chamar SQL via REST; chama `useQuery(api.conversations.list)` que actualiza automaticamente.
3. **Supabase Realtime → Convex reactive subscriptions.** Built-in, sem configuração.
4. **Supabase Auth → Convex Auth.** Magic link / Google / GitHub / OAuth.
5. **Supabase Storage → Convex File Storage.** API similar; uploads via signed URLs.
6. **RLS → `requireTenant(ctx)` helper.** Disciplina por código, não por banco.
7. **Edge Functions Deno → Convex actions / httpActions.** httpAction para webhooks, internalAction para work assíncrono.
8. **Vite/React → Next.js App Router + RSC.** Vercel optimizado.
9. **PL/pgSQL business logic → TypeScript.** Tudo em TS strict, sem SQL custom.

## Riscos técnicos identificados

| Risco | Mitigação |
|---|---|
| Webhooks Meta repetem entregas | Tabela `webhookDedup` com `messageId` + TTL de 7 dias |
| Race conditions em multi-tenant | `requireTenant(ctx)` no topo de toda function. Audit linter custom. |
| Convex actions não são transaccionais | Separar mutation (transacional, write DB) de action (side effects HTTP). Usar scheduler para encadear. |
| Custo Convex à escala BSP | Modelar antes do Acto 3. Convex cobra por function invocation + DB rows + storage |
| Sem histórico Meta histórico ao migrar | Chamar webhook `history` field para backfill quando ligar nova conta |
| MCP server complexo | Adiar para Acto 4. Não bloqueia Acto 3. |

## Próximos passos imediatos

1. Lançar Acto 1 (email Matias + Meta BSP) — em curso
2. Quando aprovação Meta começar a andar, iniciar Acto 2 (Docker + 100 mensagens reais)
3. Em paralelo com Acto 2, começar a desenhar schema Convex em rascunho
