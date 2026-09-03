# Integrações — webhooks assinados e API REST v1

Nunca colar segredos de webhook, chaves de API, tokens do Hub ou payloads reais em
issues, commits ou respostas.

## Webhooks de saída

Configuram-se em **Definições › Integrações** (capacidade `integrations.manage`).
Cada webhook tem um URL `https` público, uma lista de eventos e um segredo mostrado
**uma única vez** (guardado encriptado; só os últimos 4 caracteres voltam a aparecer).

### Eventos
| Tipo | Quando |
|---|---|
| `thread.lead_status_changed` | a equipa muda a etapa do lead no inbox/kanban |
| `appointment.booked` / `confirmed` / `cancelled` / `attended` / `no_show` | agenda (Operação, inbox, Agenda ou ferramenta da IA) |
| `human_case.opened` / `human_case.resolved` | casos humanos (inbox, Operação, passagem pela IA) |
| `ai.replied` / `ai.handoff` | o agente de IA respondeu / passou à equipa |
| `campaign.completed` | uma campanha no canal terminou (com taxas) |

### Entrega e assinatura
- `POST` JSON: `{ "id", "type", "createdAt", "data": {...} }`.
- Cabeçalhos: `x-openbsp-event`, `x-openbsp-delivery` (id idempotente por evento) e
  `x-openbsp-signature: t=<unix seconds>,v1=<hex>`.
- `v1 = HMAC-SHA256(segredo, "<t>.<corpo bruto>")`. Rejeitar se `|agora - t| > 5 min`.
- Idempotência: reenvios repetem o mesmo `x-openbsp-delivery`.
- Retries: 2xx = entregue; 401/403/404/410 = morto; outros erros e timeouts (10 s)
  repetem com backoff 1 m → 5 m → 15 m → 1 h → 3 h → 6 h → 12 h → 24 h (8 tentativas).
  20 falhas seguidas pausam o webhook (alerta na Operação; "Reativar" limpa a série).

Verificação (Node/n8n Function):
```js
const crypto = require("crypto");
const [t, v1] = req.headers["x-openbsp-signature"].split(",").map((p) => p.split("=")[1]);
const expected = crypto.createHmac("sha256", process.env.OPENBSP_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex");
if (expected !== v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new Error("bad signature");
```

### Receitas
- **n8n**: nó *Webhook* (POST, "Raw Body" ligado) → nó *Function* com a verificação
  acima → nó *Google Sheets › Append* mapeando `data.threadKey`, `data.serviceName`,
  `data.startAt` (converter com `new Date(...)`). Marcar o URL do n8n como webhook em
  Definições › Integrações com os eventos `appointment.*`.
- **Google Sheets directo** (Apps Script `doPost`): validar a assinatura com
  `Utilities.computeHmacSha256Signature` e `appendRow`.
- **CRM**: subscrever `thread.lead_status_changed` e `human_case.*`.

## API REST v1 (chave de API)

Chaves em **Definições › Equipa › Chaves de API** (uma por integração, papel mínimo).
`Authorization: Bearer <chave>`; respostas JSON; erros `{ "error": "CODE" }`.

Rotas existentes no `http.ts`: `GET/POST /api/v1/contacts`, `GET /api/v1/templates`.

Rotas neutras do canal (módulo `convex/httpApiV1.ts`, prontas e testadas):
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/v1/threads?limit&cursor` | conversas recentes (etapa, responsável, última mensagem) |
| GET | `/api/v1/threads/{threadKey}?channelId` | uma conversa |
| POST | `/api/v1/threads/{threadKey}/tags` `{ "tag" }` | aplica etiqueta |
| GET | `/api/v1/appointments?from=AAAA-MM-DD&to=AAAA-MM-DD` | agenda |
| POST | `/api/v1/appointments` `{ serviceId, startAt, threadKey?, patientName?, businessKey }` | reserva idempotente |
| GET | `/api/v1/campaigns/{id}/stats` | funil da campanha |

**Registo no `http.ts` (ficheiro guardado — só com autorização do owner).** Uma linha,
depois das rotas `/api/v1/contacts`:
```ts
registerApiV1Routes(http); // import { registerApiV1Routes } from "./httpApiV1";
```
Enquanto não estiver registada, as rotas não existem em produção; o módulo continua
coberto por testes unitários do router.
