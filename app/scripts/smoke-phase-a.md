# Smoke manual — Fase A (Inbox operacional)

Ambiente: produção (`openbsp-ashy.vercel.app`) **depois** de `npx convex deploy` a partir de `main` e do deploy Vercel. Usar o número de teste allowlisted e um segundo número fora da allowlist.

| # | Passo | Esperado |
|---|---|---|
| 1 | Enviar uma mensagem do **número fora da allowlist** para o canal do piloto | Thread aparece no Inbox com chip "Fora do piloto"; na conversa, pill "A IA não conseguiu responder · número fora da lista autorizada" e banner âmbar com acção (admin: "Adicionar à lista do piloto"; agente: "Pedir inclusão"). |
| 2 | Como admin, clicar "Adicionar à lista do piloto" | Abre Definições › WhatsApp com o número pré-preenchido no rascunho da lista; guardar e voltar a activar o piloto. |
| 3 | Como agente, "Pedir inclusão no piloto" | Pill "pediu a inclusão" na conversa; lembrete criado para o admin (painel › Tarefas). Segundo clique no mesmo dia → "Já existe um pedido de hoje". |
| 4 | Cabeçalho da conversa: mudar Etapa, Intenção, Responsável ("Eu"), Próxima acção e Prazo (+4h) | Guarda ao mudar; painel › Histórico lista as alterações com antes/depois. |
| 5 | "Passar à equipa" → abrir caso com urgência Alta | Chip "Caso aberto · SLA em 2h"; botão Retomar IA fica bloqueado com aviso; lista mostra chip de SLA. |
| 6 | Resolver o caso com "Devolver à IA" | Chip desaparece; Etapa volta à anterior; pill "Conversa devolvida à IA"; enviar nova mensagem do número allowlisted → bot responde. |
| 7 | Leads: arrastar o cartão para "Quer agendar" (ou "Mover para…") | Coluna actualiza em tempo real; abrir cartão → conversa certa (`?channel=`). |
| 8 | Inbox: alternar filtros (Todas, Minhas, Abertas, Favoritas, Fechadas) | Sem reload da página (URL muda, lista actualiza). |
| 9 | Adiar (menu: 4h / Amanhã 9h / personalizado) e "Retomar" | Chip "Adiada até …" com Retomar; filtro Adiadas mostra a conversa. |
| 10 | Nota interna com menção + lembrete (+1h) a partir do sino no desktop | Nota mostra @nome; lembrete listado; ao vencer, badge vermelho na lista. |
| 11 | Resposta rápida `/` com texto já escrito | Insere no cursor sem apagar o rascunho; Enter envia, Shift+Enter quebra linha. |
| 12 | Definições › Espaço: criar campo "Seguro" (lista) → painel do paciente preencher | Valor guardado; visível ao reabrir. |
| 13 | Painel › Consentimentos: Autorizar Marketing com prova | Estado passa a Autorizado; histórico regista `inbox.consent.recorded`. |
| 14 | Operação › Clínica: criar serviço com duração 5 min | Mensagem clara "Duração: entre 10 e 480 minutos" (sem erro cru do Convex). |
| 15 | Campanhas › Lançar (tenant só-Hub) | Aviso explicando que campanhas por template exigem Meta directo + botão para micro-campanha. |

Verificação técnica após deploy (uma vez):

```bash
cd app
npx convex run leads:_backfillLeadStatus '{}' --prod
npx convex run leads:_backfillOrigin '{}' --prod
npx convex run clinic:_backfillOpenHumanCases '{}' --prod
```
