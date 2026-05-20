# Live AQUI Backend Review — 2026-05-15

## O que escapou da live

1. **IA como state machine, nao como chatbot solto.**
   A live foi clara: a IA deve trabalhar sobretudo nos leads de CTWA/ad, parar quando humano assume, parar quando vira oportunidade/reserva, e voltar a poder atuar quando o mesmo contacto entra por novo clique de anuncio. O app tinha campos (`aiState`, `aiPausedReason`), mas ainda faltava uma regra central e auditoria consistente.

2. **Campanha precisa fechar o funil.**
   A UI ja mostrava enviados, entregues, lidos, falhas e cliques, mas o backend ainda nao tinha uma mutation que transformasse resposta inbound ou clique de botao em `campaignRecipients.status = replied/clicked`. Sem isso, o relatorio ficava bonito mas incompleto.

3. **Manychat e clean, mas esconde complexidade no motor.**
   O produto nao deve mostrar “cloud API” ao cliente. Deve mostrar: lead, campanha, lista, custo, qualidade, proximo passo. A complexidade fica no Convex: consentimento, janelas, BSUID, erros Meta, retry seguro e auditoria.

4. **Smart opt-out ainda precisa virar componente de template/botao.**
   O backend ja respeita STOP/PARAR e `user_preferences` da Meta. O que ainda falta e um modelo de template com botoes oficiais/quick replies para criar o “parar mensagens” controlado dentro do proprio template.

5. **Coexistence precisa confirmar echoes de Business App.**
   O app ja entende CTWA e mensagens inbound da Cloud API. A parte de mensagens enviadas pelo WhatsApp Business App em coexistencia ainda depende dos webhooks/formatos finais do provider/Meta. Isso deve entrar como modulo separado para nao contaminar o core.

## Melhorias feitas agora

- Criei `app/convex/lib/aiControl.ts` com regra central:
  - IA so pode ficar `eligible` por default em conversa CTWA.
  - `opportunity`, `booked` e `lost` pausam IA.
  - Toda transicao importante cria `aiAuditEvents`.

- Reforcei `app/convex/conversations.ts`:
  - `setAiState` bloqueia enable manual em conversa organica.
  - `setOpportunityStatus` pausa e audita IA quando o lead vira oportunidade/reserva/perdido.

- Reforcei `app/convex/messages.ts`:
  - resposta humana por texto/template pausa IA.
  - handoff humano agora deixa evento auditavel.

- Reforcei `app/convex/webhooks.ts`:
  - novo clique CTWA reabre o lead como `eligible`, limpa pausa anterior e audita `new_ctwa_click`.
  - inbound com botao/list reply extrai payload para funil de campanha.

- Reforcei `app/convex/campaigns.ts`:
  - nova mutation interna `_markInboundEngagement` marca resposta de campanha como `replied`.
  - clique de botao vira `clicked` com `clickedButtonPayload`.
  - cria `campaignEvents` para o historico do funil.

## Proximas melhorias backend

1. **Templates com botoes oficiais**
   Adicionar componentes de template: body, footer, quick reply buttons, URL/phone buttons. Isso destrava o “smart opt-out button” da live.

2. **Coexistence echoes**
   Criar parser separado para eventos de mensagens enviadas pelo WhatsApp Business App, quando o provider entregar `smb_message_echoes` ou equivalente confirmado.

3. **AI runner real**
   Depois da state machine, criar executor de IA com regras de elegibilidade, cooldown, limite por conversa, aprovacao humana opcional e logs de cada draft/aprovacao.

4. **Account health polling**
   Sincronizar qualidade, limites, billing/token health e template status da Meta para o dashboard principal.

5. **Subscription gating**
   Planos, limites e billing enforcement antes de liberar campanhas em massa.

## Assumpcoes tomadas

- Lead organico nao ativa IA automaticamente. Isto segue a tese da live: IA primeiro em CTWA/ad leads.
- `opportunity`, `booked` e `lost` param automacao. O cliente ja entrou em etapa humana/comercial.
- Se um contacto clica num novo anuncio CTWA, o sistema pode resetar a pausa anterior e tratar como novo contexto comercial.
- A resposta inbound e atribuida ao recipient de campanha mais recente daquele contacto, desde que esteja em estado ativo (`queued`, `dispatching`, `sent`, `delivered`, `read`, `replied`).
