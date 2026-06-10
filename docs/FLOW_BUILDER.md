# Flow Builder — design (OpenBSP-Convex)

> Blueprint derivado da análise de dois projetos open-source + da arquitectura que já temos.
> Docs em PT, código/identificadores em inglês (convenção do projecto).

## De onde vem cada ideia

| Fonte | O que tem | O que roubamos | O que **não** roubamos |
|---|---|---|---|
| **OpenWA** (NestJS, `whatsapp-web.js`) | API gateway não-oficial. **Não tem flow builder.** | (1) *hook event-bus* tipado; (2) *plugin manifest com `configSchema`* → UI gerada por declaração | Toda a camada de engine/session (não-oficial — destruía a tese BSP) |
| **Typebot** (Next.js, MIT) | Flow builder de chat/WhatsApp real, ~28 tipos de bloco | (1) modelo `groups/blocks/edges`; (2) `SessionState` resume-on-inbound; (3) mapeamento bloco→tipo de mensagem WhatsApp; (4) taxonomia de nós | Assume sessão web aberta — **ignora a janela 24h e templates obrigatórios** da Cloud API |
| **OpenBSP** (este repo) | `scheduledMessages` state machine, scheduler Convex, consent/quality gates, multi-tenant, audit hash-chain | É a fundação — o executor é uma extensão destes padrões | — |

## A restrição que muda tudo (porque não basta clonar o Typebot)

O Typebot corre sobre chat web / WhatsApp assumindo que a conversa está sempre "aberta". Nós somos **BSP oficial na Cloud API da Meta**, onde:

1. **Janela de serviço de 24h.** Só podes mandar mensagem *free-form* até 24h depois da última mensagem **inbound** do contacto. Fora dessa janela → **só template aprovado**.
2. **Consentimento.** Todo outbound passa por `currentConsents` + STOP keyword (já temos `skipped_consent`).
3. **Quality / circuit breaker.** Já temos `skipped_quality`.
4. **Healthcare mode.** Allowlist de templates + denylist DLP quando `vertical=clinic`.

➡️ **Consequência de design:** cada nó "send" do flow precisa de saber, *em tempo de execução*, se a janela 24h está aberta. Um nó `Wait 2 days → Send` **tem** de mandar template (a janela fechou). Isto deve ser:
- **validado no editor** (design-time): se um caminho pode chegar a um send fora de 24h, o nó tem de referenciar um template aprovado, senão erro de validação.
- **forçado no runtime**: o send node reusa exactamente os gates de `scheduledMessages` (`skipped_consent`, `skipped_quality`, e um novo `skipped_outside_window` quando free-form fora de 24h).

Este é o diferenciador real vs. um Typebot clone. É o "bem feito".

---

## 1. Modelo de dados (Convex)

Três tabelas novas. O grafo guarda-se como JSON (nós + arestas) na própria `flows` — Convex lida bem com documentos; não vale a pena normalizar nós/arestas em tabelas separadas até termos escala de edição colaborativa.

```ts
// schema.ts (additions)

flows: defineTable({
  tenantId: v.id("tenants"),
  name: v.string(),
  status: v.union(v.literal("draft"), v.literal("published"), v.literal("archived")),
  version: v.number(),              // bump on publish (runs pin a version)
  trigger: flowTriggerValidator,    // ver §3
  graph: flowGraphValidator,        // { nodes: FlowNode[], edges: FlowEdge[] }
  variables: v.array(v.object({ name: v.string(), initial: v.optional(v.string()) })),
  createdBy: v.id("members"),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_tenant", ["tenantId"])
  .index("by_tenant_trigger", ["tenantId", "trigger.kind"]),  // p/ resolver inbound → flow

// versão imutável "publicada" que os runs fixam (Typebot tem publicTypebot; mesma ideia)
flowVersions: defineTable({
  flowId: v.id("flows"),
  tenantId: v.id("tenants"),
  version: v.number(),
  graph: flowGraphValidator,
  trigger: flowTriggerValidator,
  publishedAt: v.number(),
  publishedBy: v.id("members"),
}).index("by_flow_version", ["flowId", "version"]),

// o "SessionState" do Typebot, adaptado: uma execução viva por (contacto × flow)
flowRuns: defineTable({
  tenantId: v.id("tenants"),
  flowId: v.id("flows"),
  flowVersion: v.number(),
  contactId: v.id("contacts"),
  conversationId: v.optional(v.id("conversations")),
  phoneNumberId: v.id("phoneNumbers"),
  status: v.union(
    v.literal("running"),           // a avançar nós (transitório)
    v.literal("awaiting_input"),    // pausado à espera de inbound
    v.literal("awaiting_timer"),    // pausado num Wait (scheduler job pendente)
    v.literal("completed"),
    v.literal("failed"),
    v.literal("stopped"),           // STOP keyword / consent revogado / cancelado
  ),
  currentNodeId: v.optional(v.string()),
  variables: v.record(v.string(), v.string()),
  // janela 24h: timestamp da última inbound do contacto neste run
  lastInboundAt: v.optional(v.number()),
  schedulerJobId: v.optional(v.string()),   // p/ cancelar timers ao parar
  startedAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),            // GC de runs presos (ver Typebot: 10 min reset)
})
  .index("by_tenant_contact_flow", ["tenantId", "contactId", "flowId"])
  .index("by_conversation_status", ["conversationId", "status"])  // resolver inbound → run activo
  .index("by_status_expires", ["status", "expiresAt"]),           // GC cron
```

Reusamos `scheduledMessages` para o disparo real de mensagens com template (já tem o state machine + gates + claim atómico). Send nodes que precisam de template **criam uma `scheduledMessages` com `sourceType: "flow"`** (novo) e `sourceRef: flowRunId` — assim herdam consent/quality/idempotência de graça.

---

## 2. Taxonomia de nós (mapeada à Cloud API)

Filtramos a taxonomia do Typebot pelo que faz sentido num BSP oficial. Cada nó declara um `configSchema` (padrão roubado do OpenWA) → o editor desenha o formulário sozinho.

### Bubbles / Send (saída)
| Nó | Cloud API | Nota de janela 24h |
|---|---|---|
| `send.text` | text message | só dentro de 24h; fora → bloqueado/forçar template |
| `send.media` | image/video/document/audio | idem |
| `send.template` | template message | **sempre permitido** (é o que abre/continua fora de 24h) |
| `send.interactive_buttons` | interactive (≤3 botões, título ≤20 chars) | dentro de 24h (ou template c/ botões) |
| `send.interactive_list` | interactive list | dentro de 24h |

### Inputs (espera resposta → pausa o run)
| Nó | Inbound que resolve | 
|---|---|
| `input.text` | mensagem de texto |
| `input.choice` | `button_reply` / `list_reply` |
| `input.media` | image/video/audio/document |
| `input.phone` / `input.email` | texto + validação |

### Logic / Control
`logic.condition` (operadores: equals, contains, starts/ends_with, is_set, is_empty, >, < — copiados do `matchComparison` do Typebot), `logic.set_variable`, `logic.wait` (duração → **fecha a janela 24h**, marca o próximo send como template-only), `logic.jump`, `logic.branch_random` (A/B), `logic.end`.

### Integration / Actions (específicos OpenBSP)
`action.http_request` (via Convex action), `action.call_agent` (mantém a decisão de arquitectura: agentes AI são serviços externos via Chat Completions/A2A — **não** embutir LLM no Convex), `action.book_appointment` / `action.update_appointment` (liga ao `appointments` que já existe), `action.add_label`, `action.set_consent`.

### Triggers (ponto de entrada — §3)
Não são nós no grafo; são o campo `trigger` do flow.

**Não portar (por agora):** payment (Stripe), groups, channels, status/stories, catalog — ou fora de scope, ou só existem no caminho não-oficial.

---

## 3. Triggers (como um flow arranca)

```ts
flowTriggerValidator = v.union(
  // inbound: contacto manda mensagem que casa uma condição
  v.object({ kind: v.literal("inbound_message"),
             match: v.object({ op: ..., value: v.optional(v.string()) }) }),  // ex: contains "marcar"
  // entrada em conversa nova (primeira inbound de sempre)
  v.object({ kind: v.literal("conversation_started") }),
  // evento de negócio (ex: appointment criado/cancelado) — liga ao que já temos
  v.object({ kind: v.literal("appointment_event"),
             event: v.union(v.literal("created"), v.literal("cancelled"), v.literal("no_show")) }),
  // manual / API (operador dispara para um contacto)
  v.object({ kind: v.literal("manual") }),
)
```

Resolução de inbound → flow acontece em `webhooks.processOne` (que **já** processa inbound, STOP, consent). Ordem: (1) há `flowRun` activo nesta conversa em `awaiting_input`? → resume. (2) senão, algum `flow` published com trigger que casa? → start.

---

## 4. Executor (Convex) — o coração

Espelha o `bot-engine` do Typebot (`startSession` / `continueBotFlow` / `walkFlowForward`) mas sobre **mutations + scheduler durável**, não sobre um processo Node vivo.

```
startFlowRun(flowId, contactId, triggerData)        [internalMutation]
  → cria flowRun (status: running), variables iniciais
  → agenda advanceFlowRun(runId)

advanceFlowRun(runId)                                [internalAction]  ← o "walkFlowForward"
  loop a partir de currentNodeId:
    • send.*    → emite mensagem:
                    - dentro de 24h (now - lastInboundAt < 24h)  → free-form via _dispatchOne
                    - fora de 24h ou send.template               → cria scheduledMessages (gates!)
                  → segue edge default
    • logic.*   → avalia, escolhe edge (condition → item.edge), continua loop
    • action.*  → corre side-effect (http/agent/appointment), segue edge
    • input.*   → grava currentNodeId, status=awaiting_input, **pára o loop** (espera inbound)
    • logic.wait→ status=awaiting_timer, scheduler.runAfter(duration, resumeAfterTimer)
                  marca run.windowClosed (próximo send = template-only)
    • logic.end / sem edge → status=completed

resumeFlowRun(conversationId, inboundMessage)        [internalMutation]  ← "continueBotFlow"
  → run em awaiting_input nesta conversa
  → valida/parsa inbound contra o input node (reusa lógica de button_reply/list_reply)
  → grava resposta em variables, actualiza lastInboundAt (reabre janela 24h!)
  → segue edge de saída → agenda advanceFlowRun

resumeAfterTimer(runId)  → advanceFlowRun (vindo de um Wait)
```

**Pontos críticos (lições combinadas):**
- **Janela 24h é estado do run** (`lastInboundAt`): toda inbound reabre-a; todo `wait` fecha-a. O send node lê isto para escolher free-form vs template. Nada disto existe no Typebot — é o que nos torna compliant.
- **STOP / consent revogado** → `webhooks.handleStopKeyword` (já existe) também marca `flowRuns` activos do contacto como `stopped` e cancela o `schedulerJobId`. Sem excepção.
- **Idempotência**: `resumeFlowRun` é idempotente por `metaMessageId` (não avançar duas vezes na mesma inbound). Reusa o padrão `webhookEvents`.
- **Staleness** (Typebot: 3 min): inbound muito antiga não resume; run preso > `expiresAt` é GC'd por cron (Typebot reseta a 10 min).
- **Loop guard**: limite de nós por `advanceFlowRun` (Typebot tem timeout no walk) para não haver ciclo infinito sem input.
- **Multi-tenant + audit**: `tenantId` em tudo; transições de run escrevem `auditLog` (hash-chain) via `appendAudit`.

---

## 5. Config-driven nodes (padrão do OpenWA)

Cada tipo de nó é um registo declarativo — evita UI hardcoded por nó e dá validação grátis:

```ts
const NODE_DEFS = {
  "send.template": {
    category: "send",
    label: "Enviar template",
    configSchema: { /* templateId (enum de approved), variables map */ },
    outputs: ["default"],
    requiresApprovedTemplate: true,   // usado pela validação design-time da janela 24h
  },
  "logic.condition": {
    category: "logic",
    configSchema: { /* variable, operator, value */ },
    outputs: ["match", "default"],    // múltiplas arestas de saída
  },
  // ...
} satisfies Record<string, NodeDef>;
```

O editor lê `NODE_DEFS` → paleta de nós + formulário de config + portas de saída. A validação de publish percorre o grafo com este registo.

---

## 6. UI

- **Canvas**: [React Flow](https://reactflow.dev) (standard de facto, é o que o Typebot/n8n usam). Nós custom por categoria, cor por tipo.
- **Painel de config**: gerado do `configSchema` do nó selecionado.
- **Validação ao publicar**: nós órfãos, caminhos sem saída, e — o nosso especial — *caminhos que chegam a um send free-form fora da janela 24h sem template*.
- Página: substituir o stub `soon` em `campaigns/` ou nova rota `app/flows/`.

---

## 7. Plano faseado

- **F0 — schema + executor headless.** Tabelas `flows`/`flowVersions`/`flowRuns`. Executor com 4 nós: `send.template`, `input.text`, `logic.condition`, `logic.end`. Trigger `inbound_message`. Testes de isolamento tenant + idempotência (como já fazes). **Sem UI** — flow seedado em código. Prova o state machine + janela 24h.
- **F1 — gates + integração inbound.** Ligar `webhooks.processOne` (resolve inbound→run), `handleStopKeyword` (pára runs), gates de consent/quality via `scheduledMessages`. `logic.wait` + `resumeAfterTimer` + cron de GC.
- **F2 — taxonomia completa.** `send.interactive_buttons/list`, `input.choice/media`, `action.book_appointment`, `action.call_agent`.
- **F3 — editor React Flow.** Canvas + config-driven panel + validação de publish.
- **F4 — observabilidade.** Vista de runs (debug por contacto), métricas por nó.

---

## TL;DR

1. OpenWA **não tem flow builder** e usa WhatsApp não-oficial — só aproveitamos 2 *padrões* (hooks, configSchema), nada de código.
2. Typebot dá o modelo certo (`groups/blocks/edges` + `SessionState` resume-on-inbound) mas **ignora a janela 24h e templates** — copiá-lo cru produziria um produto não-compliant.
3. O nosso flow builder = modelo do Typebot **+ janela 24h/consent/quality como estado de primeira classe**, executado sobre o scheduler durável e os gates de `scheduledMessages` que já temos.
4. Construir headless primeiro (F0), UI por último (F3). O valor está no executor compliant, não no canvas.
