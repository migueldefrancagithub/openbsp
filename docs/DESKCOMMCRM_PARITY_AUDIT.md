# DeskcommCRM — auditoria de paridade (2026-09-03)

Fonte: https://github.com/melgarafael/DeskcommCRM (MIT, © Rafael Melgaco), clone lido em
2026-09-03. Comparação directa contra o OpenBSP depois dos modos de maturação (PR #22).

O objectivo não é copiar código (stacks diferentes: Next+Supabase+WAHA vs Next+Convex+canal
neutro), é trazer as **regras de negócio** que lá estão desenhadas e aqui faltavam.

## Regras que o DeskcommCRM tem e nós não tínhamos

| # | Regra / UX | Onde vive lá | Estado aqui | Decisão |
|---|---|---|---|---|
| 1 | **O handoff avisa o lead antes de silenciar.** Texto determinístico ao cliente, variando por motivo (pediu humano · suspeita de opt-out · orçamento · outro) e pela disponibilidade real da equipa; 3 variantes por lead (hash) para não ser vetado pelo anti-repetição; enviado ANTES de gravar a trava | `lib/escalacao/aviso-ao-lead.ts`, `lib/ai/handoff/aviso-ao-lead.ts` | só enviávamos o texto que o modelo tivesse gerado | **trazer** |
| 2 | **Disponibilidade da equipa entra no prompt.** Elegível = disponível ∧ dentro do horário ∧ carga < capacidade; heartbeat velho = offline; frase de expectativa muda quando há 0 configurados / 0 disponíveis / N disponíveis | `lib/escalacao/disponibilidade.ts`, `lib/routing/eligibility.ts` | presença e round-robin sim; capacidade, horário e frase não | **trazer** |
| 3 | **"Quem manda na conversa" é uma função pura só.** 5 estados (humano · automático · ninguém · aguardando · encerrada) + 5 motivos de silêncio, com rótulos; a aba Fila deriva daí e inclui as conversas do automático quando a org não tem agente no ar | `lib/inbox/comando-da-conversa.ts` | lido em vários sítios a partir de 5 campos | **trazer** |
| 4 | **Posição na fila e tempo de espera** na linha da conversa ("3º", "Aguardando há 5 min") | `components/inbox/ConversationListItem.tsx` | não existia | **trazer** |
| 5 | **Motivo da retenção na conversa.** Veto de envio traduzido para linguagem leiga em 3 famílias: protecção, conformidade, qualidade | `lib/inbox/retention-copy.ts` | tínhamos eventos de sistema e banner do piloto | **trazer** |
| 6 | **Central de avisos + sino** com 18 tipos, severidade, abas Abertos/Resolvidos, contador no topo | `agent_inbox_items` (0050), `/app/ai/inbox` | `opsAlerts` só na Operação, sem sino nem tipos de IA | **trazer** |
| 7 | **Declaração do turno e promessa sem dono.** O agente declara intenções e promessas no fecho; se uma promessa fica sem ninguém responsável, nasce aviso | `lib/agent-engine/agent/declaracao.ts`, `operator-turn.ts` | não existia | **trazer** |
| 8 | **Fila de confirmação de dados.** A IA propõe e-mail/nome/telefone, um humano confirma, a proposta vence em 7 dias e o vencimento gera aviso; recusa cedo (anonimizado, igual ao actual, inválido) | `lib/contacts/proposta-de-dado.ts` (0123/0124) | não existia | **trazer** |
| 9 | **Propostas de próxima acção.** A IA propõe, o humano Aprova ou Ignora, as duas viram registo, e a recusa entra no prompt para não voltar a sugerir o mesmo | `lib/leads/next-action.ts`, `/app/ai/proposals` | `nextStep` só manual | **trazer** |
| 10 | **Radar de risco.** Buckets crítico · em risco · em voo · em dia, janela de esfriamento por etapa, e a contagem de "demandas abertas sem próximo passo" | `lib/leads/risk-radar.ts`, `/app/radar` | SLA de 1.ª resposta e de caso humano | **trazer** |
| 11 | **Correcção humana como sinal.** Humano desfazer o que a IA fez conta como devolução ou redireccionamento, e só se o último movimento foi da IA | `lib/leads/correcao-humana.ts` | feedback só das respostas | **trazer** |
| 12 | **Risco por capacidade e pacotes.** Só consulta · altera dados · efeito que não dá para desfazer; capacidades agrupadas em jornadas; as críticas ligam-se uma a uma | `lib/mcp/tools/pacotes.ts`, `catalogo/*` | `TOOL_RISK` existia sem tela | **trazer** |
| 13 | **Circuit breaker de ferramentas.** Mesma ferramenta e mesmos argumentos a falhar → avisa → bloqueia; mesma ferramenta a falhar com argumentos diferentes → pára no run; ferramenta de leitura a devolver sempre o mesmo → bloqueia | `lib/agent-engine/agent/tool-breaker.ts` | só tecto de chamadas por turno | **trazer** |
| 14 | **Disclosure e vazamento de vocabulário interno.** A 1.ª mensagem a um contacto novo identifica-se como assistente (injecta ou veta); a resposta não pode citar nomes internos de sistema | `guardrails/disclosure/`, `vazamento-interno.ts` | guards de saúde, promessa, link e tamanho | **trazer** |
| 15 | **Graduação com revisão humana.** O flywheel propõe melhorias de playbook e um humano publica como versão nova; existe aviso "proposta aguardando revisão" | `lib/agent-engine/flywheel/live.ts`, `promotion_review` | modos manuais, sem métrica de prontidão | **trazer** |
| 16 | **Tempo adaptativo de follow-up.** A IA propõe o intervalo, o nó grampeia em [mín, máx] e guarda o que ela pediu e por quê | `lib/followup/timing-plan.ts` | atraso fixo por regra | **trazer** |
| 17 | **Dossiê do follow-up + intervenção.** Cada passo registado e legível, com pausar · retomar · adiar · saltar · cancelar, auditado | `/app/ai/followups/enrollments/[id]` | tentativas e paragem automática | **trazer (reduzido)** |
| 18 | Atalhos de teclado no inbox (j/k/r/a/e/?) | `InboxKeyboardShortcuts.tsx` | não existia | **trazer** |
| 19 | Anti-ban próprio: janela horária, jitter, escada de warm-up, tecto diário por número | `lib/agent-engine/pacing/*` | é do Hub (ficheiro guardado) | **não trazer** — o writer único e o rate limit são do provider; duplicar aqui criaria segunda verdade |
| 20 | Divisão da resposta em várias bolhas | `split-message.ts` | não existia | **não trazer agora** — multiplicaria envios por turno e mexia no esquema de nonce do outbox |
| 21 | Camadas semânticas por organização (promessa semântica, jailbreak) com 3 estados | `guardrails/camadas-da-org.ts` | guards determinísticos sempre ligados | **não trazer agora** — cada camada é uma chamada de modelo por mensagem; fica para depois da chave de IA em produção |
| 22 | MCP como superfície pública do CRM | `lib/mcp/**` | REST v1 neutra pronta, registo pendente | **fora de âmbito** |

## Regras que já tínhamos em paridade

Resumo de continuidade na volta ao agente (decisões humanas, notas, pendência com o cliente),
gate de publicação por versão imutável, orçamento diário e tecto de turnos, coalescing de rajadas,
fallback determinístico, idempotência por chave de negócio, escopo por tenant, auditoria em cadeia,
adiar com presets, notas internas, menções, etiquetas, janela de 24 h com escape por template.

## O que este repo faz diferente de propósito

- **Um único writer de saída.** Tudo o que sai passa pelo router `outboundJobs` e pelo Hub. O
  DeskcommCRM tem cadeia de envio própria com dez gates; aqui os gates de canal são do provider.
- **Modos de maturação como eixo.** Lá a autonomia cresce por capacidade ligada e por camada; aqui
  o eixo é Sandbox → Co-Piloto → Automático, e a fila de aprovação é o inbox.
- **Convex em vez de Postgres.** Sem RLS: o isolamento é o `tenantQuery`/`tenantMutation` e o
  `loadByIdInTenant`.
