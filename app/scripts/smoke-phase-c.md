# Smoke — Fase C (Agentes IA multi-provider)

Regras de sempre: nunca colar chaves de API, tokens, HMAC, IDs completos ou payloads
reais em issues, commits ou respostas. As chaves das clínicas ficam encriptadas com
`WABA_TOKEN_ENCRYPTION_KEY_V1`; as da plataforma vivem só no env do Convex.

## C1 — Fundações IA

### Env (Convex)
```bash
npx convex env set ANTHROPIC_API_KEY <chave>          # e/ou OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY
```
`scripts/predeploy-check.mjs` avisa quando nenhuma chave de plataforma existe (as clínicas
podem usar chave própria).

### Backfills
Nenhum (tabelas novas: aiSettings, aiAgents, aiAgentVersions, aiRuns, aiTurns,
aiToolInvocations, aiCostLedger; campos opcionais em channelAutomationDispatches).

### Verificações
1. `aiSettings:get` (owner) devolve defaults: Anthropic, router `claude-haiku-4-5-20251001`,
   especialista `claude-sonnet-5`, orçamento 5 USD/dia, `ready: false`.
2. Guardar chave própria (`aiSettings:setProviderKey`) → só aparece mascarada
   (`••••XXXX`); `auditLog` regista `ai.key.set` sem a chave.
3. `aiProviders:probe` → `ok: true` com latência; provider sem chave → mensagem
   "Nenhuma chave configurada para este provedor".
4. Fallback: com provedor de recurso configurado, um 503 no principal segue para o
   secundário (testes `aiProvider.test.ts`); chaves inválidas nunca são retentadas.

## C2 — Configuração de agentes, gates de publicação, Definições › IA

### Verificações
1. Definições › IA: escolher provedor/modelos, guardar, "Testar ligação" → estado
   "Pronto"; chave própria guardada aparece só como `••••XXXX`.
2. `/app/agents` › "Novo agente" (Recepção, canal Hub) → rascunho com ferramentas por
   omissão; a lista de verificação mostra bloqueios (conhecimento, provedor) e avisos
   (sandbox, DPIA).
3. Selecionar conhecimento ativo, guardar → bloqueios desaparecem; "Publicar" cria a
   versão 1 (checksum) e o estado passa a Ativo. Editar o rascunho depois não altera
   a versão publicada.
4. Segundo agente com o mesmo objetivo no mesmo canal → bloqueio "já existe um agente
   ativo". Pausar/retomar e apagar rascunho funcionam; auditoria regista tudo.
5. Menu: "Agentes" abre `/app/agents`; "Fluxos por palavra-chave" (menu ⚙) abre o estúdio
   antigo `/app/chatbots`.

## C3 — Ferramentas reais e sandbox

Ferramentas do agente (allow-list por versão, idempotentes por turno+ferramenta+input,
auditadas em `aiToolInvocations`): consultar_agenda (só leitura), reservar_slot
(`reserveSlotInternal`, `source: ai`, businessKey `ai:{turno}:reservar:…`), confirmar_consulta
(`confirmInternal` via `ai`), atualizar_lead (nunca regride), criar_lembrete_equipa,
agendar_follow_up (regra ativa obrigatória), enviar_template (só aprovados, fora da janela),
aplicar_tag, abrir_caso_humano (`openHumanCaseInternal`, pára a IA).

### Verificações
1. Agente › Sandbox › cenário "Marcação" → transcrito mostra `consultar_agenda` e
   `reservar_slot` em `dry_run`; nenhuma marcação real é criada; a lista de verificação
   deixa de avisar "sandbox".
2. Cenário "Pergunta clínica" → `handoff` com motivo `clinical_question` e a mensagem de
   passagem à equipa; "Pede pessoa" → `handoff/human_request`.
3. Em produção (C4), o turno regista cada ferramenta com estado e duração em
   `aiToolInvocations`; repetir o mesmo passo devolve `replayed: true`.

## C4 — Runtime (respostas reais)

Fluxo: mensagem recebida → `channelAutomation.dispatchInbound` (sem fluxo por palavra-chave)
→ `aiRuntime.claimTurn` (modo da conversa, caso humano, DND, allowlist do piloto, agente
ativo publicado, orçamento diário, limites por conversa, coalescing) → `processTurn`
(pré-router → router → especialista com ferramentas → guards → reparação → fallback)
→ `_finishTurn` (ledger, caso humano em handoff/falha, `awaiting_send`) →
`iaSolutionHub.dispatchOutboundJob({kind: ai_reply})` → `settleAiReply` (turno `completed`,
evento "Agente IA respondeu"; falha de envio → conversa em modo humano + alerta).

### Cron
| Cron | Cadência | Função |
|---|---|---|
| ai stale turn sweep | 10 min | `aiRuntime:sweepStaleTurns` — turnos `processing` há >10 min → `failed/STALE_TURN`, próximo passo na conversa |

### Verificações (número de teste na allowlist; agente publicado; provedor testado)
1. Enviar "Quais são os horários?" → em segundos chega a resposta do agente; na
   timeline "Agente IA respondeu"; Definições › IA mostra o custo no ledger (Relatórios em C5).
2. "Quero marcar consulta" → o agente propõe horários reais (`consultar_agenda`) e, após
   escolha, reserva (`reservar_slot`) com rodapé "📅 Marcado…"; a Agenda mostra a
   marcação com origem IA.
3. "Quero falar com uma pessoa" → resposta de passagem + caso humano aberto; a IA fica
   `handed_off` e não volta a responder até o caso ser resolvido e a IA retomada.
4. Responder manualmente do inbox → a IA pausa (`ai.paused`); "Retomar IA" (C5) reativa.
5. Orçamento: pôr 0,01 USD em Definições › IA → próxima mensagem gera alerta
   "Orçamento diário de IA esgotado" e a conversa fica para a equipa.
6. Enviar 2 mensagens seguidas → uma resposta por mensagem, sem duplicados
   (`aiTurns`: uma `completed`, outra `skipped/COALESCED` + `coalesce:` `completed`).
