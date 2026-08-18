# Handoff: testar o lab com um único canal partilhado com a Ayamed

Data: 2026-08-18. Estado: **teste inbound bloqueado**, outbound possível com ressalvas.

## O facto que decide tudo

O Hub tem plano `1/1` canal. O canal existente é **Alfapay, +258 84 757 1767**,
ativo, e o seu **único slot de webhook já está ocupado** pelo sistema
IAME/Ayamed, que está em produção.

O OpenBSP só recebe inbound se esse webhook apontar para ele. Apontar significa
**substituir** o da Ayamed. Não há como testar inbound sem partir a Ayamed.

## O que um teste só de outbound prova — e o que não prova

Prova:

- que o channel token é válido e a encriptação em repouso funciona;
- que o kill switch e o allowlist bloqueiam como devem;
- que o `channelOutbox` cria uma linha idempotente com business key;
- que o cliente HTTP do Hub aceita o envio e devolve um `providerMessageId`;
- que a linha fica em `accepted`.

**Não prova nada do que foi construído nas fases 2 e 3:**

- normalização de inbound (`normalizeWebhook`);
- verificação HMAC sobre bytes crus na rota real;
- deduplicação de eventos repetidos;
- reconciliação de `delivered`/`read` para o `channelOutbox`;
- projecção de threads em `channelThreads`;
- o ecrã `/app/channel-inbox`, que só mostra threads criadas por inbound.

Ou seja: o teste de outbound valida o caminho antigo, não o trabalho novo. A
pergunta que continua sem resposta — se o payload real do Hub bate com a forma
`value` da Meta que o adapter normaliza — só o inbound responde.

## Efeitos colaterais do teste de outbound que é preciso aceitar

1. A mensagem sai do **número da Ayamed**. Quem receber vê o número do negócio
   dela, não um número de teste.
2. Abre ou consome uma janela de conversa nesse número, com o custo que a Meta
   cobrar por ela.
3. Fica no histórico de mensagens da Ayamed.
4. **Não responder ao ping.** Qualquer resposta é inbound, e inbound vai para o
   webhook da IAME/Ayamed — mete uma mensagem de teste no fluxo de produção
   dela.

## Três caminhos, por ordem de qualidade

### A. Comprar o segundo canal — R$ 49,90

O único caminho que testa tudo sem tocar na Ayamed. É exactamente o cenário para
que o ADR-002 foi escrito: segundo canal, segundo número, webhook dedicado.
Custa menos do que uma hora a contornar o problema.

### B. Fan-out a partir do n8n — sem custo, mas com trabalho

Manter o webhook do Hub a apontar para a IAME/Ayamed e acrescentar no fluxo n8n
um nó HTTP Request que reenvia o mesmo corpo para o OpenBSP. A Ayamed continua a
ser a primária; o OpenBSP recebe uma cópia.

Requisito não trivial: o OpenBSP valida `X-Hub-Signature-256` sobre os **bytes
exactos**. O n8n tem de calcular esse HMAC com o segredo do canal OpenBSP e
enviar o corpo sem reserializar — qualquer reordenação de chaves ou espaço a
mais invalida a assinatura.

Risco: mete o OpenBSP no fluxo n8n da Ayamed. Se o nó falhar ou atrasar, pode
afectar o fluxo dela consoante como estiver ligado. Ligar sempre em ramo
paralelo, nunca em série, e sem bloquear o caminho principal.

### C. Só outbound — hoje, quase de graça

Um único ping para um número de teste em allowlist, e desligar logo a seguir.
Prova o que está na lista acima e nada mais. Aceitar os quatro efeitos
colaterais.

## Se for o caminho C, a sequência exacta

O que só o operador pode fazer está marcado.

1. **[operador]** Login no OpenBSP com `sidneychambal10@gmail.com`.
2. **[operador]** Copiar do Hub o channel ID e o channel token do canal Alfapay.
3. **[operador]** `Settings › WhatsApp › WhatsApp laboratory bridge`: colar ID e
   token, gerar e copiar o segredo HMAC antes de submeter, e pôr **apenas** o
   número de teste no allowlist.
4. **NÃO** configurar o webhook no Hub. Deixar o da IAME/Ayamed intacto. Este é
   o passo que parte a produção, e é o único que não se pode dar.
5. **[operador]** Enable allowlist.
6. Enviar um ping pelo formulário de teste do Settings.
7. Confirmar `accepted` e `providerMessageId` na tabela de outbox.
8. **[operador]** Voltar a pôr `sendMode` em `disabled`.
9. Não responder à mensagem no telemóvel.

## Reverter

Não há nada a reverter no Hub, porque nada no Hub é alterado. No OpenBSP:
desligar o kill switch (`sendMode: disabled`) e, se quiser limpar, `disconnect`
no canal do laboratório. Nenhuma destas acções toca na Ayamed.

## Estado do OpenBSP quando isto foi escrito

- Convex dev `mild-guanaco-845`: schema publicado, rota de webhook viva,
  `WABA_TOKEN_ENCRYPTION_KEY_V1` configurada.
- Preview Vercel no ar, a apontar ao Convex dev.
- 190 testes verdes; PR #2 aberto contra `work/openbsp-direct-meta-cleanup`.
- Zero canais ligados, zero threads.
