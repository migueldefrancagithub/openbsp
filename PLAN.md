# PLAN — WhatsApp SaaS multi-tenant (Convex + Next.js + Vercel)

> Multi-tenant. Vertical ÂNCORA = clínicas (MVP + V1, com Cindy-app como dogfood). Outros verticais e features enterprise = V2+ pós-validação. Inspirado em wakit/OpenBSP. Não é BSP de revenda.

## Vocabulário canónico (Low #1 corrigido)

Termos usados em todo o documento — não misturar:

| Termo | Significado |
|---|---|
| `tenant` | Conta empresarial cliente (uma row em `tenants`). Sinónimo informal: "cliente do nosso SaaS" |
| `tenantId` | FK em todas as tabelas multi-tenant. Único identificador de isolamento |
| `vertical` | Categoria de negócio do tenant: `"clinic"`, `"ecommerce"`, `"services"`, `"other"` |
| `member` | Utilizador humano dentro de um tenant (1 user pode pertencer a vários tenants) |
| `WABA` | WhatsApp Business Account na Meta. 1 tenant = 1+ WABAs |
| `phoneNumber` | Número WhatsApp registado dentro de uma WABA |
| `contact` | Pessoa final (paciente, cliente do tenant) com quem se troca mensagens |

`clinicId`, `orgId`, `workspaceId` NÃO existem no código — só `tenantId`.

## 0. Scope confirmado (resposta ao Codex round 1, finding #1)

**Decisão do user (explícita):** "nunca disse somente para clínicas mas sim para médias e grandes empresas". Logo: a plataforma é multi-tenant SaaS para SMB → médias empresas, não app vertical mono-uso.

**Mas o Codex tem razão parcial:** features enterprise (SSO, API pública, e-commerce/fintech vertical packs, roteamento de departamentos, SLA tracking) **não pertencem a MVP/V1**. Foram empurradas para V2+/V3+. MVP e V1 focam: **clínicas dogfood com Cindy-app**, com schema multi-tenant desde o dia 1 (porque retro-fit de tenancy é mais caro que construir desde início).

Trade-off aceite: paga-se complexidade de schema multi-tenant no MVP em troca de não reescrever o esqueleto quando os outros verticais entrarem. Não se constrói código vertical-genérico ainda.

## 1. Visão e não-objectivos

**Visão.** Inbox WhatsApp empresarial de classe mundial, com automação reactive em Convex. Tenant conecta a WABA dele, importa contactos, manda templates a respeitar Meta, responde em equipa, agenda lembretes, e tudo dentro das regras Meta + RGPD.

**Não é (em qualquer fase).** BSP de revenda. Tech Provider Programme. Marketplace de agentes. Substituto de CRM. Plataforma para vender medicamentos/equipamento médico (proibido pela Meta).

**Não é (até V3+).** API pública. SSO. Vertical packs e-commerce/fintech. Roteamento por departamentos. SLA dashboards. Multi-WABA por tenant.

## 2. Personas (MVP/V1)

| Persona | Role | Job |
|---|---|---|
| Owner clínica | `owner` | Conectar WABA, gerir membros, ver tudo |
| Recepcionista | `agent` | Responder mensagens, agendar, confirmar consultas |
| Profissional saúde | `agent` (com flag `healthcareProfessional: true`) | Ver respostas de pacientes seus, sem enviar diagnóstico via WhatsApp |
| Marketing (V1) | `marketing` | Criar templates, lançar recalls/lembretes em massa |

V2 acrescenta: `supervisor`, `compliance`, `viewer`. V3+ acrescenta: departments, multi-vertical roles.

## 3. Casos de uso ANCORA (clínicas — MVP/V1)

Movido para o foco principal (Codex finding #2).

| # | Caso de uso | Fase |
|---|---|---|
| 1 | Recepcionista responde paciente em WhatsApp via inbox app (1:1 inbound + outbound texto) | **MVP** |
| 2 | Lembrete automático 24h antes da consulta (template `appointment_reminder`) | **MVP** |
| 3 | Confirmação de consulta via reply (paciente responde "1=confirmar, 2=cancelar") | **MVP** |
| 4 | Cancelamento de consulta dispara cancel do reminder agendado | **MVP** |
| 5 | No-show recovery: 30min após hora marcada sem check-in, template `noshow_recovery` | **V1** |
| 6 | Recall de pacientes (template marketing aprovado, opt-in obrigatório) — exemplo: "há 6 meses fez tratamento X, vamos rever" | **V1** |
| 7 | Importar contactos via CSV com prova de opt-in por linha | **V1** |
| 8 | Quality monitoring + circuit breaker automático | **V1** |

V2+: outros verticais, dashboards SLA, AI agent.

## 4. Arquitectura (correcção do Codex finding #7 — `ctx.db` só em queries/mutations)

```
                    Meta Cloud API
                          │
                          ▼ HTTPS POST (at-least-once, sem ordem garantida)
              ┌──────────────────────────┐
              │ httpAction               │
              │ /whatsapp-webhook        │
              │   1. validate HMAC       │
              │   2. ctx.runMutation(    │
              │      enqueueWebhook)     │
              │   3. return 200 (<5s)    │
              └──────────────────────────┘
                          │
                          ▼
              ┌──────────────────────────────────┐
              │ mutation enqueueWebhook (atomic) │
              │   - dedup by eventKey            │
              │   - persist raw payload          │
              │   - status = "pending"           │
              │   - schedule processWebhook      │
              └──────────────────────────────────┘
                          │
                          ▼ scheduler.runAfter(0)
              ┌──────────────────────────────────┐
              │ internalAction processWebhook    │
              │   - SEM ctx.db                   │
              │   - parse payload                │
              │   - ctx.runQuery(resolveTenant)  │
              │   - ctx.runMutation(applyEvent)  │
              │   - ctx.runMutation(markDone)    │
              │   - on error: markFailed+retry   │
              └──────────────────────────────────┘
                          │
                          ▼ Convex reactive (pull)
              ┌──────────────────────────┐
              │ Next.js (App Router)      │
              │   - Inbox real-time       │
              │   - Conversation thread   │
              │   - Appointments          │
              │   - Templates / Campaigns │
              └──────────────────────────┘

Outbound flow (outbox pattern — Codex finding #8/#11):
   UI mutation OR scheduled job → mutation enqueueOutbound
       │ (writes message status=queued, dispatchAttempts=0)
       ▼
   scheduler.runAfter(0, internalAction.dispatchOne, { messageId })
       │
       ▼ (action = só HTTP, sem ctx.db)
   internalAction.dispatchOne
       1. ctx.runMutation(claimForDispatch) → atomic claim:
          patches status: queued → dispatching, sets claimedAt
          if already dispatching/sent/unknown → abort silently
       2. ctx.runQuery(loadDispatchPayload)
       3. POST Meta API
          - on network error / timeout / 5xx → ctx.runMutation(markUnknown). NÃO retry.
          - on 4xx pre-accept (validation error) → ctx.runMutation(markFailed)
          - on 200 with wamid → ctx.runMutation(markSent)
   dispatchTimeoutSweep cron (Codex round3 #1): rows stuck in "dispatching" > 5min são marcadas como UNKNOWN (NÃO re-queue, NÃO re-claim). Crash entre POST e markSent é tratado como unknown — exige reconciliação humana via UI ou webhook posterior.
```

**Regra dura nova:** `ctx.db.*` SÓ em `query`, `mutation`, `internalQuery`, `internalMutation`. Em `action`, `internalAction`, `httpAction` apenas `ctx.runQuery`, `ctx.runMutation`, `ctx.scheduler`, `ctx.storage`, `ctx.auth`, `fetch` externo. CI lint regex bloqueia `ctx.db` em ficheiros que exportam action variants.

## 5. Modelo de dados — Convex schema

### 5.1 Tenancy

```typescript
tenants: defineTable({
  name: v.string(),
  vertical: v.union(v.literal("clinic"), v.literal("services"), v.literal("ecommerce"), v.literal("other")),
  healthcareMode: v.boolean(),                       // true if vertical=clinic OR explicitly enabled
  plan: v.union(v.literal("starter"), v.literal("growth"), v.literal("enterprise")),
  settings: v.object({
    defaultLocale: v.string(),                       // "pt-PT"
    timezone: v.string(),                            // "Europe/Lisbon"
    retentionDays: v.number(),                       // default 730 (2 anos), tenant pode reduzir
    businessHours: v.optional(businessHoursValidator),
  }),
  rgpd: v.object({                                   // Codex finding #6
    controllerName: v.string(),
    controllerEmail: v.string(),
    dpaSignedAt: v.optional(v.number()),             // Data Processing Agreement
    dpiaCompletedAt: v.optional(v.number()),         // Data Protection Impact Assessment (mandatório healthcare)
  }),
  createdAt: v.number(),
}),

members: defineTable({
  tenantId: v.id("tenants"),
  userId: v.id("users"),                             // Convex Auth
  role: v.union(v.literal("owner"), v.literal("admin"), v.literal("agent"), v.literal("marketing")),
  healthcareProfessional: v.optional(v.boolean()),   // flag para roles clínicas
  status: v.union(v.literal("active"), v.literal("suspended")),
}).index("by_tenant_user", ["tenantId", "userId"])
  .index("by_user", ["userId"]),
```

### 5.2 WhatsApp connection + Meta App + secret store (Codex round1 #11 + round2 #1, #6)

**Estratégia de Meta App (Codex round2 #1):** UM ÚNICO Meta App controlado pela plataforma (`PLATFORM_META_APP_ID` + `PLATFORM_META_APP_SECRET` em env vars) recebe webhooks de TODAS as WABAs. Cada WABA é onboarded como asset deste app. HMAC validation usa o `PLATFORM_META_APP_SECRET` para todos os payloads. Após validar HMAC, resolvemos `phone_number_id` no payload → `phoneNumber` table → `whatsappAccount` → `tenant`. **Rejeitamos qualquer webhook cujo `phone_number_id` não está bound a uma WABA registada neste app.**

(V3+ pode adicionar multi-app se algum tenant insistir em manter o seu próprio Meta App — endpoints separados por app, secret por app. Não no MVP.)

```typescript
metaApps: defineTable({                              // futuro multi-app; MVP tem 1 row
  metaAppId: v.string(),                             // Meta App ID
  appSecretCiphertext: v.string(),                   // encrypted (mesma master key)
  appSecretIv: v.string(),
  appSecretKeyVersion: v.number(),
  webhookVerifyToken: v.string(),                    // não-secret; usado em GET /whatsapp-webhook?hub.verify_token
  status: v.union(v.literal("active"), v.literal("disabled")),
  rotatedAt: v.optional(v.number()),
}).index("by_app_id", ["metaAppId"]),

whatsappAccounts: defineTable({
  tenantId: v.id("tenants"),
  metaAppId: v.string(),                             // FK to metaApps.metaAppId
  wabaId: v.string(),
  status: v.union(v.literal("active"), v.literal("disconnected"), v.literal("flagged"), v.literal("revoked")),
  qualityRating: v.optional(v.union(v.literal("green"), v.literal("yellow"), v.literal("red"))),
  messagingTier: v.optional(v.string()),
  lastQualityCheckAt: v.optional(v.number()),
  lastTokenHealthCheckAt: v.optional(v.number()),
  tokenStatus: v.union(v.literal("ok"), v.literal("expiring"), v.literal("revoked")),
  // Token validation evidence (Codex round2 #12 — connectManual must validate via Graph API)
  validatedAt: v.optional(v.number()),
  validatedScopes: v.optional(v.array(v.string())),
  tokenExpiresAt: v.optional(v.number()),            // 0 = long-lived
}).index("by_waba", ["wabaId"]).index("by_tenant", ["tenantId"])
  .index("by_app_waba", ["metaAppId", "wabaId"]),    // app/waba binding check

// Secret store — envelope encryption AES-GCM
wabaSecrets: defineTable({
  whatsappAccountId: v.id("whatsappAccounts"),
  ciphertext: v.string(),                            // base64 AES-GCM
  iv: v.string(),
  keyVersion: v.number(),
  encryptedAt: v.number(),
  rotatedAt: v.optional(v.number()),
  lastAccessedAt: v.optional(v.number()),            // for audit trail
  accessCountSinceLastReset: v.number(),             // anomaly detection
}).index("by_account", ["whatsappAccountId"]),

// Toda decrypt operation gera audit log entry (action='waba_secret.decrypt', actor, reason).
// Master key V1, V2, ... em env vars Convex. Rotation cron re-encrypts batch.

phoneNumbers: defineTable({
  tenantId: v.id("tenants"),
  whatsappAccountId: v.id("whatsappAccounts"),
  phoneNumberId: v.string(),                         // Meta phone_number_id
  e164: v.string(),
  displayName: v.string(),
  // Quality / circuit breaker fields (Codex round2 Low #3)
  qualityRating: v.optional(v.union(v.literal("green"), v.literal("yellow"), v.literal("red"))),
  qualityLastErrorAt: v.optional(v.number()),
  qualityLastErrorCode: v.optional(v.string()),
  circuitBreakerUntil: v.optional(v.number()),       // timestamp; if > now → outbound blocked
  circuitBreakerReason: v.optional(v.string()),
  circuitBreakerOpenedAt: v.optional(v.number()),
}).index("by_phone_number_id", ["phoneNumberId"])    // crítico webhook → tenant
  .index("by_tenant", ["tenantId"]),
```

### 5.3 Contacts e consent (Codex round1 #4 + round2 #4)

Consent é split em **DUAS tabelas**: `currentConsents` (estado actual, único por (tenant, contact, purpose, channel) — fonte de verdade para gates de envio) + `consentEvents` (append-only audit trail). Toda mudança é uma transacção atómica que escreve em ambas.

```typescript
contacts: defineTable({
  tenantId: v.id("tenants"),
  e164: v.string(),
  name: v.optional(v.string()),
  locale: v.optional(v.string()),
  tags: v.array(v.string()),
  customAttributes: v.optional(v.any()),             // bounded — ver Low #2 mitigation abaixo
  isMinor: v.optional(v.boolean()),
  createdAt: v.number(),
  erasedAt: v.optional(v.number()),                  // RGPD tombstone
}).index("by_tenant_phone", ["tenantId", "e164"])    // unique enforced em código (upsert)
  .index("by_tenant", ["tenantId"]),

// CURRENT consent — UNIQUE per (tenantId, contactId, purpose, channel). Único row, patched atomicamente.
// É o único site que `requireConsent` lê. Gates de envio NUNCA olham para consentEvents.
currentConsents: defineTable({
  tenantId: v.id("tenants"),
  contactId: v.id("contacts"),
  purpose: v.union(v.literal("transactional"), v.literal("marketing"), v.literal("authentication")),
  channel: v.literal("whatsapp"),                    // V1+ acrescenta sms, email
  status: v.union(v.literal("granted"), v.literal("revoked"), v.literal("unknown")),
  effectiveAt: v.number(),                           // when current state took effect
  lastEventId: v.id("consentEvents"),                // FK para evento que definiu este state
}).index("by_tenant_contact_purpose_channel",
  ["tenantId", "contactId", "purpose", "channel"]),  // unique upsert key

// Append-only audit trail — NUNCA update/delete. Toda transição cria nova row.
consentEvents: defineTable({
  tenantId: v.id("tenants"),
  contactId: v.id("contacts"),
  purpose: v.union(v.literal("transactional"), v.literal("marketing"), v.literal("authentication")),
  channel: v.literal("whatsapp"),
  newStatus: v.union(v.literal("granted"), v.literal("revoked"), v.literal("unknown")),
  source: v.string(),                                // "form_web_v3", "csv_import_<id>", "stop_keyword", "inbound_24h"
  proofText: v.optional(v.string()),                 // texto exacto do consent UI no momento
  proofVersion: v.optional(v.string()),              // hash/versão do form/policy
  proofUrl: v.optional(v.string()),
  capturedAt: v.number(),
  capturedByMemberId: v.optional(v.id("members")),
  ipAddress: v.optional(v.string()),
  userAgent: v.optional(v.string()),
}).index("by_tenant_contact", ["tenantId", "contactId"])
  .index("by_tenant_capturedAt", ["tenantId", "capturedAt"]),

// Inbound message dentro da janela 24h é prova de transactional consent VIA Meta service window
// — mas NÃO grava `currentConsents.status=granted` para marketing. São consents distintos.
```

**Helpers (`convex/lib/consent.ts`):**

```typescript
export async function requireConsent(
  ctx: { db: DatabaseReader },
  args: { tenantId: Id<"tenants">; contactId: Id<"contacts">; purpose: Purpose; channel: "whatsapp" },
): Promise<void> {
  const current = await ctx.db.query("currentConsents")
    .withIndex("by_tenant_contact_purpose_channel", q =>
      q.eq("tenantId", args.tenantId).eq("contactId", args.contactId)
        .eq("purpose", args.purpose).eq("channel", args.channel))
    .unique();
  if (!current || current.status !== "granted") {
    throw new ConvexError({ code: "CONSENT_REQUIRED", purpose: args.purpose });
  }
}

// Toda transition: mutation que faz append + patch ATÓMICO numa única transaction.
export async function recordConsentTransition(
  ctx: MutationCtx,
  args: { tenantId; contactId; purpose; channel; newStatus; source; proof... },
): Promise<void> {
  const eventId = await ctx.db.insert("consentEvents", { ...args, capturedAt: Date.now() });
  const existing = await ctx.db.query("currentConsents")
    .withIndex("by_tenant_contact_purpose_channel", ...).unique();
  if (existing) {
    await ctx.db.patch(existing._id, { status: args.newStatus, effectiveAt: Date.now(), lastEventId: eventId });
  } else {
    await ctx.db.insert("currentConsents", { ...args, status: args.newStatus, effectiveAt: Date.now(), lastEventId: eventId });
  }
  // Cancel cascade (Codex round2 #4): revoke → cancel pending deliveries/scheduled in same flow
  if (args.newStatus === "revoked") {
    await cancelPendingForContact(ctx, args.tenantId, args.contactId, args.purpose, args.channel);
  }
}

async function cancelPendingForContact(ctx, tenantId, contactId, purpose, channel) {
  // 1. campaignDeliveries pending → status="skipped_consent"
  // 2. scheduledMessages scheduled → status="skipped_consent"
  // 3. messages queued → status="failed", failureReason="consent_revoked_pre_dispatch"
  // 4. audit log entry "consent.cascade_cancel" with counts
}
```

**Re-check just-in-time:** mesmo com cascade, `dispatchOne` action faz `requireConsent` no mutation `claimForDispatch` ATÓMICO antes de POST Meta. Se consent foi revogado entre claim e dispatch, mutation throws e atomically marca message como skipped.

### 5.4 Conversations e messages

```typescript
conversations: defineTable({
  tenantId: v.id("tenants"),
  phoneNumberId: v.id("phoneNumbers"),
  contactId: v.id("contacts"),
  status: v.union(v.literal("open"), v.literal("snoozed"), v.literal("closed")),
  assignedAgentId: v.optional(v.id("members")),
  lastMessageAt: v.number(),
  lastIncomingAt: v.optional(v.number()),
  serviceWindowExpiresAt: v.optional(v.number()),    // lastIncomingAt + 24h
  unreadCount: v.number(),
  tags: v.array(v.string()),
}).index("by_tenant_status", ["tenantId", "status"])
  .index("by_tenant_phone_contact", ["tenantId", "phoneNumberId", "contactId"]),

messages: defineTable({
  tenantId: v.id("tenants"),
  conversationId: v.id("conversations"),
  direction: v.union(v.literal("incoming"), v.literal("outgoing")),

  // Idempotência (Codex round1 #6/#8 + round2 #2): Meta API NÃO aceita Idempotency-Key header
  // outbound. Logo o melhor que podemos fazer:
  //   1. Derivar businessKey de objecto estável (ex: scheduledMessageId, campaignDeliveryId,
  //      ou hash(conversationId, agentId, content, intentNonce_from_UI)).
  //      O nonce vem do CLIENTE (UI gera once no submit; reload no UI mantém).
  //   2. Antes do POST Meta, mutation atómica claimForDispatch verifica que NENHUMA outra
  //      message com mesma businessKey está em status sent/dispatching/unknown.
  //   3. Se POST Meta retorna OK + wamid: markSent.
  //   4. Se POST Meta falha (network timeout, 5xx, action morre): markUnknown.
  //      ⚠️ NÃO retry automático. Operação requer reconciliação humana ou via webhook.
  //   5. Reconciliação: se webhook posterior trouxer wamid match a businessKey via
  //      Meta payload metadata? (Meta NÃO devolve a nossa businessKey nos webhooks.)
  //      → Fallback: agente vê message em status="unknown" na UI com botão
  //        "Já enviei? (não reenviar) | Não enviei? (reenviar)".

  businessKey: v.string(),                           // estável; usado para dedup outbound
  metaMessageId: v.optional(v.string()),             // wamid — preenchido em markSent

  type: v.union(/* text, image, video, audio, document, template, interactive, location, contact, reaction, system */),
  content: v.any(),

  // State machine alargada com "unknown" (Codex round2 #2)
  status: v.union(
    v.literal("queued"),                             // criada, ainda não claim
    v.literal("dispatching"),                        // claim feito, POST em curso
    v.literal("unknown"),                            // POST Meta resultado incerto — NÃO auto retry
    v.literal("sent"),                               // Meta confirmou + wamid
    v.literal("delivered"),                          // webhook delivered
    v.literal("read"),                               // webhook read
    v.literal("failed"),                             // erro confirmado pre-Meta-accept
  ),
  // Monotonic guard (Codex round2 Medium #1): status só transita pra frente.
  // Em markStatus, mutation verifica statusRank(new) > statusRank(current); se não, ignora.
  // Ranks: queued=0, dispatching=1, unknown=2, failed=3, sent=4, delivered=5, read=6.
  // Note: failed e sent são terminais e mutuamente exclusivos; unknown só transita para sent
  // (via reconciliação) ou failed (via humano).

  failureReason: v.optional(v.string()),
  failureCode: v.optional(v.string()),
  dispatchAttempts: v.number(),
  claimedAt: v.optional(v.number()),
  nextRetryAt: v.optional(v.number()),               // só usado em pre-claim retries (queued → claim attempt)
  unknownSince: v.optional(v.number()),              // se status=unknown, when it entered

  sentByAgentId: v.optional(v.id("members")),
  sentByCampaignId: v.optional(v.id("campaigns")),
  sentByScheduledMessageId: v.optional(v.id("scheduledMessages")),
  templateId: v.optional(v.id("templates")),
  templateVersion: v.optional(v.number()),

  pricingCategory: v.optional(v.union(v.literal("marketing"), v.literal("utility"),
                                      v.literal("authentication"), v.literal("service"))),
  costMinor: v.optional(v.number()),
  costCurrency: v.optional(v.string()),

  // Healthcare DLP audit trail (Codex round2 #5)
  contentValidationResult: v.optional(v.object({
    passed: v.boolean(),
    blockedReasons: v.optional(v.array(v.string())), // ["medication_name", "diagnosis_keyword", ...]
    overrideByMemberId: v.optional(v.id("members")), // null se sem override
    overrideJustification: v.optional(v.string()),
  })),

  createdAt: v.number(),
}).index("by_meta_id", ["metaMessageId"])
  .index("by_business_key", ["businessKey"])        // dedup outbound
  .index("by_conversation", ["conversationId", "createdAt"])
  .index("by_status_retry", ["status", "nextRetryAt"])
  .index("by_status_unknown", ["status", "unknownSince"]) // UI lista para reconciliação manual
  .index("by_tenant_created", ["tenantId", "createdAt"]),
```

### 5.5 Idempotência: webhookEvents com state machine (Codex round1 #5 + round2 Medium #1)

**eventKey é estável e SEM timestamp** (Codex round2 Medium #1) — Meta retries têm timestamps diferentes mas representam mesmo evento. Timestamp é metadata, não chave.

```typescript
webhookEvents: defineTable({
  // Stable key sem timestamp:
  //   incoming message: hash("msg", phoneNumberId, wamid)
  //   outgoing status:  hash("status", phoneNumberId, wamid, status_value)  // ex: "sent", "delivered", "read"
  //   account update:   hash("account", wabaId, change_field, change_value_hash)
  // Timestamp do evento original guarda-se em rawPayload e em metadata, mas NÃO no eventKey.
  eventKey: v.string(),
  rawPayload: v.string(),                            // JSON stringified
  rawPayloadStorageId: v.optional(v.id("_storage")), // se > 800KB usa Convex File Storage; rawPayload fica sumário
  rawBodySha256: v.string(),                         // hash do raw body original (Codex Low #1)
  metaTimestamp: v.optional(v.number()),             // do payload, NÃO usado para dedup
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("processed"),
    v.literal("failed"),                             // erro permanente após N retries
  ),
  attempts: v.number(),
  lastError: v.optional(v.string()),
  receivedAt: v.number(),
  processedAt: v.optional(v.number()),
  nextRetryAt: v.optional(v.number()),
}).index("by_key", ["eventKey"])                    // dedup primary; query first, insert if absent
  .index("by_status_retry", ["status", "nextRetryAt"]),

// Cron sweep:
//   - delete processed > 7 days (rawPayloadStorageId file também deletado)
//   - retry pending/processing stuck > 5min (max 5 attempts, then failed + alert)
```

**Status update monotonic guard:** `markStatus` mutation valida `statusRank(newStatus) >= statusRank(currentStatus)`. Se webhook `delivered` chegar APÓS `read`, ignora silentemente (incrementa `outOfOrderCount` em metric, sem error). Tabela:

| Status | Rank |
|---|---|
| queued | 0 |
| dispatching | 1 |
| unknown | 2 |
| failed (terminal) | 3 |
| sent | 4 |
| delivered | 5 |
| read | 6 |

### 5.6 Quota ledger (Codex round1 #9 + round2 Medium #2)

**Estados separados:** `reserved` (pre-POST), `failed_pre_provider` (pre-POST falha — pode libertar), **`unknown`** (POST feito, resultado incerto — **NÃO liberta automaticamente**, exige reconciliação), `accepted` (Meta confirmou), `released` (manual override após reconciliação).

```typescript
quotaReservations: defineTable({
  phoneNumberId: v.id("phoneNumbers"),
  messageId: v.id("messages"),                       // 1:1 binding com a message (Codex round2 Medium #2)
  category: v.string(),
  recipientCountry: v.string(),
  recipientE164: v.string(),
  reservedAt: v.number(),
  status: v.union(
    v.literal("reserved"),                           // pre-POST
    v.literal("failed_pre_provider"),                // erro antes de POST (network, validation) — libertar OK
    v.literal("unknown"),                            // POST feito, sem confirmação — NÃO libertar até reconciliar
    v.literal("accepted"),                           // Meta retornou OK
    v.literal("released_after_reconcile"),           // manual; só após human/webhook reconciliação
  ),
  windowKey: v.string(),                             // "phone:abc:day:2026-05-12"
  unknownSince: v.optional(v.number()),
  reconciledAt: v.optional(v.number()),
  reconciledByMemberId: v.optional(v.id("members")),
}).index("by_phone_window", ["phoneNumberId", "windowKey"])
  .index("by_phone_recipient_window", ["phoneNumberId", "recipientE164", "windowKey"])
  .index("by_message", ["messageId"])
  .index("by_status_unknown", ["status", "unknownSince"]),

quotaWindowCounters: defineTable({
  phoneNumberId: v.id("phoneNumbers"),
  windowKey: v.string(),
  // Counter inclui reserved + unknown + accepted (tudo que Meta poderá ter contado).
  // Só `failed_pre_provider` decrementa.
  uniqueRecipientsCount: v.number(),
  totalMessagesCount: v.number(),
  byCategoryCounts: v.any(),
  windowStartAt: v.number(),
  windowEndAt: v.number(),
}).index("by_phone_window", ["phoneNumberId", "windowKey"]),
```

Helpers (`convex/lib/quota.ts`):

- `reserveQuota(...)` → atomic mutation (verify tier limits + insert reservation + increment counter).
- `consumeQuota(reservationId)` → Meta confirmou: status=accepted (counter já incrementado, sem-op).
- `markQuotaPreProviderFailure(reservationId)` → status=failed_pre_provider + atomic decrement counter.
- `markQuotaUnknown(reservationId)` → status=unknown + unknownSince=now. **Counter NÃO decrementa.**
- `releaseQuotaAfterReconcile(reservationId, memberId, evidence)` → manual. Audit log.
- Cron `staleQuotaAlert` (não release): a cada 30min, alerta admin de reservations status=unknown > 1h.
- **Sem `releaseStaleReservations` automático para unknown.**

### 5.7 Templates com versionamento (Codex Medium #4)

```typescript
templates: defineTable({
  tenantId: v.id("tenants"),
  whatsappAccountId: v.id("whatsappAccounts"),
  name: v.string(),                                  // identifier Meta, único por (tenant, language)
  language: v.string(),
  category: v.union(v.literal("marketing"), v.literal("utility"), v.literal("authentication")),
  currentVersion: v.number(),
  status: v.union(v.literal("draft"), v.literal("pending"), v.literal("approved"),
                  v.literal("rejected"), v.literal("paused"), v.literal("disabled")),
  metaTemplateId: v.optional(v.string()),
  qualityScore: v.optional(v.string()),
  syncedAt: v.optional(v.number()),
}).index("by_tenant_name_lang", ["tenantId", "name", "language"]),

templateVersions: defineTable({
  templateId: v.id("templates"),
  tenantId: v.id("tenants"),
  version: v.number(),
  components: v.any(),                               // header/body/footer/buttons (Meta schema)
  parameterSchema: v.any(),                          // tipado: { name: "patientName", type: "string", required: true }
  submittedAt: v.optional(v.number()),
  approvedAt: v.optional(v.number()),
  rejectedAt: v.optional(v.number()),
  rejectionReason: v.optional(v.string()),
  isLocked: v.boolean(),                             // true após submitted; nova edição = nova version
  createdBy: v.id("members"),
  createdAt: v.number(),
}).index("by_template_version", ["templateId", "version"]),
```

Render-time: `renderTemplate(versionId, vars)` valida `vars` contra `parameterSchema` ANTES de POST Meta.

### 5.8 Campaigns + delivery materialization (Codex Medium #5)

```typescript
campaigns: defineTable({
  tenantId: v.id("tenants"),
  name: v.string(),
  templateId: v.id("templates"),
  templateVersion: v.number(),                       // pin version no momento de criar campanha
  segmentSnapshotId: v.optional(v.id("audienceSnapshots")),
  status: v.union(v.literal("draft"), v.literal("materializing"), v.literal("ready"),
                  v.literal("scheduled"), v.literal("sending"), v.literal("paused"),
                  v.literal("completed"), v.literal("cancelled")),
  scheduledFor: v.optional(v.number()),
  rateLimitPerMinute: v.optional(v.number()),
  estimatedCostMinor: v.optional(v.number()),
  audienceCount: v.number(),
  sentCount: v.number(),
  deliveredCount: v.number(),
  readCount: v.number(),
  failedCount: v.number(),
  skippedConsentCount: v.number(),
  skippedQualityCount: v.number(),
  createdBy: v.id("members"),
  createdAt: v.number(),
}).index("by_tenant", ["tenantId"]),

audienceSnapshots: defineTable({                     // imutável depois de materialized
  tenantId: v.id("tenants"),
  campaignId: v.id("campaigns"),
  status: v.union(v.literal("materializing"), v.literal("ready"), v.literal("failed")),
  cursor: v.optional(v.string()),                    // resumable
  totalCount: v.number(),
  materializedAt: v.optional(v.number()),
}).index("by_campaign", ["campaignId"]),

campaignDeliveries: defineTable({
  campaignId: v.id("campaigns"),
  tenantId: v.id("tenants"),
  contactId: v.id("contacts"),
  status: v.union(v.literal("pending"), v.literal("dispatching"), v.literal("sent"),
                  v.literal("delivered"), v.literal("read"), v.literal("failed"),
                  v.literal("skipped_consent"), v.literal("skipped_quality")),
  messageId: v.optional(v.id("messages")),
  failureReason: v.optional(v.string()),
  attemptCount: v.number(),
  claimedAt: v.optional(v.number()),
}).index("by_campaign_status", ["campaignId", "status"])
  .index("by_campaign_contact", ["campaignId", "contactId"]),  // idempotency lookup
```

Materialization flow:
1. `mutation campaigns.materialize(campaignId)` → cria `audienceSnapshot` status=materializing
2. `internalAction materializeAudience` itera segmento via cursor, em batches de 200, cria `campaignDeliveries` (status=pending). Persiste cursor a cada batch.
3. Falha a meio → re-run resume do último cursor.
4. Cancel: mutation `campaigns.cancel` flips status; materialization worker checa em cada batch.
5. Quando count match → snapshot.status=ready, campaign.status=ready.

### 5.9 Appointments + scheduled messages (Codex round1 #2 + round2 Medium #3, #4)

**Indexes compostos com tenantId** (Codex round2 Medium #3) — `externalId` e `sourceRef` podem colidir entre tenants. Sem `tenantId` no index, cancel cross-tenant é trivial.

**Atomic claim** (Codex round2 Medium #4) — execução do scheduled message faz claim atómico que revalida tudo (status, sendAt, appointment, consent, quality) numa única mutation antes de enfileirar dispatch.

```typescript
appointments: defineTable({
  tenantId: v.id("tenants"),
  contactId: v.id("contacts"),
  scheduledFor: v.number(),
  durationMinutes: v.number(),
  status: v.union(v.literal("scheduled"), v.literal("confirmed"), v.literal("cancelled"),
                  v.literal("no_show"), v.literal("completed")),
  professionalName: v.optional(v.string()),
  location: v.optional(v.string()),
  // External sync: tenant + sistema externo + id externo são compostos
  sourceSystem: v.optional(v.string()),              // "google_calendar", "doctoralia_api_v2", etc.
  externalId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_tenant_when", ["tenantId", "scheduledFor"])
  .index("by_tenant_external", ["tenantId", "sourceSystem", "externalId"]), // unique idempotency upsert

scheduledMessages: defineTable({
  tenantId: v.id("tenants"),
  contactId: v.id("contacts"),
  phoneNumberId: v.id("phoneNumbers"),
  templateId: v.id("templates"),
  templateVersion: v.number(),
  variables: v.any(),
  sendAt: v.number(),
  sourceType: v.union(v.literal("appointment_reminder"), v.literal("appointment_confirmation"),
                      v.literal("noshow_recovery"), v.literal("recall_campaign"), v.literal("manual"), v.literal("api")),
  sourceRef: v.optional(v.string()),                 // appointmentId, etc.
  status: v.union(
    v.literal("scheduled"),                          // criado, scheduler armado
    v.literal("claiming"),                           // claim atómico em curso
    v.literal("dispatching"),                        // claim feito, message criada e queued
    v.literal("sent"),                               // message foi sent
    v.literal("cancelled"),                          // upstream cancellation
    v.literal("failed"),                             // erro no claim ou dispatch
    v.literal("skipped_consent"),                    // claim viu consent revogado
    v.literal("skipped_quality"),                    // claim viu circuit breaker
    v.literal("skipped_appointment_invalid"),        // appointment já cancelado/no_show ao acordar
  ),
  claimedAt: v.optional(v.number()),
  convexSchedulerJobId: v.optional(v.string()),
  resultMessageId: v.optional(v.id("messages")),
  attempts: v.number(),
  createdAt: v.number(),
}).index("by_tenant_status_sendat", ["tenantId", "status", "sendAt"])
  .index("by_tenant_source", ["tenantId", "sourceType", "sourceRef"]), // composite com tenantId
```

**Atomic claim flow** (`internalMutation claimScheduledMessageForDispatch`):

```typescript
// Tudo num só mutation, single transaction.
1. load scheduledMessage by id (loadByIdInTenant)
2. if status !== "scheduled" → return "already_processed"
3. if sendAt > now + 60s → return "too_early" (sanity check)
4. patch status="claiming", claimedAt=now (optimistic claim — re-read to confirm)
5. re-load scheduledMessage; if claimedAt != just_set → another worker won, abort
6. validate sourceType context:
   if appointment_reminder/confirmation/noshow:
     load appointments by sourceRef (loadByIdInTenant)
     if status in [cancelled, no_show, completed] → patch="skipped_appointment_invalid"; return
7. requireConsent(transactional or marketing depending on template.category)
   if revoked → patch="skipped_consent"; return
8. check phoneNumber.circuitBreakerUntil < now and qualityRating !== "red"
   if blocked → patch="skipped_quality"; return  // optionally re-schedule
9. reserveQuota
   if QuotaExceededError → patch="failed", failureReason="quota"; return
10. insert message (status=queued, businessKey derived from scheduledMessageId)
11. patch scheduledMessage.status="dispatching", resultMessageId=msg._id
12. ctx.scheduler.runAfter(0, internal.messages.dispatchOne, { messageId })
13. audit log: action="scheduledMessage.claim_dispatched"
```

### 5.10 Audit log append-only + hash chain (Codex round1 Medium #2 + round2 Medium #5)

**Append-only enforced**: `auditLog` writes acontecem APENAS via `internalMutation appendAudit` chamado de helpers internos. Não há mutation que update/delete. Wrappers `tenantMutation`/`tenantQuery` não expõem mutate handler para `auditLog` — apenas lê via `tenantQuery auditLogList`.

**Hash chain**: cada row inclui `prevHash` (SHA-256 do row anterior do mesmo tenant). Anomaly detection cron diário verifica integridade. Tampering implica alterar todas as rows subsequentes.

**WORM export**: cron diário exporta `auditLog` do dia anterior para Convex File Storage (immutable bucket pattern) com hash do dia. V2+ pode ser para S3/R2 externo se cliente exigir.

```typescript
auditLog: defineTable({
  tenantId: v.id("tenants"),
  actorType: v.union(v.literal("member"), v.literal("system"), v.literal("scheduler"), v.literal("api_key")),
  actorId: v.string(),
  actorRoleSnapshot: v.optional(v.string()),         // role no momento da acção
  action: v.string(),
  targetType: v.optional(v.string()),
  targetId: v.optional(v.string()),
  before: v.optional(v.any()),                       // snapshot before (mínimo necessário)
  after: v.optional(v.any()),                        // snapshot after
  metadata: v.optional(v.any()),
  ipAddress: v.optional(v.string()),
  prevHash: v.string(),                              // hash row anterior do mesmo tenant
  selfHash: v.string(),                              // hash desta row (sem selfHash field)
  createdAt: v.number(),
}).index("by_tenant_created", ["tenantId", "createdAt"])
  .index("by_target", ["targetType", "targetId"])
  .index("by_actor", ["actorType", "actorId"]),
```

PII inventory (Codex Medium #2):

| Local | Tem PII? | Política retenção |
|---|---|---|
| `messages.content` | Sim (texto) + media URL | `tenant.settings.retentionDays` (default 730) |
| `webhookEvents.rawPayload` | Sim (texto da mensagem original) | 7 dias (depois delete) |
| `auditLog.metadata` | Pode ter | Mínimo 6 meses (compliance), max 7 anos (lei PT) |
| Convex File Storage (media) | Sim | Mesma do `messages` parent |
| `campaignDeliveries` | Indirecto (contactId) | Cascata com campanha (purge após N anos) |
| `contactConsents` | Sim (proof, IP) | **Mínimo 5 anos pós-revoke** (RGPD prova de consentimento) |
| Convex backups (snapshots) | Sim | Encrypted-at-rest pelo Convex; documentar em DPA |
| Logs de aplicação (console.log) | Evitar | Filtro em código: nunca log full message body |

Cron `retentionSweep`: aplica `retentionDays` por tenant. Erase = tombstone (`erasedAt` em contacts) + null payload em messages + DELETE physical files.

## 6. Helpers obrigatórios — wrappers derivam tenant do context (Codex round1 #10 + round2 #3)

**Princípio reforçado:** tenantId NUNCA vem do caller via args/header confiáveis. É **derivado**:
- Em `tenantQuery`/`tenantMutation`: vem dos members do user autenticado (single-tenant per session) ou do `tenantSlug` do path Next.js validado contra membership.
- Em `tenantAction` chamado de UI: idem.
- Em loaders por ID: `loadByIdInTenant` verifica tenant fence; preferred é `loadResourceWithTenant` que retorna `{ doc, tenantId }` e usa esse tenantId em chamadas downstream.

```typescript
// convex/lib/customFunctions.ts
import { customCtx, customMutation, customQuery, customAction } from "convex-helpers/server/customFunctions";

// Sessão tem tenantId activo: persistido em sessions table + cookie do Next.js.
// Switch tenant = mutation que valida membership + actualiza session.
async function resolveActiveTenant(ctx): Promise<{ userId, memberId, tenantId, role }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError({ code: "UNAUTHENTICATED" });
  const session = await ctx.db.query("sessions").withIndex("by_user", q => q.eq("userId", userId)).unique();
  if (!session) throw new ConvexError({ code: "NO_ACTIVE_TENANT" });
  const member = await ctx.db.query("members")
    .withIndex("by_tenant_user", q => q.eq("tenantId", session.activeTenantId).eq("userId", userId)).unique();
  if (!member || member.status !== "active") throw new ConvexError({ code: "FORBIDDEN" });
  return { userId, memberId: member._id, tenantId: session.activeTenantId, role: member.role };
}

export const tenantQuery = customQuery(query, customCtx(async (ctx) => {
  const t = await resolveActiveTenant(ctx);
  return { ...t };
}));
export const tenantMutation = customMutation(mutation, customCtx(async (ctx) => {
  const t = await resolveActiveTenant(ctx);
  return { ...t };
}));

// Loader: por ID + valida tenant fence. Throws CROSS_TENANT_ACCESS.
export async function loadByIdInTenant<T extends TableNames>(
  ctx: { db: DatabaseReader; tenantId: Id<"tenants"> },
  table: T,
  id: Id<T>,
): Promise<Doc<T>> {
  const doc = await ctx.db.get(id);
  if (!doc) throw new ConvexError({ code: "NOT_FOUND" });
  if (!("tenantId" in doc) || (doc as any).tenantId !== ctx.tenantId) {
    throw new ConvexError({ code: "CROSS_TENANT_ACCESS", table, id });
  }
  return doc;
}

// Loader recursivo seguro: load child by parent FK.
// Ex: loadConversationMessages(ctx, conversationId) — primeiro carrega conversation
// (tenant fence), depois lista messages by conversation.
// CI test garante que não há query/mutation que faz ctx.db.get(someId) sem este wrapper.

// Capability matrix declarativa.
const CAPABILITY_MATRIX: Record<Role, Record<Capability, boolean>> = {
  owner: { /* all true */ },
  admin: { /* all except billing.delete, member.transfer_ownership */ },
  agent: { "messages.send": true, "conversations.assign_self": true, ... },
  marketing: { "campaigns.create": true, "templates.create": true, ... },
};
export function requireCapability(role: Role, capability: Capability): void {
  if (!CAPABILITY_MATRIX[role]?.[capability]) {
    throw new ConvexError({ code: "FORBIDDEN_CAPABILITY", capability, role });
  }
}
```

**Schema constraint nova:** TODA tabela com dados de tenant DEVE ter `tenantId: v.id("tenants")` como primeiro campo após `_id`. CI lint regex valida. Tabelas globais (sem tenantId): `tenants`, `users` (Convex Auth), `metaApps`, `sessions`. Mais nada.

**CI tests obrigatórios para multi-tenant isolation:**

1. Para cada query/mutation pública: test gera 2 tenants + 2 users (user1 só em tenant1), tenta aceder dados de tenant2 com user1, expects `CROSS_TENANT_ACCESS` ou `FORBIDDEN`.
2. Para cada `loadByIdInTenant` call site: test passa ID de outro tenant, expects throw.
3. Para internal actions/mutations: test que actor tenant scope match resource tenant scope.
4. Para httpActions com API keys (V3): scope check.

Falha em qualquer destes bloqueia CI.

## 7. Compliance Meta + Healthcare (Codex round1 #3 + round2 #5)

### 7.1 Healthcare mode obrigatório — também aplica a free-text + media (Codex round2 #5)

`tenant.healthcareMode = true` activa, no código:

**Templates (allowlist):**
- `appointment_reminder`, `appointment_confirmation`, `appointment_cancellation`, `noshow_recovery`
- `lab_result_ready` — só link para portal seguro, NÃO o resultado em si
- `recall_followup` — sem claim médico, sem nome de medicamento
- `prescription_refill_reminder` — sem incluir nome de fármaco no body
- Templates fora desta lista: rejeitados em submit.

**Denylist regex aplicado a (a) templates body, (b) free-text composer, (c) media OCR/captions:**
- "diagnóstico", "diagnostic", "diagnos", "cura", "guaranteed result", "tratamento garantido"
- DCI medicamentos sujeitos a receita (lista INFARMED PT, configurável + cron de actualização)
- Detecção de números que parecem dosagem ("500mg", "50ui", "2x ao dia")

**Free-text composer (`sendText`):** validador `validateOutgoingContent({ text, role, healthcareMode })` corre antes de `claimForDispatch`:

```typescript
1. if !healthcareMode → permit
2. run regex denylist on text
3. if hits + role !== "owner"/"admin" → block, audit log "content.blocked"
4. if hits + role in allowed roles → require explicit override:
     mutation accepts override={ blockedReasons, justification: string }
     audit log entry includes overrideByMemberId + justification
     UI shows confirm modal "Esta mensagem inclui termos sensíveis. Justifica:"
5. if no hits → permit
```

**Media (`sendMedia`):** before POST Meta:
- Image/document: opcional Convex action que invoca external OCR (Gemini Vision); resultado vai pelo mesmo `validateOutgoingContent`.
- MVP: media upload em healthcare mode é restrito a roles owner/admin com aviso "envio de media inclui responsabilidade clínica directa".
- **Allowlist sources:** receitas, fotos clínicas, etc. exigem categoria explícita de upload (UI dropdown obrigatório). Categoria vai para audit.

**Canned replies por defeito:** healthcare mode UI mostra biblioteca de respostas logísticas pré-aprovadas como sugestões antes de o agente abrir composer livre. Reduz surface de free-text.

**Diagnóstico/prescrição/resultados clínicos via WhatsApp = proibido por código.** Mesmo com override, regras absolutas (nome de medicamento controlado, palavra "diagnóstico" sem contexto): **bloqueio sem override possível**. Apenas owner pode levantar via mutation `tenants.disableHealthcareGuard` que requer DPIA notes update + audit log permanente.

**Menores:** `contact.isMinor=true` bloqueia qualquer template marketing. Apenas transactional permitido com consent dos pais (registado em `consentEvents.proofText`).

**DPIA obrigatória:** tenant não pode connect WABA até `rgpd.dpiaCompletedAt != null`. Wizard guiado in-app gera DPIA preenchível.

**DPA:** template DPA standard (Dani como processor, tenant como controller). Tenant aceita digitalmente (signed agreement table, cryptographically signed); sem isso, conexão WABA bloqueada.

**Connect WABA validação completa (Codex round2 Medium #6):** mutation `connectManual` faz, antes de aceitar token:
1. POST `https://graph.facebook.com/v21.0/me?fields=id,name` com Bearer → valida token vivo + extract user_id.
2. POST `https://graph.facebook.com/v21.0/me/permissions` → check scopes contém `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management`. Falta scope → reject.
3. Reject if `user.type === "USER"` (token de user pessoal, não system user).
4. POST `https://graph.facebook.com/v21.0/{wabaId}` → valida WABA existe e token tem acesso.
5. POST `https://graph.facebook.com/v21.0/{wabaId}/phone_numbers` → enumerate phone numbers; only those declared by tenant são linked.
6. Verificar `app_id` do token == `PLATFORM_META_APP_ID` (rejeita tokens cross-app).
7. Detectar token expiry (long-lived = 60d ou never; armazenar `tokenExpiresAt`).
8. Audit log `waba.connect_validated` com scope list, app_id, evidence.
9. Encrypt + insert `wabaSecrets`. Mark `whatsappAccount.validatedAt`.

### 7.2 Restrições de mercado

- **Bloquear onboarding** se admin escolhe país EUA ou França para a WABA (UX message: "WhatsApp Business não está disponível para healthcare em EUA e França por restrições legais — contacte-nos").
- Lista de países permitidos para healthcare = whitelist explícita (PT, ES, BR, MX, IT, DE com exceção, etc. — atualizada de Meta docs).

### 7.3 Pricing per-message + UI cost preview

- `convex/lib/meta/pricing.ts` mantém tabela `(country, category) → costMinor` (cêntimos EUR).
- Tabela actualizada via cron mensal que pulla Meta pricing API (quando estiver disponível) ou hardcoded com data update fields.
- Toda criação de campanha mostra `estimatedCostMinor = audienceCount × pricing(country, category)`.
- Toda mensagem outgoing armazena `costMinor` real após Meta confirma.

### 7.4 Quality circuit breaker (Codex Medium #6)

- Pre-flight em **cada batch** de campanha (não só no start): `phoneNumber.qualityRating !== "red"`.
- Se Meta retorna error code que indica quality drop (ex: 131049, 131045): `circuitBreakerOpen` flag em phoneNumber (timestamp). Bloqueia outbound por 30min.
- Quality refresh: cron diário 04:00 UTC + on-demand poll (se circuit aberto, poll a cada 10min até verde).

### 7.5 Stop keyword automation

- Inbound message contém regex match `^\s*(stop|parar|cancelar|sair|unsubscribe|baja)\s*$` (case-insensitive) → mutation `revokeAllConsents(contactId)` + envio automático service message confirmando + audit log.
- **Marketing template DEVE** incluir footer "Responda STOP para sair" (forçado por linter de template ao submit).

## 8. Custos Convex modelados (Codex Medium #1)

Estimativa com base em [Convex pricing 2026](https://www.convex.dev/pricing): function calls $2/M, database storage $0.20/GB-month, bandwidth $0.30/GB, file storage $0.03/GB-month, scheduled functions $2/M.

### Tenant pequeno (1 clínica, 5 agentes, 1 phone, 200 contactos, 2k msgs/mês)

| Componente | Volume | Custo |
|---|---|---|
| Webhook events (incoming + 4 status × outgoing) | ~10k/mês | $0.02 |
| Mutations (append, mark, claim, etc.) | ~15k/mês | $0.03 |
| Action invocations (Meta dispatch + media) | ~3k/mês | $0.006 |
| Reactive queries (5 agentes × 8h × 30 dias × ~50 q/min de inbox aberto) | ~36M/mês | **$72** ← preocupante |
| Scheduled functions (reminders, crons) | ~3k/mês | $0.006 |
| DB storage (50MB) | 0.05GB | $0.01 |
| File storage (1GB media) | 1GB | $0.03 |
| Bandwidth | ~500MB | $0.15 |
| **Total estimado** | | **~$72/mês** |

Reactive queries são o **custo dominante**. Mitigações desde V1:
- Throttle subscriptions (debounce, rate-limit Convex `useQuery` hooks).
- Paginação de inbox (cursor-based, top 50 conversations).
- Background tab → unsubscribe (visibility API).
- Aggregate cache: `inboxStatsCache` table actualizada por mutation, query lê cache (1 doc), não count() ao vivo.

### Tenant médio (5 clínicas grupo, 20 agentes, 3 phones, 5k contactos, 30k msgs/mês)

Após mitigations (paginação + cache): **~$180-300/mês Convex** + custo Meta variável.

### Tenant grande (50 agentes, 50k msgs/mês)

**~$400-700/mês Convex** após optimizations. Documentado em pricing model: tenant grande paga "Enterprise" plan que cobre infra cost + margem.

**Acção MVP:** instrumentar `convex dashboard` desde dia 1, weekly review de top function calls. Decidir paginação default antes de inbox V1.

## 9. API surface (reduzida — sem API pública até V3)

```
convex/
├── http.ts
│   └── /whatsapp-webhook (httpAction) — único endpoint público até V3
│
├── webhooks/
│   ├── enqueueWebhook (mutation, called from httpAction)
│   ├── processWebhookEvent (internalAction, scheduler)
│   ├── markWebhookProcessed (internalMutation)
│   └── markWebhookFailed (internalMutation)
│
├── messages/
│   ├── sendText (tenantMutation)
│   ├── sendTemplate (tenantMutation)
│   ├── claimForDispatch (internalMutation, atomic)
│   ├── markSent (internalMutation)
│   ├── markStatus (internalMutation)
│   ├── markFailed (internalMutation)
│   ├── markUnknown (internalMutation)
│   ├── reconcileUnknown (tenantMutation — UI human reconciliation: marca sent ou failed após verificação)
│   ├── dispatchOne (internalAction)
│   ├── dispatchTimeoutSweep (internalAction, cron — marca dispatching > 5min como UNKNOWN, NÃO re-queue)
│   ├── list (tenantQuery, paginated)
│   └── search (tenantQuery, V1+)
│
├── conversations/
│   ├── list (tenantQuery, paginated cursor)
│   ├── assign, snooze, close, reopen, markRead (tenantMutation)
│
├── contacts/
│   ├── upsert (tenantMutation)
│   ├── importCsv (tenantAction — parse + validate + batch upsert)
│   └── search (tenantQuery)
│
├── consents/
│   ├── recordConsent (tenantMutation)
│   ├── revokeConsent (tenantMutation)
│   ├── stopKeywordHandler (internalMutation, called from webhook worker)
│   └── verify (helper used internally)
│
├── templates/
│   ├── createDraft (tenantMutation)
│   ├── submitForApproval (tenantAction — locks current version, POST Meta)
│   ├── syncFromMeta (tenantAction — pull approved/rejected status)
│   ├── createNewVersion (tenantMutation — for edits after approved)
│   └── list, getRendered (tenantQuery)
│
├── campaigns/
│   ├── create (tenantMutation, draft)
│   ├── estimateCost (tenantQuery)
│   ├── materialize (tenantMutation, kicks internalAction)
│   ├── materializeAudience (internalAction, cursor-resumable)
│   ├── start (tenantMutation, status → sending, schedule first batch)
│   ├── pause, cancel (tenantMutation)
│   ├── dispatchBatch (internalAction, throttled per rateLimitPerMinute)
│   └── stats (tenantQuery)
│
├── appointments/                                   ← MVP
│   ├── create, update, cancel, complete, markNoShow (tenantMutation)
│   ├── list (tenantQuery)
│   └── (mutations trigger scheduledMessages create/cancel)
│
├── scheduledMessages/
│   ├── schedule (tenantMutation — cria + scheduler.runAt)
│   ├── cancel (tenantMutation)
│   ├── execute (internalAction — fired by scheduler)
│   └── watchdog (cron — retry failed)
│
├── whatsappAccounts/
│   ├── connectManual (tenantAction, MVP) — admin cola system user token
│   ├── disconnect (tenantMutation)
│   ├── refreshQuality (internalAction, cron)
│   └── tokenHealthCheck (internalAction, cron)
│
├── quota/
│   ├── reserveQuota (internalMutation, atomic)
│   ├── consumeQuota (internalMutation)
│   ├── releaseQuota (internalMutation)
│   ├── circuitBreaker (internalMutation)
│   └── staleQuotaAlert (cron — só ALERTA admin de reservations unknown > 1h, NÃO release auto)
│
├── members/
│   ├── invite, accept, remove, changeRole (tenantMutation)
│   └── list (tenantQuery)
│
├── analytics/                                      ← V1+
│   ├── inboxStats (tenantQuery, lê cache)
│   ├── campaignStats (tenantQuery)
│   └── costBreakdown (tenantQuery)
│
├── compliance/
│   ├── exportContact (tenantAction — RGPD export, retorna ZIP signed URL)
│   ├── eraseContact (tenantAction — tombstone)
│   ├── auditLogList (tenantQuery)
│   └── retentionSweep (cron)
│
├── lib/
│   ├── customFunctions.ts (tenantQuery, tenantMutation, tenantAction wrappers)
│   ├── auth.ts (requireMember, requireCapability, loadByIdInTenant)
│   ├── consent.ts
│   ├── quota.ts
│   ├── idempotency.ts (eventKey, dispatchKey)
│   ├── meta/
│   │   ├── client.ts (HTTP client com retries + backoff)
│   │   ├── verify.ts (HMAC X-Hub-Signature-256)
│   │   ├── pricing.ts
│   │   ├── templates.ts (validation, denylist regex healthcare)
│   │   └── secrets.ts (envelope encryption WABA tokens)
│   └── validators.ts
│
└── crons.ts
    ├── webhookEventsRetry — every 1 min (pending stuck)
    ├── webhookEventsCleanup — daily 03:00 UTC (delete > 7d)
    ├── dispatchTimeoutSweep — every 1 min (stuck dispatching > 5min → UNKNOWN, alerta admin)
    ├── staleQuotaAlert — every 30 min (só alerta unknown > 1h; NÃO release auto)
    ├── releaseFailedPreProviderReservations — every 5 min (só release status=failed_pre_provider)
    ├── qualityRefresh — daily 04:00 UTC + on-demand
    ├── tokenHealthCheck — daily 05:00 UTC
    └── retentionSweep — daily 06:00 UTC
```

V2 acrescenta: roteamento, SLA tracking, AI agent, embedded signup. V3 acrescenta: API pública, SSO, outros verticais.

## 10. Frontend (Next.js App Router) — MVP/V1

```
app/
├── (auth)/login, /accept-invite/[token]
├── (app)/
│   ├── layout.tsx
│   ├── inbox/
│   │   ├── page.tsx — list paginated reactive
│   │   └── [conversationId]/page.tsx — thread + composer
│   ├── appointments/
│   │   ├── page.tsx — calendar view
│   │   └── [id]/page.tsx — detail + reminder status
│   ├── contacts/page.tsx, /import, /[id]
│   ├── templates/page.tsx, /[id], /[id]/version/[v]
│   ├── campaigns/page.tsx, /new, /[id]
│   └── settings/
│       ├── account, members, whatsapp-numbers
│       └── compliance/audit-log, /dpia, /dpa
└── api/
    ├── meta-webhook-proxy (route handler — só se separamos webhook do Convex; V1 webhook vai direto a Convex httpAction; não precisamos de proxy)
    └── stripe/webhook (V2 billing)
```

## 11. Roadmap honesto (Codex #12)

Solo dev, PT, projecto futuro sem cliente. Estimativas em **semanas calendário** assumindo ~25h/sem reais (não 40h, porque solo dev tem también admin/research/burnout).

### MVP (8 semanas) — "Cindy-app dogfood com RGPD essentials"

Foco: 1 clínica (Dani / Cindy-app), 1 phone, recepcionista responde + appointments com reminders. Codex round2 #6 obriga RGPD essentials antes de tráfego real → +2 sem vs estimativa anterior.

- **Sem 1-2:** Convex setup + schema completo (tenants, sessions, members, metaApps, whatsappAccounts, wabaSecrets, phoneNumbers, contacts, currentConsents, consentEvents, conversations, messages, webhookEvents, appointments, scheduledMessages, auditLog, quotaReservations, quotaWindowCounters). Convex Auth magic link. Wrappers `tenantQuery/tenantMutation` derivam tenantId do session. Integration tests de tenant isolation (CI gate).
- **Sem 3:** httpAction webhook + helper `verifyMetaHmac` (raw body, constant time) + webhookEvents state machine + processWebhook internalAction. Healthcare mode flag (default true).
- **Sem 4:** Outbox: businessKey derivation, claimForDispatch atómico, dispatchOne action (status→unknown em network error, sem auto-retry), markSent/markStatus monotonic guard, watchdog cron. Inbound text end-to-end sandbox.
- **Sem 5:** Outbound text 1:1 com `validateOutgoingContent` (denylist + override + audit). Appointments CRUD + scheduledMessages com `claimScheduledMessageForDispatch`. Submeter template `appointment_reminder` à Meta (paralelo).
- **Sem 6:** **RGPD essentials (Codex round2 #6):** DPIA wizard, DPA aceite digital, exportContact, eraseContact (tombstone + media delete), retentionSweep cron, audit log append-only com hash chain. Connect WABA SÓ depois de DPIA+DPA assinados.
- **Sem 7:** Inbox UI Next.js (list + thread + composer + healthcare warning UI). Confirm/cancel via reply parser. Stop keyword cascade. Quota ledger ligado a dispatch.
- **Sem 8:** Connect WABA real PT (com `connectManual` validation completa via Graph API). Deploy Vercel + Convex prod. Dogfood Cindy-app 1 semana.

**Critério MVP:** Dani usa 7 dias com clientes reais Cindy-app. Reminders disparam, recepção responde, zero perda/duplicado, RGPD export/erase testados, audit hash chain íntegro.

### V1 (8 semanas adicionais — total 16 semanas) — "Outras 2 clínicas adoptam"

- **Sem 7-8:** Templates: createDraft, versionamento, submitForApproval, syncFromMeta. Marketing template healthcare-allowed (recall_followup).
- **Sem 9-10:** Campaigns: materialize cursor-resumable, dispatchBatch throttled, cost preview, pause/cancel. CSV import com prova de opt-in por linha.
- **Sem 11:** Quality circuit breaker per-batch + auto-pause yellow + block red. Cron + on-demand poll.
- **Sem 12:** Members + roles (owner/admin/agent/marketing). Invite flow.
- **Sem 13:** Compliance: exportContact (ZIP signed URL), eraseContact (tombstone + file delete), auditLogList UI, retentionSweep cron, DPIA wizard, DPA aceite digital.
- **Sem 16:** Onboarding 2 clínicas externas (não-Dani). Buffer.

**Critério V1:** 3 tenants externos em produção 30 dias sem incidente crítico. Cost preview matches actual Meta cost dentro de 5%.

### V2 (12 semanas adicionais — total 28 semanas)

- Embedded Signup Meta (se Meta deixar para nosso plan, V2 — caso contrário V3).
- Routing por departamento + SLA tracking + dashboards.
- AI agent draft-mode (Chat Completions external, dados sensíveis mascarados, handoff humano obrigatório healthcare).
- Notas internas, tags avançadas.
- Outbound webhooks para sistemas externos clínicos.
- Multi-phone-number per WABA.
- Stripe billing.

### V3+ (post 28 semanas)

- API pública v1 (REST com api keys hardened).
- SSO (Google Workspace, Azure AD).
- Outros verticais (e-commerce, services).
- Marketplace agentes (Prototype Inheritance referência wakit).

**Aviso explícito ao próprio:** roadmap acima é optimista. V1 a 14 semanas assume que MVP correu sem grandes desvios e Meta approval de templates não atrasa. Se Meta demora 4 semanas a aprovar template, V1 fica em 18 semanas. Plano não-conditional: ajustar.

## 12. Riscos e mitigações (atualizado)

| Risco | Severidade | Mitigação |
|---|---|---|
| Webhook duplicates → mensagens duplicadas a paciente | **Crítica** | `webhookEvents` state machine + `messages.by_dispatch_key` lookup antes de POST + `campaignDeliveries.by_campaign_contact` lookup |
| Esquecer requireMember vaza dados entre tenants | **Crítica** | `tenantQuery`/`tenantMutation` wrappers + `loadByIdInTenant` helper + integration tests obrigatórios em CI por public function |
| Action escreve directamente no DB (race) | **Crítica** | Lint CI: ficheiros que exportam action vars não podem importar `ctx.db.*` |
| Stuck dispatch (action morre após Meta POST mas antes de markSent) | Alta | businessKey lookup antes de POST; **dispatchTimeoutSweep marca stuck > 5min como UNKNOWN, NÃO re-queue** (Codex round3 #1); reconciliação humana obrigatória via UI ou webhook posterior |
| Quality cai entre polls e campaign continua | Alta | Pre-flight POR BATCH; circuit breaker on Meta error codes; auto-pause yellow 2 dias, vermelho immediate |
| Tenant clínica envia conteúdo proibido (diagnóstico, medicamento) | **Crítica** | Healthcare mode allowlist templates + denylist regex + DPIA wizard + DPA |
| Token WABA exposed em logs | Alta | Envelope encryption em `wabaSecrets`; lint regex bloqueia console.log com vars contendo "token"; access audited |
| Master key envelope encryption perdida | **Crítica** | Backup offline da master key; key rotation cron; multi-version support |
| Custo Convex explode com reactive subscriptions | Alta | Paginação default; aggregate cache; visibility-aware unsubscribe; weekly cost review |
| Solo dev burnout V1 | **Alta** | Estimativas com 25h/sem; MVP a 6 sem; roadmap V1 14 sem; aceitar slips, não comprimir scope |
| RGPD audit pede dados que não temos | Média | PII inventory documentado; exportContact testado em V1; DPA assinada antes de produção |
| Convex backups não cumprem retentionDays | Média | Documentar em DPA que backups ficam até X (Convex policy); tenant assina aceitação |
| AI agent V2 gera resposta com claim médico | Alta | Draft-only obrigatório healthcare; prompts policy explícitos; testes adversariais; handoff humano |
| Materialização campaign falha a meio com 50k destinatários | Média | Cursor pagination resumable; checkpoint a cada batch; cancel-aware |
| Quotas Meta excedidas por concurrent campaigns + reminders | Alta | Quota ledger central com reserve antes de POST; release stale 5min |
| Meta template approval atrasa MVP | Média | Submeter `appointment_reminder` template em sem 1 (paralelo com dev); fallback texto-livre dentro 24h window |
| Clínica EUA/França tenta fazer onboarding | Média | Bloqueio em código por country code WABA; mensagem UX clara |

## 13. Decisões técnicas justificadas

(Mantidas as anteriores válidas + novas decisões pós-Codex.)

| Decisão | Justificação |
|---|---|
| Convex em vez de Supabase | Reactive subscriptions nativas, scheduler integrado, TS end-to-end. Custo: sem RLS = wrappers tipados + integration tests CI. |
| `tenantId` único FK isolamento (não orgId/clinicId/etc.) | Vocabulário canónico evita drift. |
| Multi-tenant schema desde MVP, mesmo com 1 tenant (Dani) | Retro-fit de tenancy é mais caro que construir desde início. |
| `requireMember` em wrapper customQuery/customMutation, não só primeira linha | Codex finding #10 — "primeira linha" depende de disciplina humana; wrappers + tests forçam. |
| `ctx.db` proibido em actions | Convex actions não são transaccionais; correctness exige mutations atomic + actions só HTTP. |
| Outbox pattern (queued → dispatching → sent) com claim atómico | Crash entre POST Meta e markSent não duplica nem perde. |
| Webhook state machine com retries + watchdog | At-least-once delivery exige dedup PERSISTIDA, não só log de processed. |
| Quota ledger central por phoneNumber+category+country | Concurrent campaigns + reminders + manual sends concorrem mesmo tier; sem ledger central, easy to exceed. |
| Consent vector (purpose/channel) em vez de boolean optIn | RGPD distingue transactional vs marketing; misto = base legal inválida. |
| Healthcare mode = allowlist templates, não denylist regex livre | Denylist regex é game-of-whack-a-mole; allowlist é safer-by-default. |
| Templates versionados, isLocked após submit | Editar template aprovado sem nova version corrompe estado Meta. |
| Audience snapshot imutável após materializing | Resegmentar mid-flight bagunça stats; force user a criar nova campaign. |
| Quality check per-batch, não só per-day cron | Quality pode degradar em minutos durante big broadcast. |
| Envelope encryption WABA tokens (master key em env, ciphertext em DB) | Convex não tem secret store dedicated; envelope é standard pattern. |
| Convex Auth no MVP, Clerk só V3 se SSO Enterprise pedido | Custo zero, suficiente. |
| Sem API pública até V3 | Evita design-debt prematuro; foco MVP em UI dogfood. |
| MVP em 6 sem, V1 em 14 sem total | Honesto solo dev. Não comprimir. |

## 13.4 Operations: rollback, observability, runbooks (Codex round3)

### 13.4.1 Feature flags + kill switches (Codex round3 #2)

```typescript
featureFlags: defineTable({
  // Scope: global (tenantId=null) ou per-tenant. Per-phone via flagKey "outbound:phone:abc".
  tenantId: v.optional(v.id("tenants")),             // null = global
  flagKey: v.string(),                               // canonical key list abaixo
  enabled: v.boolean(),
  reason: v.optional(v.string()),                    // "incident-2026-05-12", "rollout-canary"
  changedByMemberId: v.optional(v.id("members")),
  changedAt: v.number(),
}).index("by_scope_key", ["tenantId", "flagKey"]),

// Canonical flag keys (typed enum):
//   "outbound.global.disabled"             — bloqueia TODO outbound (reverte ban Meta)
//   "outbound.tenant.disabled"             — per-tenant
//   "outbound.phone.disabled"              — per-phoneNumberId
//   "campaigns.dispatch.paused"            — pausa novos dispatch batches (queue mantém)
//   "scheduledMessages.dispatch.paused"    — idem para scheduled
//   "webhooks.processing.paused"           — webhook ainda recebe + persiste, mas não processa worker
//   "dlp.healthcare.enforcement"           — DEFAULT true; toggle para shadow mode (log only)
//   "campaigns.canary.maxRecipientsPerBatch" — int; default 50 nova campanha
//   "convex.subscriptions.aggressiveThrottle" — emergency cost reduction
```

**Gates obrigatórios:**

- `claimForDispatch` mutation lê `outbound.global.disabled` + `outbound.tenant.disabled` + `outbound.phone.disabled`. Qualquer true → throw `OUTBOUND_BLOCKED_BY_FLAG`. Message fica `queued`, não corrompe.
- `dispatchCampaignBatch` lê `campaigns.dispatch.paused`. Se true, abort batch, agenda retry em 1min.
- `processWebhookEvent` lê `webhooks.processing.paused`. Se true, defer execução (mantém pending).
- DLP em modo "shadow" (`dlp.healthcare.enforcement = false`) ainda corre validators mas só **loga**, não bloqueia. Permite testar novas regras sem bloquear envios reais.

**Mutation `setFeatureFlag(scope, key, enabled, reason)`:** owner role only + audit log obrigatório.

### 13.4.2 Observabilidade + SLOs (Codex round3 #3)

**Correlation IDs:** toda mutation/action gera/propaga `requestId` (UUID v7). httpAction extrai do header `X-Request-Id` ou gera. Persistido em `auditLog.metadata.requestId` e em `webhookEvents.requestId`. Logs Convex incluem requestId, tenantId, messageId, eventKey.

**Métricas (recolhidas via Convex aggregate tables, expostas em dashboard interno):**

| Métrica | Janela | Alerta se |
|---|---|---|
| `webhook.lag.p95` (recebido → processado) | 5min | > 60s |
| `webhook.failureRate` | 15min | > 1% sustained |
| `webhookEvents.pending.count` | now | > 100 OR oldest pending > 5min |
| `webhookEvents.failed.count` | 24h | > 0 (always alerta) |
| `dispatch.unknownRate` (unknown / dispatched) | 1h | > 0.1% sustained, > 1% page |
| `dispatch.failureRate` | 15min | > 5% sustained |
| `messages.dispatchingAge.p95` | now | > 2min |
| `meta.errorRate.byCode` (heatmap) | 5min | spike > 3x baseline |
| `meta.rateLimitHits` (429 from Meta) | 1min | any > 0 alerts |
| `phoneNumber.qualityRating.byPhone` | poll | yellow/red change emits event |
| `phoneNumber.circuitBreakerOpen.count` | now | > 0 always notif |
| `convex.functionCalls.byFn.p95Duration` | 1h | > baseline + 50% |
| `convex.spend.dailyEstimate` | day | > budget threshold per env |
| `consent.cascadeCancel.count` | 1h | spike (≥ 2x prior hour) |
| `audit.hashChain.intact` | daily | false = SEV1 page |
| `tenant.dpia.notSigned + connectAttempt` | event | always block + alert |

**Dashboards (1 per role):**
- **Inbox health** (agentes): conversations open count, unread, avg response time
- **Dispatch health** (admin): queue depths, failure rate, unknown count, quality
- **Cost** (owner): Convex spend trend, Meta cost by category, by tenant
- **Security/audit** (compliance): consent revoke rate, cross-tenant attempts, audit chain status

**SLOs (V1+):**
- Webhook lag p99 < 30s
- Outbound success rate > 99% (sent / queued, excluding skipped_*)
- Inbox UI page load p95 < 2s
- Audit chain integrity: 100%

### 13.4.3 Version skew + zero-downtime deploys (Codex round3 #4)

Vercel/Convex podem deployar a horas diferentes. Browsers antigos podem chamar functions removidas. Scheduled jobs podem ter payloads pre-deploy.

**Regras:**

1. **Mutations públicas têm versão:** `messages.sendText` é breaking-change-free; mudança de signature exige `messages.sendTextV2` + manter V1 30 dias min. CI fails on removing V1 sem deprecation note.
2. **Scheduled job payloads versionados:** `scheduledMessages.execute` lê `payloadVersion`; handler tem switch por version. Migrations expand/migrate/contract:
   - **Expand:** novo campo opcional, novo handler version side-by-side
   - **Migrate:** background cron rewrite payloads antigos
   - **Contract:** após zero rows com versão antiga, remove handler antigo
3. **`serverCapabilities` query:** UI carrega no boot. Inclui `{ serverVersion, supportedFeatures: [...], minClientVersion }`. Cliente abaixo de `minClientVersion` mostra modal "Atualize a página". Convex `useQuery` reactive auto-refreshes quando server bumps version.
4. **Schema migrations:** novos campos optional sempre. Removal só após confirmação que código antigo não lê. Renames = add new, dual-write, migrate, remove old.

### 13.4.4 Canary / rollout rings (Codex round3 Medium #2)

**Por feature:**

- **Novo template DLP rule:** ship em shadow mode (`dlp.healthcare.enforcement = false` para regra X específica) por 7 dias. Admin vê dashboard "would have blocked N messages". Promove a enforce após review.
- **Nova campaign:** primeira batch limitada por `campaigns.canary.maxRecipientsPerBatch` (default 50). Após 1h sem error spike + delivered rate > 90% → unlock full batches. Manual override "skip canary" exige admin role + audit + warning.
- **Nova feature de produto:** flag `feature.foo.enabled` (default false), opt-in per tenant via mutation owner. Após 3 tenants OK por 14 dias → default true.
- **Schema migration arriscada:** dual-write em cron + comparison (shadow read) por 7 dias antes de cutover.

**Auto-pause triggers:** se `dispatch.failureRate > 10%` em 15min, **automatic** flip de `outbound.tenant.disabled` para o tenant afectado + alerta admin. Mesmo para quality drop yellow→red.

### 13.4.5 Capacity / backpressure global (Codex round3 Medium #3)

```typescript
// Hard caps por plano (validados em mutation create)
const PLAN_LIMITS = {
  starter:    { maxContacts: 1000,  maxCampaignAudience: 500,   maxConcurrentDispatch: 5 },
  growth:     { maxContacts: 10000, maxCampaignAudience: 5000,  maxConcurrentDispatch: 20 },
  enterprise: { maxContacts: 1e6,   maxCampaignAudience: 100000, maxConcurrentDispatch: 100 },
};

// Global semaphore (table com counter atómico)
dispatchSemaphore: defineTable({
  scope: v.string(),                                 // "global", "tenant:abc", "phone:xyz"
  inFlight: v.number(),
  limit: v.number(),
  updatedAt: v.number(),
}).index("by_scope", ["scope"]),
```

**`dispatchOne` action:**

1. Atomic mutation `acquireDispatchSlot(tenantId, phoneNumberId)` — increments scopes global/tenant/phone se < limit. Throws `BACKPRESSURE` se nenhum slot disponível.
2. Se BACKPRESSURE → message fica queued, scheduler retry com jitter exponencial.
3. Após POST Meta (qualquer outcome) → `releaseDispatchSlot`.

**Meta 429 handling:** se Meta retorna 429 → `markUnknown` (não sabemos se aceitou) + `circuitBreakerUntil = now + Retry-After header` + audit. Liberta slot.

### 13.4.6 Dev / Staging / Prod separation (Codex round3 Medium #4)

| Recurso | Dev | Staging | Prod |
|---|---|---|---|
| Convex deployment | `dev:openbsp-dani-dev` (per-dev) | `staging:openbsp-staging` | `prod:openbsp-prod` |
| Vercel env | preview branches | `staging.openbsp.app` | `app.openbsp.com` |
| Meta App | `Openbsp Dev` (test mode) | `Openbsp Staging` | `Openbsp Prod` |
| WABA | sandbox numbers Meta | dedicated test number(s) | real customer WABAs |
| Webhook URL | `https://<dev>.convex.site/whatsapp-webhook` | staging | prod |
| Master key envelope | DEV_MASTER_KEY_V1 | STAGING_MASTER_KEY_V1 | PROD_MASTER_KEY_V1 |
| Recipients allowlist | `*` allowed só dentro de allowlist phone numbers configurados em env (ex: Dani+team) | idem | sem allowlist (real) |
| Convex dashboard access | dev | restricted | restricted, audit |

**CI gates:**
- Vercel preview deploys NUNCA recebem `PROD_*` env vars (Vercel project settings explicit).
- Mutation `outbound.send*` em dev/staging valida recipient e164 contra `ALLOWED_TEST_RECIPIENTS` env. Se não match, throws `RECIPIENT_NOT_ALLOWED_IN_NON_PROD`.
- Convex deployment URL hardcoded em Next.js build NÃO pode ser prod em previews (CI lint).
- Secrets rotation: separate per env, scheduled rotation cron per env independent.

### 13.4.7 Runbooks operacionais (Codex round3 Medium #5)

Ficam em `~/openbsp/runbooks/` como Markdown. MVP cria os críticos:

| Runbook | SEV | Trigger | Conteúdo |
|---|---|---|---|
| `token-revoked.md` | SEV2 | `tokenStatus = revoked` alert | (1) verify Graph API call (2) UI banner ao admin tenant (3) workflow para re-add token (4) durante: pause outbound flag tenant |
| `quality-red.md` | SEV1 | `qualityRating = red` alert | (1) auto: circuit breaker open + outbound.phone.disabled (2) review last 7d sent: rate of failed/spam reports (3) review templates por categoria (4) plan template pause + outbound throttle |
| `webhook-backlog.md` | SEV2 | `webhookEvents.pending > 100 OR age > 5min` | (1) verify worker not crashlooping (Convex dashboard) (2) check feature flag `webhooks.processing.paused` (3) manually invoke `processWebhookEvent` for top N (4) escalation if backlog grows |
| `unknown-spike.md` | SEV2 | `dispatch.unknownRate > 1%` | (1) review meta error codes top contributors (2) check Meta status page (3) reconcile (manual or via webhook arrivals) (4) enable `outbound.tenant.disabled` se sustained |
| `rgpd-export-failed.md` | SEV3 | `compliance.exportContact` action error | (1) check storage permissions (2) retry from auditLog requestId (3) escalate to data subject within 30 days legal limit |
| `master-key-unavailable.md` | **SEV1** | encrypt/decrypt errors | (1) verify env var present (2) check key version sync (3) **DO NOT delete ciphertexts** (4) restore from offline backup (5) post-mortem mandatory |
| `schema-rollback.md` | SEV2 | bad deploy | (1) Convex deployment rollback via dashboard (2) drain queues first via flags (3) check schema additive only — destructive changes need migrate-back script |
| `meta-app-disabled.md` | **SEV1** | webhook delivery stops globally | (1) check Meta App Dashboard (2) verify app secret rotation didn't break (3) escalation: enable per-tenant manual app fallback (V2+) |

Cada runbook tem: Trigger, Sev, On-call action steps, Comunicação ao tenant template, Critério de fechar incidente, Post-mortem template link.

**Solo dev:** "on-call" = Dani. Alerts via WhatsApp pessoal + email + Convex dashboard. PagerDuty / OpsGenie só V2+ se houver budget.

### 13.4.8 Blast radius do Meta App único (Codex round3 Medium #6)

Decisão MVP de **1 Meta App para todos os tenants** = blast radius total se app suspended/secret leaks.

**Mitigations MVP:**
- Cron `metaAppHealthCheck` every 5min: GET `https://graph.facebook.com/v21.0/{appId}` com platform secret. Se 401/403 → SEV1.
- Webhook 0-byte recebido em janela de 30min → SEV1 (provavelmente Meta cortou subscription).
- Backup webhook URL secundária registrada Meta (failover via DNS/edge route) — V1.
- Rotation rehearsal trimestral: gerar novo app secret em sandbox, atualizar `metaApps.appSecretCiphertext`, validar webhook continua a verificar OK, então rollback.
- Replay buffer: `webhookEvents` retidos 7d permite re-process se recovery após outage.

**Mitigations V2 (antes de >5 tenants externos):**
- Multi-Meta App support: tenants enterprise com seu próprio Meta App. Webhook URL distinto per app.
- Per-tenant outbound pause control independente do global.

### 13.4.9 WORM audit storage externo (Codex round3 Medium #7)

Convex File Storage **não é** WORM imutável independente — vive na mesma deployment Convex e pode ser apagado por bug ou deploy errado.

**Decisão MVP:** **Documentar limitação no DPA** — audit log diário export para Convex File Storage tem hash chain interno (forensic integrity proof) mas não tem object lock independente. Aceitável para MVP/V1 com 1-3 tenants Dani-controlled.

**Antes de V1 onboard tenant externo:** export diário para **bucket externo S3-compatible com Object Lock + versioning** (Backblaze B2 ou Cloudflare R2 ou AWS S3). Cron `dailyAuditExportExternal`:
1. Lê dia anterior de `auditLog` por tenant.
2. Compute SHA-256 do dump diário.
3. PUT para `s3://openbsp-audit-{env}/{tenantId}/YYYY-MM-DD.jsonl.gz` com `x-amz-object-lock-mode=COMPLIANCE`, `x-amz-object-lock-retain-until-date=+7years`.
4. Inserir `auditLog` entry "audit.exported.external" com hash + bucket URL.
5. Falha → SEV2 alert + retry 24h.

Credentials S3 em env var Convex separadas. Read-only key para verification queries.

### 13.4.10 META_GRAPH_VERSION centralizada (Codex round3 Low #2)

```typescript
// convex/lib/meta/version.ts
export const META_GRAPH_VERSION = "v21.0";

// Toda chamada Meta usa: `https://graph.facebook.com/${META_GRAPH_VERSION}/...`
```

Upgrade calendar:
- Subscribe Meta Graph API changelog + deprecation notices.
- Test new version em staging Meta App 14 dias antes prod cutover.
- Document upgrade em CHANGELOG repo + DPA addendum se mudou behavior compliance.

## 13.5 Implementation guards (Codex round2 Low #1, #2)

### HMAC verify helper (Low #1)

```typescript
// convex/lib/meta/verify.ts
export async function verifyMetaHmac(
  rawBodyBytes: Uint8Array,
  signatureHeader: string | null,
  appSecret: string,
): Promise<{ ok: boolean; bodySha256: string }> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return { ok: false, bodySha256: "" };
  const provided = hexToBytes(signatureHeader.slice(7));
  const computed = await crypto.subtle.sign(
    "HMAC",
    await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    rawBodyBytes,
  );
  const ok = constantTimeEqual(new Uint8Array(computed), provided);
  const bodySha256 = bytesToHex(new Uint8Array(
    await crypto.subtle.digest("SHA-256", rawBodyBytes)));
  return { ok, bodySha256 };
}
```

httpAction MUST capture raw bytes (`await request.arrayBuffer()`) BEFORE any JSON parsing. Para payloads > 800KB, store em Convex File Storage e referenciar em `webhookEvents.rawPayloadStorageId`.

### CSV import/export sanitization (Low #2)

**Import:**
- Hard size limit: 10 MB ou 50k rows (configurable per plan).
- Schema: header row obrigatório com colunas conhecidas (`phone_e164`, `name`, `tag1..tagN`, `consent_proof_url`, `consent_proof_text`). Colunas extras → erro.
- E.164 normalization via `libphonenumber-js`. Falha = row rejected, log row index.
- `customAttributes` allowlist por tenant (admin define schema antes de import).
- Tags lowercase, no spaces (slugify).
- Locale validated against IETF BCP 47.

**Export (RGPD ou audit) — formula injection mitigation:**
- Toda célula que começa por `=`, `+`, `-`, `@` é prefixada com `'` (single quote escape Excel/Sheets).
- Encoding UTF-8 BOM para correct rendering.
- Filename inclui hash + timestamp + tenant slug (sanitized).
- Audit log entry para cada export.



1. Conta Meta Business + WABA PT iniciada (Acto 1 do PROJECT.md em paralelo).
2. Domínio próprio + Privacy Policy + Terms publicados.
3. DPIA template revisto por advogado PT (RGPD healthcare).
4. DPA template (Dani como processor, tenant como controller).
5. Master key envelope encryption gerada offline (e backup seguro).
6. Decisão: Convex Pro tier ou self-hosted? (Pro tier $25/mês startup, suficiente MVP.)

## 15. Próximos passos (semana 1)

1. `npx create-next-app@latest app --ts --tailwind --app` em `~/openbsp/app`
2. `cd app && npx convex dev` — init Convex.
3. Implementar `customFunctions.ts` + `requireMember` + integration test de cross-tenant isolation **antes** de qualquer mutation feature.
4. Schema base + healthcare mode flag.
5. Submeter template `appointment_reminder` à Meta (paralelo, demora dias-semanas).
6. Email Matias (`acto-1/EMAIL_MATIAS.md`).

---

## Changelog

### Round 1 (Codex review, 2026-05-12)

**Aceite e incorporado:**

- **#2 Integração clínica em V2:** Apoint+reminders+confirm/cancel/no-show movido para **MVP**. V1 só acrescenta campanhas e import.
- **#3 Healthcare strategy fraca:** Substituído por **healthcare mode obrigatório** (forçado quando vertical=clinic), **allowlist** de templates clínica em vez de denylist regex livre, **bloqueio por código** de diagnóstico/prescrição/resultados, flag `isMinor` no contact, **DPIA + DPA obrigatórios** antes de connect WABA, bloqueio onboarding EUA/França.
- **#4 Opt-in misto:** Substituído por `contactConsents` table com purpose (transactional/marketing/authentication) × channel × proof versionada. Sem campo `optIn` boolean. Marketing exige granted explícito; transactional pode usar inbound 24h como base.
- **#5 Webhook idempotency:** State machine `pending/processing/processed/failed` em `webhookEvents` com attempts + nextRetryAt + watchdog cron. Marca `processed` SÓ após worker concluir.
- **#6 Indexes não são unique:** Adicionados markers explícitos: `messages.clientDispatchKey` lookup ANTES de POST; `campaignDeliveries.by_campaign_contact` consultado em mutation atómica; `webhookEvents.eventKey` query antes de insert.
- **#7 ctx.db em actions:** Refactored arquitectura. Actions são SÓ HTTP + `ctx.runMutation/runQuery`. Lint CI proibe `ctx.db` em files que exportam actions.
- **#8 Outbox pattern:** Estados `queued → dispatching → sent/failed` em messages, `claimForDispatch` mutation atómica que faz lock por timestamp, `dispatchTimeoutSweep` cron re-claim stuck > 5min, exponential backoff via `nextRetryAt`.
- **#9 Quota ledger:** Adicionadas tables `quotaReservations` + `quotaWindowCounters`. Helpers `reserveQuota/consumeQuota/releaseQuota`. Reserve ANTES de POST Meta. Cron release SÓ para `failed_pre_provider`; `unknown` exige reconciliação manual.
- **#10 Multi-tenant frágil:** Substituído por wrappers `tenantQuery/tenantMutation` (convex-helpers customFunctions), helper `loadByIdInTenant` que valida tenant fence, capability matrix por role, integration tests CI obrigatórios.
- **#11 Secret store WABA:** Envelope encryption AES-GCM, ciphertext em `wabaSecrets` table, master key em env var Convex com versioning para rotação, cron `tokenHealthCheck`.
- **#12 Roadmap incompatível:** Re-honestizado. MVP 6 sem (não 4), V1 14 sem totais (não 8), V2 26 sem totais. Estimativas com 25h/sem reais. Aviso explícito de slip se Meta template approval atrasar.
- **Medium #1 Custos Convex:** Modelagem detalhada por componente; identificado **reactive queries como custo dominante**; mitigations desde MVP (paginação, aggregate cache, visibility unsubscribe).
- **Medium #2 RGPD scope:** PII inventory completo, retention rules por table (consents 5 anos, audit 6 meses-7 anos, webhooks raw 7 dias, messages tenant-configurable).
- **Medium #4 Templates versionamento:** Schema `templates + templateVersions` com isLocked após submit, parameterSchema validado em render.
- **Medium #5 Audience materialization:** `audienceSnapshots` table com cursor resumable + checkpoint per batch + cancel-aware.
- **Medium #6 Quality cron diário fraco:** Pre-flight per batch + circuit breaker on error codes + on-demand poll quando circuit aberto.
- **Medium #7 AI agent regras:** Draft-only obrigatório healthcare em V2; mascaramento dados sensíveis; testes adversariais; handoff humano explícito. Adiado para V2.
- **Low #1 Vocabulário misto:** Tabela canónica adicionada no topo. `tenantId` único FK em todo o lado. `clinicId`, `orgId`, `workspaceId` removidos.

**Negociado / parcialmente aceite:**

- **#1 Scope creep para enterprise SaaS:** Codex sugeriu reverter para vertical clínica. **Mantido scope multi-tenant** porque user explicitamente disse "para médias e grandes empresas". MAS aceite parcialmente: removidas API pública, SSO, vertical packs e-commerce/fintech, roteamento departamentos, SLA tracking de MVP/V1; movidos para V2/V3. MVP/V1 são effectively "clínicas dogfood" mas com schema multi-tenant para evitar retro-fit.

**Não aceite:**

- Nenhum finding rejeitado por completo. Todos materiais foram aceites ou negociados com justificação.

### Round 2 (Codex security/data-integrity review, 2026-05-12)

Round 2 trouxe 5 High + 6 Medium + 3 Low. Todos materiais. Todos incorporados.

**High:**

- **#1 HMAC sem appSecret no schema:** Adicionada tabela `metaApps` com `appSecretCiphertext` (envelope encrypted, mesma master key). Estratégia explícita: **único Meta App da plataforma** no MVP/V1 (reject phone_number_id não bound a este app). Multi-app só V3+. Webhook valida HMAC com `PLATFORM_META_APP_SECRET` antes de qualquer parse, depois resolve tenant.
- **#2 Outbox duplica em crash pós-POST:** Aceite que Meta API NÃO aceita Idempotency-Key. `clientDispatchKey` substituído por `businessKey` derivado de objecto estável (scheduledMessageId, campaignDeliveryId, ou hash com nonce do UI). Status alargado com `unknown` — POST falha incerta NÃO faz auto-retry. UI mostra mensagens em `unknown` para reconciliação humana. Quota também tem `unknown` que NÃO liberta automaticamente (Codex Medium #2).
- **#3 Wrappers ainda confiam em tenantId de args:** Refactored. `tenantQuery/tenantMutation` derivam tenantId de `sessions.activeTenantId` validado contra `members`. Adicionada `sessions` table. `loadByIdInTenant` usa `ctx.tenantId` derivado, não args. CI test obrigatório por public function.
- **#4 Consent revoke não cancela materializadas:** Schema split em `currentConsents` (único por tenant/contact/purpose/channel — fonte de verdade) + `consentEvents` (append-only audit). Helper `recordConsentTransition` faz transição atómica + cascade cancel (campaignDeliveries pending, scheduledMessages, messages queued). `claimForDispatch` revalida consent JIT antes de POST.
- **#5 Healthcare DLP só em templates:** Estendido a `sendText`, `sendMedia`, e media OCR. Validador `validateOutgoingContent` corre antes de `claimForDispatch`. Override exige justificação + audit. Algumas regras absolutas sem override possível (medicamentos controlados, "diagnóstico"). MVP healthcare mode restringe media a owner/admin com categoria explícita.
- **#6 MVP liga clientes reais antes de RGPD:** Roadmap MVP expandido de 6 → 8 semanas. Sem 6 inteira agora dedicada a DPIA wizard + DPA digital + exportContact + eraseContact + retentionSweep + audit hash chain ANTES de connectWABA real. V1 ajustado a 16 sem totais, V2 a 28 sem totais.

**Medium:**

- **#1 eventKey com timestamp + read regredindo a delivered:** `eventKey` agora SEM timestamp (estável por message+status_value). Status machine monotonic guard implementado: `markStatus` verifica `statusRank(new) >= statusRank(current)`, ignora out-of-order com counter metric.
- **#2 Quota releases stale para unknown:** Estados separados `failed_pre_provider/unknown/accepted/released_after_reconcile`. **Sem libertação automática para `unknown`.** `markQuotaUnknown` mantém counter incrementado. Cron alerta admin de unknown > 1h. Reconciliação manual com audit.
- **#3 appointments.by_external + scheduledMessages.by_source sem tenantId:** Indexes refeitos como compostos `[tenantId, sourceSystem, externalId]` e `[tenantId, sourceType, sourceRef]`. Upsert idempotente por estas chaves.
- **#4 Scheduled message sem atomic claim:** Adicionado `claimScheduledMessageForDispatch` mutation que numa única transaction: load → status check → optimistic claim → re-validate (appointment, consent, quality, quota) → insert message → schedule dispatch. Status `claiming` para evitar double-claim.
- **#5 Audit log sem append-only enforcement:** Schema actualizado com `prevHash` + `selfHash` (hash chain). Writes só via `internalMutation appendAudit`. Sem update/delete API. WORM export diário para Convex File Storage. Cron daily integrity check.
- **#6 connectManual sem validação:** Mutation refactored: chama Graph API para validar token vivo + scopes mínimos + reject user tokens + verifica WABA bound + verifica `app_id == PLATFORM_META_APP_ID` + extract token expiry + audit log completo. Só após validação passa, encrypt + persist secret.

**Low:**

- **#1 HMAC verify sem raw body + constant time spec:** Helper `verifyMetaHmac` definido em secção 13.5 com `crypto.subtle.sign` + `constantTimeEqual`. httpAction captura `request.arrayBuffer()` antes de parse. Payloads > 800KB usam Convex File Storage.
- **#2 customAttributes sem schema, CSV sem injection mitigation:** Definido em 13.5: schema allowlist por tenant para customAttributes; CSV import com hard size limit, header obrigatório, E.164 normalize, slug tags; CSV export com escape de `=`, `+`, `-`, `@` em todas as células.
- **#3 circuitBreaker fields ausentes do schema:** Adicionados `circuitBreakerUntil`, `circuitBreakerReason`, `circuitBreakerOpenedAt`, `qualityLastErrorAt`, `qualityLastErrorCode` a `phoneNumbers`. Audit log para open/close.

### Round 3 (Codex ops/SRE review, 2026-05-12)

Round 3 trouxe 4 High + 7 Medium + 2 Low = 13 findings. Todos materiais. Todos incorporados.

**High:**

- **#1 dispatchWatchdog re-queueing stuck dispatching contradiz unknown state:** Renomeado para `dispatchTimeoutSweep`. Comportamento corrigido: rows stuck em `dispatching` > 5min são marcadas como **UNKNOWN, NÃO re-queue**. Adicionada `markUnknown` internalMutation + `reconcileUnknown` tenantMutation para human reconciliation via UI. Documentado nos fluxos, API surface, crons, e tabela de riscos.
- **#2 Sem rollback/kill switches:** Adicionada secção 13.4.1 com tabela `featureFlags` (scope global/tenant/phone) + canonical flag keys (`outbound.global.disabled`, `campaigns.dispatch.paused`, `webhooks.processing.paused`, `dlp.healthcare.enforcement` com shadow mode, `campaigns.canary.maxRecipientsPerBatch`). Gates obrigatórios em `claimForDispatch`, `dispatchCampaignBatch`, `processWebhookEvent`. Mutation `setFeatureFlag` owner-only com audit.
- **#3 Observabilidade fraca:** Adicionada secção 13.4.2 com correlation IDs (requestId UUIDv7), tabela de 14 métricas com janelas e thresholds de alerta, 4 dashboards por role, SLOs (webhook lag p99 < 30s, outbound success > 99%, audit chain integrity 100%).
- **#4 Version skew:** Adicionada secção 13.4.3. Mutations públicas versionadas com manutenção 30 dias mín. Scheduled job payloads com `payloadVersion` + handler switch. Migrations expand/migrate/contract. Query `serverCapabilities` com `minClientVersion` força UI refresh em versões antigas. Schema migrations: novos campos optional always.

**Medium:**

- **#1 `releaseStaleReservations` ainda nas references:** Removido. Renomeado para `staleQuotaAlert` (só alerta, não release) + `releaseFailedPreProviderReservations` (só release confirmed pre-provider failures). Documentado em crons e API surface.
- **#2 Sem canary/rollout rings:** Adicionada secção 13.4.4. Shadow mode para DLP rules. Canary `campaigns.canary.maxRecipientsPerBatch` default 50 primeira batch. Auto-pause se failure rate > 10% em 15min. Promotion por métricas, não por tempo.
- **#3 Backpressure global ausente:** Adicionada secção 13.4.5. Tabela `dispatchSemaphore` com counters atómicos por scope (global/tenant/phone). `acquireDispatchSlot` mutation + retry com jitter exponencial. Hard caps por plano. Meta 429 → markUnknown + circuit breaker com Retry-After.
- **#4 Sem dev/staging/prod separation:** Adicionada secção 13.4.6 com tabela completa de envs (Convex/Vercel/Meta App/WABA/master key separados). CI gates: previews não recebem PROD secrets, recipients allowlist em não-prod, lint Convex URL.
- **#5 Sem runbooks:** Adicionada secção 13.4.7 com 8 runbooks críticos (token-revoked, quality-red, webhook-backlog, unknown-spike, rgpd-export-failed, master-key-unavailable, schema-rollback, meta-app-disabled). Solo dev = Dani on-call via WhatsApp+email.
- **#6 Blast radius Meta App único:** Adicionada secção 13.4.8. Cron `metaAppHealthCheck` 5min + alerta 0-byte webhook 30min. Backup webhook URL planeada V1. Rotation rehearsal trimestral. Multi-Meta App support em V2 antes de >5 tenants externos.
- **#7 WORM Convex File Storage não é imutável:** Adicionada secção 13.4.9. Decisão MVP: documentar limitação no DPA. Antes de V1 com tenant externo: cron `dailyAuditExportExternal` para S3-compatible com Object Lock (Backblaze B2 / R2 / S3) + retention 7 anos.

**Low:**

- **#1 Documental drift:** dispatchWatchdog → dispatchTimeoutSweep aplicado em todo o doc. Tabela riscos actualizada para businessKey + UNKNOWN flow. Roadmap weeks references corrigidos onde encontrados.
- **#2 META_GRAPH_VERSION hardcoded:** Adicionada secção 13.4.10 com `META_GRAPH_VERSION` constante centralizada + upgrade calendar (subscribe Meta changelog, test em staging 14 dias antes prod cutover).
