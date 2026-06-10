# PLAN — Flow Builder F0 (schema + executor headless)

> Fase 0 do flow builder. Desenho geral em `FLOW_BUILDER.md`. Estilo e disciplinas seguem `PLAN.md` (multi-tenant por código, idempotência explícita, audit hash-chain, `loadByIdInTenant` em todo `ctx.db.get`).
> **Objectivo F0:** provar o *state machine* do executor (start → walk → pause → resume) e o tracking da **janela 24h**, sem UI. Flows seedados em código nos testes. Entrega real de mensagens reusa o caminho de `scheduledMessages` que já existe — F0 **não** escreve gates novos.

## F0.0 Scope

**Entra em F0:**
- 3 tabelas novas: `flows`, `flowVersions`, `flowRuns`.
- 1 alteração aditiva a tabela existente: `scheduledMessages.sourceType` ganha `"flow"`.
- Executor headless: `startFlowRun`, `advanceFlowRun`, `resumeFlowRun` + helpers (`isServiceWindowOpen`, `resolveInboundToFlow`, `validateFlowGraph`).
- 4 tipos de nó: `send.template`, `input.text`, `logic.condition`, `logic.end`.
- 1 trigger: `inbound_message`.
- `send.template` reusa `internal.appointments._executeScheduledMessage` (zero código de gate novo).
- Testes de integração (convex-test/vitest) em `convex/_test/`.

**NÃO entra em F0 (ver F0.9):** UI/React Flow, `send.text|media|interactive`, `logic.wait`/timers, `action.*`, integração viva no `webhooks.processOne`, STOP→stop runs, cron de GC, agentes AI.

**Critério de "feito":** ver F0.8.

---

## F0.0.1 Vocabulário (adições)

| Termo | Significado |
|---|---|
| `flow` | Grafo de automação versionado de um tenant (`flows` row) |
| `flowVersion` | Snapshot imutável publicado de um flow; um `flowRun` fixa-se a uma versão |
| `flowRun` | Execução viva de um flow para **um** contacto (o "SessionState") |
| `node` | Passo no grafo (`send.template`, `input.text`, …). Identificado por `nodeId` (string, gerado no editor) |
| `edge` | Aresta `from {nodeId, port} → to {nodeId}` |
| `port` | Saída nomeada de um nó. `"default"` para a maioria; `"match"`/`"default"` em `logic.condition` |
| `service window` | Janela de 24h da Cloud API. Aberta sse `now - flowRun.lastInboundAt < 24h` |

`flowRunId` é o `sourceRef` das `scheduledMessages` criadas por um flow.

---

## F0.1 Schema (`convex/schema.ts`)

Grafo guardado como JSON na própria row (não normalizar nós/arestas em F0). Validators completos:

```typescript
// ---- shared validators (topo do schema ou convex/lib/flow/validators.ts) ----

const flowNodeValidator = v.object({
  id: v.string(),                                  // nodeId estável (gerado no editor)
  type: v.union(
    v.literal("send.template"),
    v.literal("input.text"),
    v.literal("logic.condition"),
    v.literal("logic.end"),
  ),
  config: v.any(),                                 // validado por NODE_DEFS em runtime/publish (ver F0.2)
});

const flowEdgeValidator = v.object({
  id: v.string(),
  from: v.object({ nodeId: v.string(), port: v.string() }),   // port default = "default"
  to: v.object({ nodeId: v.string() }),
});

const flowGraphValidator = v.object({
  entryNodeId: v.string(),                         // nó-alvo do trigger
  nodes: v.array(flowNodeValidator),
  edges: v.array(flowEdgeValidator),
});

const flowTriggerValidator = v.object({
  kind: v.literal("inbound_message"),              // F0: só este
  match: v.object({
    op: v.union(
      v.literal("equals"), v.literal("contains"),
      v.literal("starts_with"), v.literal("any"),  // "any" = qualquer inbound
    ),
    value: v.optional(v.string()),                 // ignorado quando op="any"
    caseSensitive: v.optional(v.boolean()),
  }),
});

// ---- tabelas ----

flows: defineTable({
  tenantId: v.id("tenants"),
  name: v.string(),
  status: v.union(v.literal("draft"), v.literal("published"), v.literal("archived")),
  publishedVersion: v.optional(v.number()),        // aponta para a flowVersions activa
  trigger: flowTriggerValidator,
  graph: flowGraphValidator,                        // draft em edição (publish copia p/ flowVersions)
  variables: v.array(v.object({ name: v.string(), initial: v.optional(v.string()) })),
  createdBy: v.id("members"),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_tenant", ["tenantId"])
  .index("by_tenant_status", ["tenantId", "status"]),   // resolver inbound → flows published

flowVersions: defineTable({
  flowId: v.id("flows"),
  tenantId: v.id("tenants"),
  version: v.number(),
  trigger: flowTriggerValidator,
  graph: flowGraphValidator,
  publishedAt: v.number(),
  publishedBy: v.id("members"),
}).index("by_flow_version", ["flowId", "version"]),

flowRuns: defineTable({
  tenantId: v.id("tenants"),
  flowId: v.id("flows"),
  flowVersion: v.number(),
  contactId: v.id("contacts"),
  conversationId: v.id("conversations"),
  phoneNumberId: v.id("phoneNumbers"),
  status: v.union(
    v.literal("running"),                          // a avançar nós (transitório)
    v.literal("awaiting_input"),                   // pausado num input.* (espera inbound)
    v.literal("completed"),
    v.literal("failed"),
    v.literal("stopped"),                          // reservado p/ STOP/consent (usado em F1)
  ),
  currentNodeId: v.optional(v.string()),
  variables: v.record(v.string(), v.string()),
  lastInboundAt: v.number(),                       // janela 24h: última inbound deste run
  lastResumedMessageId: v.optional(v.string()),    // idempotência de resume (metaMessageId)
  stepCount: v.number(),                           // loop guard acumulado
  startedAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),                           // GC (F1); F0 só grava
})
  .index("by_tenant_contact_flow", ["tenantId", "contactId", "flowId"])
  .index("by_conversation_status", ["conversationId", "status"])   // resume: run activo nesta conversa
  .index("by_tenant_status", ["tenantId", "status"]),
```

**Alteração aditiva (expand) à tabela existente** — `scheduledMessages.sourceType` ganha `v.literal("flow")`. Nenhuma row existente afectada; sem contract. O `sourceRef` passa a poder ser um `flowRunId`.

```typescript
sourceType: v.union(
  v.literal("appointment_reminder"),
  /* … existentes … */
  v.literal("flow"),                               // NOVO
),
```

**Migration:** puramente aditiva (3 tabelas novas + 1 membro de union). Plano expand→migrate→contract degenera em só-expand. Confirmar com `npx convex dev` (regenera `_generated/`) e `npx tsc --noEmit`.

---

## F0.2 Node registry (`convex/lib/flow/nodeDefs.ts`)

Padrão config-driven (roubado do plugin manifest do OpenWA). Em F0 é a fonte da validação de publish e do runtime; em F3 alimenta também o editor.

```typescript
type NodeDef = {
  category: "send" | "input" | "logic";
  outputs: string[];                               // portas de saída válidas
  validateConfig: (config: unknown) => void;       // throw ConvexError("INVALID_FLOW") se inválido
  requiresApprovedTemplate?: boolean;
};

export const NODE_DEFS: Record<FlowNodeType, NodeDef> = {
  "send.template": {
    category: "send", outputs: ["default"], requiresApprovedTemplate: true,
    // config: { templateId: Id<"templates">, variables: Record<string,string|`{{var}}`> }
    validateConfig: assertSendTemplateConfig,
  },
  "input.text": {
    category: "input", outputs: ["default"],
    // config: { variable: string }   (nome de variável onde guardar a resposta)
    validateConfig: assertInputTextConfig,
  },
  "logic.condition": {
    category: "logic", outputs: ["match", "default"],
    // config: { variable: string, op: ConditionOp, value?: string }
    validateConfig: assertConditionConfig,
  },
  "logic.end": {
    category: "logic", outputs: [],
    validateConfig: () => {},
  },
};
```

Operadores de `logic.condition` (subset do `matchComparison` do Typebot): `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `is_set`, `is_empty`.

---

## F0.3 Helpers puros (`convex/lib/flow/`)

```typescript
// window.ts — janela 24h (unit-testável, sem ctx)
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export function isServiceWindowOpen(lastInboundAt: number, now: number): boolean {
  return now - lastInboundAt < SERVICE_WINDOW_MS;
}
// F0: send.template ignora isto (template é sempre permitido). O helper existe e é testado
// porque F2 (send.text free-form) gateia por ele. Provar agora evita retrofit.

// match.ts — avaliação de condição
export function evalCondition(value: string | undefined, op: ConditionOp, target?: string): boolean;

// triggerMatch.ts — casa texto inbound contra flowTrigger.match
export function matchesTrigger(text: string, match: FlowTriggerMatch): boolean;

// graphValidation.ts — validateFlowGraph(graph, NODE_DEFS) → lança INVALID_FLOW se:
//   • entryNodeId não existe nos nodes
//   • nodeId duplicado ou edge aponta p/ nodeId inexistente
//   • nó alcançável usa porta de saída fora de NODE_DEFS[type].outputs
//   • nó não-terminal (≠ logic.end / ≠ input.*) sem edge de saída na porta "default"
//   • logic.condition sem edge nas portas "match" E "default"
//   • nó inalcançável a partir de entryNodeId (warning → erro em publish)
//   • config inválido por NODE_DEFS[type].validateConfig
```

---

## F0.4 Executor (`convex/flows.ts`)

Espelha `bot-engine` do Typebot (`startSession`/`continueBotFlow`/`walkFlowForward`) mas em **mutations atómicas + scheduler**. Em F0 todos os nós são DB-only ou pausa → `advanceFlowRun` é uma **internalMutation** (transacção única, determinística, sem HTTP). `action.*` em F2 vão exigir um wrapper de action; não em F0.

### `startFlowRun` — internalMutation
```
args: { tenantId, flowId, contactId, conversationId, phoneNumberId, triggerText, now }
1. carrega flow (loadByIdInTenant). Se status !== "published" → return null.
2. carrega flowVersion = by_flow_version (flowId, flow.publishedVersion).
3. guard 1-run-por-(contacto×flow): existe flowRun em ["running","awaiting_input"]
   para (tenantId, contactId, flowId)? → return null (não duplicar).
4. (defensivo) re-valida matchesTrigger(triggerText, version.trigger.match); se não casa → null.
5. insere flowRun {
     status:"running", flowVersion, currentNodeId: version.graph.entryNodeId,
     variables: Object.fromEntries(version.variables.map(initial ?? "")),
     lastInboundAt: now, stepCount: 0, startedAt: now, updatedAt: now,
     expiresAt: now + RUN_TTL_MS,
   }
6. ctx.scheduler.runAfter(0, internal.flows.advanceFlowRun, { flowRunId, tenantId })
7. appendAudit "flow.run_started"
8. return flowRunId
```

### `advanceFlowRun` — internalMutation  ← o "walkFlowForward"
```
args: { flowRunId, tenantId }
1. run = loadByIdInTenant("flowRuns", flowRunId). Se status !== "running" → return (idempotência).
2. version = by_flow_version(run.flowId, run.flowVersion); nodesById = index(version.graph.nodes).
3. node = nodesById[run.currentNodeId]; se ausente → run.status="failed"(reason "node_missing"); return.
4. loop:
   a. guard: se ++stepCount > MAX_STEPS (100) → status="failed"(reason "loop_guard"); break.
   b. switch node.type:

      "send.template":
        tpl = loadByIdInTenant("templates", config.templateId)
        se tpl.status !== "approved" → status="failed"(reason "template_not_approved"); break.
        vars = substitui {{var}} de config.variables com run.variables
        schedId = insert scheduledMessages {
            tenantId, contactId: run.contactId, phoneNumberId: run.phoneNumberId,
            templateId, templateVersion: tpl.currentVersion, variables: vars,
            sendAt: now, sourceType: "flow", sourceRef: flowRunId,
            status: "scheduled", attempts: 0, createdAt: now,
        }
        ctx.scheduler.runAfter(0, internal.appointments._executeScheduledMessage,
                               { scheduledMessageId: schedId })   // reusa gates+dispatch existentes
        node = followEdge(node.id, "default")

      "logic.condition":
        port = evalCondition(run.variables[config.variable], config.op, config.value) ? "match" : "default"
        node = followEdge(node.id, port)

      "logic.end":
        status = "completed"; break

      "input.text":
        run.currentNodeId = node.id; status = "awaiting_input"; break   // PÁRA o loop

   c. se followEdge devolveu null (sem edge) → status = "completed"; break.
5. patch run { status, currentNodeId, stepCount, updatedAt }
6. appendAudit "flow.run_advanced" { fromNode, toStatus }
```
`followEdge(nodeId, port)` = procura edge com `from.nodeId===nodeId && from.port===port`; devolve `nodesById[edge.to.nodeId]` ou `null`.

### `resumeFlowRun` — internalMutation  ← o "continueBotFlow"
```
args: { tenantId, conversationId, inboundText, metaMessageId, now }
1. run = by_conversation_status(conversationId, "awaiting_input").unique(). Se ausente → return null.
   (run carregado por index já é do tenant via conversationId; confirmar run.tenantId===tenantId.)
2. idempotência: se run.lastResumedMessageId === metaMessageId → return null (inbound repetida).
3. node = nó actual; se node.type !== "input.text" → status="failed"(reason "bad_resume_node"); return.
4. run.variables[node.config.variable] = inboundText
5. patch run {
     variables, lastInboundAt: now,         // ← REABRE a janela 24h
     lastResumedMessageId: metaMessageId,
     currentNodeId: followEdge(node.id,"default")?.id ?? <end>,
     status: "running", updatedAt: now,
   }
6. ctx.scheduler.runAfter(0, internal.flows.advanceFlowRun, { flowRunId: run._id, tenantId })
7. appendAudit "flow.run_resumed"
8. return run._id
```

### `resolveInboundToFlow` — internalQuery (construído em F0, **chamado** em F1)
```
args: { tenantId, text }
→ flows by_tenant_status(tenantId, "published"); primeiro cujo trigger.match casa
  matchesTrigger(text, ...) → devolve flowId | null. (Ordem determinística por createdAt.)
```

### `publishFlow` — tenantMutation (mínimo, p/ seedar testes de forma realista)
```
args: { flowId }
1. flow = loadByIdInTenant; validateFlowGraph(flow.graph, NODE_DEFS)  (lança INVALID_FLOW)
2. version = (max flowVersions.version p/ flowId) + 1
3. insert flowVersions { flowId, tenantId, version, trigger: flow.trigger, graph: flow.graph, … }
4. patch flow { status:"published", publishedVersion: version, updatedAt }
5. appendAudit "flow.published"
```

---

## F0.5 Reuso do dispatch existente (sem código de gate novo)

`send.template` insere uma `scheduledMessages` (`sourceType:"flow"`) e agenda **a mesma** função que os appointments usam: `internal.appointments._executeScheduledMessage` → `_claimAndDispatch`. Esse claim já corre os gates (consent/quality) e cria a `messages` + `_dispatchOne`. A guarda de validade de appointment em `_claimAndDispatch` está atrás de `sm.sourceType === "appointment_reminder"`, logo `sourceType:"flow"` salta-a e segue directo para os gates — **nenhuma alteração** a `_claimAndDispatch` necessária além de já tolerar o novo `sourceType` (compila por ser union aditivo).

➡️ Resultado: F0 prova orquestração **e** entrega real, sem duplicar gates. O gating *flow-aware* (STOP→stop run, janela 24h para free-form, wait/timer) é F1/F2.

---

## F0.6 Audit (reusa `appendAudit`)

Acções novas: `flow.run_started`, `flow.run_advanced`, `flow.run_resumed`, `flow.run_completed`, `flow.run_failed`, `flow.published`. `actorType` = `"scheduler"` (advance/resume disparados por scheduler) ou `"member"` (publish). Hash-chain inalterado.

---

## F0.7 Testes (`convex/_test/flowExecutor.test.ts`)

Seguir o padrão dos testes existentes (convex-test, helpers de seed de tenant/contacto/template approved). Seedar flow + publicar via `publishFlow`. Cada teste chama os internals directamente (headless — sem webhook).

| # | Teste | Asserção |
|---|---|---|
| 1 | Linear happy path | trigger→`send.template`→`input.text`; após `startFlowRun`+`advanceFlowRun`: run `awaiting_input`, currentNodeId = input; 1 `scheduledMessages` (sourceType "flow", sourceRef=runId) criada e `_executeScheduledMessage` agendada |
| 2 | Resume avança | `resumeFlowRun` grava resposta na variável, `lastInboundAt` actualizado, agenda advance; run volta a `running`→`completed` |
| 3 | Condition branching | variável que casa → porta `match`; que não casa → `default`; cada caminho leva ao nó certo |
| 4 | Idempotência de resume | `resumeFlowRun` 2× com mesmo `metaMessageId` → 1 só advance, 1 só variável escrita |
| 5 | Isolamento tenant | run do tenant A: `loadByIdInTenant` com ctx do tenant B lança `CROSS_TENANT_ACCESS`; resume por conversa do tenant B não encontra o run |
| 6 | 1 run por contacto×flow | `startFlowRun` 2× para o mesmo (contacto,flow) com run activo → 2ª devolve null, sem 2º run |
| 7 | Loop guard | grafo com ciclo sem `input.*` → `advanceFlowRun` aborta em MAX_STEPS, status `failed` reason `loop_guard` |
| 8 | Janela 24h (unit) | `isServiceWindowOpen(now-23h, now)===true`; `(now-25h)===false` |
| 9 | Template não aprovado | `send.template` com template `draft` → run `failed` reason `template_not_approved`, **sem** `scheduledMessages` |
| 10 | validateFlowGraph | grafos inválidos (orfão, edge solta, condition sem 2 portas, entry inexistente) lançam `INVALID_FLOW`; grafo válido passa |
| 11 | Completion | `logic.end` → `completed`; nó sem edge na porta seguida → `completed` |

Comando: `npm test` (vitest) no `app/`. Todos verdes = F0 done.

---

## F0.8 Critérios de aceitação

- [ ] `npx convex dev` regenera `_generated/` sem erro; `npx tsc --noEmit` limpo.
- [ ] 3 tabelas + index criados; `scheduledMessages.sourceType` aceita `"flow"`.
- [ ] `startFlowRun`/`advanceFlowRun`/`resumeFlowRun` implementam exactamente o state machine de F0.4.
- [ ] `send.template` cria `scheduledMessages` correcta e agenda `_executeScheduledMessage` (entrega real reusada, zero gate novo).
- [ ] `lastInboundAt` actualizado em start e em cada resume (janela 24h é estado do run).
- [ ] Resume idempotente por `metaMessageId`.
- [ ] Loop guard activo (MAX_STEPS).
- [ ] `validateFlowGraph` bloqueia grafos inválidos em `publishFlow`.
- [ ] 11 testes de F0.7 verdes, incluindo isolamento tenant cross-tenant.
- [ ] Toda mutation usa `loadByIdInTenant` em `ctx.db.get`; toda transição escreve `appendAudit`.

---

## F0.9 Fora de scope (deferido)

| Item | Fase |
|---|---|
| Wiring no `webhooks.processOne` (resolver inbound→start/resume ao vivo) | **F1** |
| STOP keyword / consent revogado → marca `flowRuns` `stopped` + cancela jobs | **F1** |
| `logic.wait` + `resumeAfterTimer` + fecho de janela 24h | **F1** |
| Cron de GC de runs presos (`by_tenant_status` + `expiresAt`) | **F1** |
| `send.text`/`media`/`interactive_buttons`/`list` + gate de janela 24h para free-form | **F2** |
| `input.choice`/`media`, `action.http_request`/`call_agent`/`book_appointment` | **F2** |
| Editor React Flow + painel config-driven de `NODE_DEFS` | **F3** |
| Vista de runs / observabilidade | **F4** |

---

## F0.10 Checklist executável (ordem)

1. `convex/lib/flow/validators.ts` — validators partilhados (node/edge/graph/trigger). *(podem viver no schema; extrair p/ reuso)*
2. `convex/schema.ts` — 3 tabelas + index; `+ "flow"` no `sourceType`.
3. `npx convex dev` (regenera `_generated/`) → `npx tsc --noEmit`.
4. `convex/lib/flow/nodeDefs.ts` — `NODE_DEFS` + `assert*Config`.
5. `convex/lib/flow/{window,match,triggerMatch,graphValidation}.ts` — helpers puros.
6. `convex/_test/flowHelpers.test.ts` — unit dos helpers (testes #8, #10 isolados primeiro — TDD).
7. `convex/flows.ts` — `startFlowRun`, `advanceFlowRun`, `resumeFlowRun`, `resolveInboundToFlow`, `publishFlow`.
8. Confirmar `_claimAndDispatch` tolera `sourceType:"flow"` (sem alteração esperada; só verificar branch do appointment).
9. `convex/_test/flowExecutor.test.ts` — testes #1–#7, #9, #11.
10. `npm test` verde + `npx tsc --noEmit` limpo → fechar F0.

> Disciplina TDD (skill `test-driven-development` do projecto): escrever o teste antes da função sempre que o caso seja determinístico — helpers (passo 6) e cada ramo do executor.
