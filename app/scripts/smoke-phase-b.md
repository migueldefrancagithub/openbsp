# Smoke — Fase B

Checklist manual por slice, a correr **depois** de `npx convex deploy` e do deploy Vercel.
Nunca copiar tokens, IDs completos de canal, números completos ou payloads reais para
este ficheiro, para commits ou para respostas.

## B1 — Fundações (RBAC, auditoria, membros, equipas, sweeps)

### Rotinas novas (crons, sem intervenção)
| Cron | Cadência | Função | O que faz |
|---|---|---|---|
| thread reminder overdue sweep | 5 min | `inboxOperations:sweepOverdueReminders` | lembretes `scheduled` já vencidos passam a `due` (rede de segurança para `_markReminderDue` perdidos) |
| retention candidates report | diário 03:00 UTC | `retention:runDaily` | **só reporta**: cria/actualiza um `opsAlerts` `retention:{dia}` por tenant com eventos mais antigos que `settings.retentionDays`; nunca apaga |

Correr à mão em dev/prod (opcional):
```bash
npx convex run inboxOperations:sweepOverdueReminders '{}'
npx convex run retention:runDaily '{}'
```

### Backfills
Nenhum. `auditLog` começa a ser escrito a partir deste deploy (chain começa em `genesis`
por tenant); `clinicAuditEvents` continua a ser escrito em paralelo.

### Verificações
1. **Auditoria encadeada**: fazer uma acção auditada (mudar papel, editar equipa) e correr
   `npx convex run audit:verifyChain '{}'` autenticado como owner/admin (ou pelo dashboard) →
   `ok: true`, `checked` ≥ 1.
2. **Papéis** (Definições › Equipa): admin muda o papel de um agente (select) → linha
   actualiza; tentar mudar o próprio papel → controlo escondido; admin tentar dar `owner` →
   opção desactivada; suspender um membro → chip "Suspenso"; esse membro deixa de
   conseguir abrir a app (FORBIDDEN) até reactivar.
3. **Último owner**: com um único owner, tentar rebaixá-lo/suspendê-lo por outro owner →
   mensagem "A clínica precisa de pelo menos um proprietário ativo."
4. **Equipas**: lápis → renomear, adicionar/remover membros, marcar líder → guardar;
   lixo → confirmar → equipa desaparece e conversas atribuídas a ela ficam sem equipa
   (verificar no inbox filtro "unassigned").
5. **Capacidades**: com um utilizador `marketing`, tentar criar resposta rápida → mensagem
   de permissão; com `agent`, tentar criar serviço em Operação › Clínica → mensagem de
   permissão; agente consegue criar marcação/follow-up.
6. **Idioma persistido**: mudar para EN, abrir a app noutro browser autenticado → EN.
7. **Sweeps**: criar lembrete com prazo já passado (via dashboard, `status: scheduled`)
   e esperar ≤5 min → aparece como "vencido" no inbox.
8. **Ops alerts**: `npx convex run ops:listAlerts` (autenticado) mostra o alerta de
   retenção se existirem eventos antigos; `acknowledgeAlert` retira-o da lista aberta.

## B2 — Motor de campanhas no canal (Hub)

### Rotinas
| Função | Quem chama | O que faz |
|---|---|---|
| `channelCampaigns:_materializePage` | `create`/`setAudience`/`duplicate` (auto) | pagina `channelThreads` do canal e grava um `campaignRecipients` por conversa: `pending` (elegível) ou `skipped` com `failureCode` (`RECIPIENT_NOT_ALLOWLISTED`, `DND`, `LOST`, `OPT_OUT`, `RECENT_CAMPAIGN`, `SERVICE_WINDOW_EXPIRED`) |
| `channelCampaigns:_continue` | `launch`/`resume` (auto, a cada 65 s) | lote de 15 → `queued` + 1 job `iaSolutionHub:dispatchOutboundJob` por destinatário (3 s de intervalo) |
| `iaSolutionHub:dispatchOutboundJob` | scheduler | **única** ponte com o provedor; passa por `_consumeRateLimit` → `_claimOutbox` (gates do piloto) → `_settleOutbox`; nunca reenvia `unknown` |
| `channelCampaigns:_finalize` | auto | fecha em `completed`/`failed` quando não restam `pending`/`queued` e os `dispatching` já estão marcados `OUTBOX_UNKNOWN` |
| `channelCampaigns:_recomputeStats` | manual | reconstrói `campaigns.stats` a partir das linhas (reparação) |

### Backfills
Nenhum obrigatório. Campanhas antigas (`template_broadcast`, `micro_lab`) não têm `stats`;
se quiser ver taxas numa `micro_lab`, correr `_recomputeStats` para esse `campaignId`.

### Verificações (após deploy)
1. **Criar campanha de texto** para 1 conversa allowlisted com janela aberta →
   `audienceStatus: ready`, resumo com 1 elegível; não-allowlisted aparecem como
   `skipped/RECIPIENT_NOT_ALLOWLISTED` (nunca é tentado o envio).
2. **Lançar** com atestação de consentimento → 1 outbox `hub:text:campaign:{id}:{rid}`;
   `campaignRecipients.status: sent` com WAMID; depois `delivered`/`read` pelos
   webhooks de estado (sem criar conversas novas).
3. **Responder** do telefone → `replied` uma única vez; a thread ganha
   `originCampaignId`; nas taxas `replyRate ≤ 1`.
4. **Link rastreado** (template com variável `tracked_link`): abrir `/r/{token}` no
   telemóvel → redirecciona e marca `clicked`; a pré-visualização do WhatsApp não conta.
5. **Kill switch**: desligar `sendMode` durante um lote → destinatários voltam a
   `pending`, campanha `paused` com `pauseReason` e alerta em `ops:listAlerts`.
6. **Lançar sem piloto pronto** → mensagem "Kill switch do piloto activo".
7. `git diff main -- app/convex/iaSolutionHub.ts` mostra apenas 1 import e 1 action nova.

## B3 — Wizard de campanhas (UI)

Rotas novas: `/app/campaigns` (lista + KPIs), `/app/campaigns/new` (3 passos),
`/app/campaigns/[id]` (detalhe). O estúdio antigo (Meta directo) vive em
`/app/campaigns/legacy` até à contracção da Fase D.

### Verificações
1. **Lista**: com o canal Hub ligado aparece "Nova campanha"; sem canal aparece o
   estado vazio com link para Definições › Canais.
2. **Passo 1 — Público**: escolher etapas (chips) → o painel lateral mostra
   elegíveis/encontradas e os motivos de bloqueio; sem elegíveis o botão
   "Continuar" fica desactivado. Modo "Conversas escolhidas" aceita números um por
   linha.
3. **Passo 2 — Mensagem**: template aprovado lista variáveis `{{n}}` com fonte
   (texto fixo / primeiro nome / link rastreado) e a pré-visualização iOS actualiza;
   texto livre mostra o aviso de janela 24h quando há bloqueados por janela.
4. **Passo 3 — Confirmação**: "A calcular destinatários…" até `ready`; resumo,
   ritmo (15 a cada 65 s) e estimativa; lançar só com a atestação marcada; agendar
   exige data futura (≤30 dias).
5. **Detalhe**: funil com percentagens ≤100%, público/bloqueios, tabs
   Destinatários (filtros por estado, link para a conversa no inbox) e Eventos;
   pausar/retomar/cancelar/duplicar/CSV; motivo da pausa visível.
6. **Mobile (≤400px)**: passos em 3 colunas, cartões empilham, tabela com scroll
   horizontal; nada cortado.

## B4 — Agenda (backend)

### Rotinas / APIs novas
| Função | Notas |
|---|---|
| `clinic:reserveSlot` | idempotente por `businessKey` (devolve `{appointmentId, created}`); contrato usado pelo inbox e pelas ferramentas de IA (Fase C) |
| `clinic:rescheduleAppointment` / `cancelAppointment` / `confirmAppointment(via)` | cancelamentos param notificações pendentes; remarcar liga a antiga (`rescheduledToId`) e a nova (`rescheduledFromId`) |
| `clinic:recordAppointmentOutcome` | `completed` → lead `attended`; `no_show` → lead `no_show` + tarefa de follow-up se existir regra `no_show` activa |
| `clinic:listAgenda` | intervalo local ≤31 dias, por profissional, ≤500 linhas |
| `clinic:sendAppointmentNotice` | cria `followUpTasks` `appointment_confirmation`/`appointment_reminder` (o executor B5 envia) |
| `clinic:listProfessionals` / `saveProfessional` / `archiveProfessional`, `getSettings` / `saveSettings` | fuso horário por clínica (`Intl`), passo dos slots, antecedência mínima, textos das notificações, SLAs |
| auto-confirmação | inbound classificado como `confirm_attendance` ("confirmo") confirma a marcação `scheduled` mais próxima (`confirmedVia: reply`) |

### Backfills
Nenhum: marcações antigas continuam válidas (`businessKey`/`professionalId` opcionais).
`followUpTasks.ruleId` passou a opcional (tarefas de notificação não têm regra).

### Verificações
1. Definições › Clínica: guardar fuso `Africa/Maputo` (ou o da clínica) → slots
   aparecem no horário local correcto.
2. Criar 2 profissionais; marcar a mesma hora para ambos funciona; a mesma hora
   para o mesmo profissional dá "horário indisponível".
3. Marcar a partir de uma conversa → thread passa a "Agendado" e, se veio de
   campanha (≤30 dias), a campanha ganha 1 conversão.
4. Enviar pedido de confirmação (`sendAppointmentNotice`) → tarefa `scheduled`;
   responder "Confirmo" do telemóvel → marcação `confirmed` (via `reply`), tarefa
   `stopped`, evento "Consulta confirmada" na timeline.
5. Remarcar → duas linhas ligadas; cancelar → lead volta a "Interessado".
6. Desfecho "faltou" com regra `no_show` activa → tarefa de follow-up criada.

## B5 — Executor de follow-ups + alertas operacionais

### Rotinas (crons)
| Cron | Cadência | Função | O que faz |
|---|---|---|---|
| follow-up executor | 1 min | `followUps:runDue` | reclama ≤10 tarefas vencidas (≤5 se houver campanha `running` no tenant), valida a conversa (DND, opt-out, perdido, caso humano aberto, marcação cancelada/confirmada), decide texto (janela aberta) ou template (fechada); sem template → `failed` `SERVICE_WINDOW_EXPIRED` + próximo passo na conversa; senão `claimed` + 1 job `dispatchOutboundJob` |
| follow-up stale claim sweep | 10 min | `followUps:sweepStaleClaims` | claims sem settle há >15 min voltam a `scheduled` (ou `failed` após 3) |
| ops unknown outbox sweep | 10 min | `ops:sweepUnknownOutbox` | 1 alerta/dia por tenant com envios `unknown` (crítico ≥5) |
| ops sla breach sweep | 5 min | `ops:sweepSlaBreaches` | 1 alerta por caso humano fora do SLA, com link para a conversa |

Regras de retry (iguais às campanhas): `CHANNEL_RATE_LIMITED` → reagenda pelo `retryAfterMs`
(não conta tentativa); erro transitório/kill switch → backoff 1→2→4 min (máx. 3);
`unknown` → `failed/OUTBOX_UNKNOWN` **sem reenvio**; gates do piloto → `failed` definitivo.
Paragens: resposta do paciente, opt-out, DND, caso humano aberto, marcação
confirmada/cancelada/remarcada, "Parar" no painel do paciente.

### Backfills
Nenhum. Tarefas antigas (`scheduled`, sem `kind`) são tratadas como regras e usam
`followUpRules.message` (`runDue` lê `task.message` → se ausente, falha com
`SERVICE_WINDOW_EXPIRED`; para tarefas antigas correr uma vez):
```bash
# opcional: preencher message nas tarefas antigas (dev/prod), se existirem
npx convex data followUpTasks --limit 5
```

### Verificações
1. Criar regra `no_reply` (0 min) e agendar follow-up numa conversa allowlisted com
   janela aberta → em ≤1 min a tarefa passa a `sent`, aparece "Follow-up enviado" na
   timeline e o painel do paciente mostra "Enviado há…".
2. Mesma regra numa conversa com janela fechada e sem template configurado → `failed`
   com próximo passo "janela de 24h fechada"; com template de lembrete configurado
   (Definições › Clínica) o lembrete de consulta sai como template.
3. Responder do telemóvel com follow-up pendente → tarefa `stopped/patient_replied`.
4. Marcar DND na conversa → pendentes param com `dnd`.
5. Operação mostra o painel de alertas; "Visto" retira o alerta; caso humano fora do
   SLA aparece como crítico com link para a conversa.
