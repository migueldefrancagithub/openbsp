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

## C5 — Handoff bidireccional, presença da IA e telemetria

### Verificações
1. Inbox: com um agente ativo, o cabeçalho da conversa mostra o chip "IA a responder";
   responder manualmente ou carregar em "Pausar IA" → chip "IA em pausa"
   (`aiRuns.paused`, turnos em fila descartados, evento "Agente IA em pausa").
2. Com caso humano aberto, "Retomar" no chip devolve "Resolva o caso humano…";
   após resolver, "Retomar" → chip "IA a responder", nota interna "IA retomada…" na
   conversa e evento "Agente IA retomado".
3. Passagem pela IA (`abrir_caso_humano`) → chip "IA passou à equipa"; o próximo
   inbound não é respondido pela IA até retomar.
4. `/app/agents` › Execuções: cartões (turnos, respondidos, passados à equipa,
   falhas, ferramentas, latência, custo) e lista de turnos com ferramentas e tentativas
   por provedor; link para a conversa.
5. `channelAutomation:flowAnalytics` (fluxos por palavra-chave): execuções, conclusão,
   duração média, motivos de fim e nós de abandono.

## C6 — IA no composer

`aiComposer.suggestReply/translate/rewriteTone` (capacidade `ai.compose`): escrevem
`aiSuggestions` e cobram o ledger; **nunca** criam outbox nem dispatch.

### Verificações
1. Inbox › composer: "Sugerir resposta" → faixa âmbar "Rascunho da IA · revê antes de
   enviar" com "Usar"/"Descartar"; "Usar" só preenche o campo de texto.
2. Com texto no campo: "Encurtar", "Mais formal", "Mais próximo", "Traduzir".
3. Um rascunho com linguagem clínica ou promessa de marcação aparece com aviso
   vermelho (guards) e não se envia sem edição.
4. Utilizador `marketing` não vê as ferramentas (sem `ai.compose`).

## C7 — Integrações (webhooks assinados + REST v1)

### Cron
| Cron | Cadência | Função |
|---|---|---|
| webhook delivery | 1 min | `webhooks:deliverDue` — reclama ≤20 entregas vencidas, entrega com assinatura HMAC, backoff 1 m→24 h, morto após 8, pausa após 20 falhas seguidas |

### Verificações
1. Definições › Integrações › "Novo webhook" (URL https de teste, p. ex. um n8n) →
   segredo mostrado uma vez; lista mostra `••••XXXX`.
2. Criar uma marcação → em ≤1 min o endpoint recebe `appointment.booked` com
   `x-openbsp-signature` válida (ver `docs/INTEGRATIONS.md`); a lista de entregas mostra
   `delivered 200`.
3. Apontar o webhook para um URL que devolva 503 → entregas `pending` com nova
   tentativa; após 20 falhas o webhook fica pausado e aparece o alerta; "Reativar".
4. REST v1 neutra: só depois de o owner registar `registerApiV1Routes(http)` em
   `http.ts` (ficheiro guardado); até lá, as rotas não existem.

## M — Modos de maturação do agente (Sandbox · Co-Piloto · Automático)

Modo do agente em `/app/agents` (cabeçalho) e override por conversa no inbox
(`channelThreads.aiMode`). Por omissão os agentes nascem em **Co-Piloto**.

| Modo | O que a IA faz | O que a equipa faz |
|---|---|---|
| Sandbox | só responde no separador Sandbox (dry-run); ignora conversas reais | testa cenários |
| Co-Piloto | processa cada mensagem, propõe texto + acções (`awaiting_approval`); nada é enviado nem escrito | aprova (com ou sem edição) ou descarta no cartão "Sugestão da IA"; as edições viram exemplos do agente |
| Automático | responde e executa ferramentas sozinha (comportamento C4) | intervém quando quiser |

### Verificações
1. Agente publicado em Co-Piloto: mensagem do paciente → no inbox aparece o chip "Sugestão
   IA" na lista e o cartão acima do composer com o texto e as acções propostas (ex.
   "Reservar consulta"); nada é enviado; `aiToolInvocations` regista `dry_run`.
2. Editar o texto e "Aprovar e enviar" → marcação criada (`source: ai`), mensagem enviada
   pelo outbox, `aiFeedback.outcome = edited`; o separador "Evolução" do agente mostra o
   exemplo e a próxima sugestão já o usa.
3. "Descartar" → nada enviado, `aiFeedback.outcome = discarded`.
4. Responder manualmente com sugestão pendente → sugestão retirada (`HUMAN_REPLIED`), o
   agente continua a sugerir na mensagem seguinte.
5. Toggle no cabeçalho da conversa: Automático → a IA responde sozinha; Co-Piloto → volta a
   sugerir e a conversa passa a modo humano. Sandbox no agente → nenhuma conversa real é
   tocada (`AGENT_SANDBOX`).

## P — Paridade DeskcommCRM (auditoria em `docs/DESKCOMMCRM_PARITY_AUDIT.md`)

1. **Quem manda na conversa.** Abrir o inbox com um agente publicado: a lista
   mostra "IA a responder" nas conversas do agente. Pausar a IA numa conversa →
   a linha passa a "IA pausada". Abrir um caso humano → "Caso humano aberto" e o
   botão de devolver desaparece. Marcar não contactar → "Não contactar", sem
   botão de devolver.
2. **Fila.** Filtro "Não atribuídas": cada linha mostra a posição (1º, 2º…) e
   desde quando o paciente espera. Com todos os agentes em Sandbox, as conversas
   do automático passam a contar como fila.
3. **Atalhos.** Com o foco fora do composer: `j`/`k` mudam de conversa, `r` foca
   a resposta, `?` abre a lista de atalhos.
4. **Aviso ao paciente no handoff.** Forçar uma passagem à equipa (palavra-chave
   de handoff) com toda a equipa offline → a mensagem enviada diz que o pedido
   ficou registado, sem prometer contacto imediato. Com alguém online e com
   folga → diz que vai ser atendido a seguir.
5. **Motivo da retenção.** Enviar de um número fora da allowlist → acima do
   composer aparece "Envio retido pela protecção do canal" com a explicação.
6. **Sino de avisos.** Deixar uma sugestão em Co-Piloto sem aprovar mais de 2h
   (ou correr `ops:sweepPendingWork`) → o sino no menu mostra o contador e o
   aviso em português.
7. **Promessa sem dono.** Em Automático, provocar uma resposta com "vou
   confirmar com a equipa" sem nenhuma ferramenta → aviso "prometeu algo e
   ninguém ficou responsável" e próximo passo preenchido na conversa. Em
   Co-Piloto o cartão avisa ANTES de aprovar.
8. **Propostas.** Escrever "o meu email é x@y.mz" → em Operação aparece a
   proposta com o trecho; Aprovar grava no contacto, Ignorar fica no histórico.
   Repetir o mesmo email → nada de novo na fila.
9. **Radar de risco.** Operação mostra os baldes crítico/em risco/em voo e a
   lista de conversas abertas sem próximo passo.
10. **Correcção humana.** Deixar a IA mover a etapa e depois movê-la de volta →
    o separador Evolução do agente conta a correcção.
11. **Ferramentas.** No editor do agente, os pacotes ligam grupos de capacidades
    e cada linha mostra o risco (só consulta · altera dados · não dá para
    desfazer).
