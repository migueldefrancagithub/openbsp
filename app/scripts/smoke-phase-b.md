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
