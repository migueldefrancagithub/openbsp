# Handoff: teste OpenBSP com um unico canal Hub

Data original: 2026-08-18. Atualizado: 2026-08-31.

## Estado Atual

O canal Alfapay foi liberado pelo owner para ser laboratorio exclusivo do
OpenBSP. O desenho antigo, em que o Hub fazia fan-out a partir de outro fluxo,
esta encerrado para este produto.

O OpenBSP deve usar apenas:

- o provider `iasolution_hub`;
- o webhook dedicado `/provider-webhook/iasolution-hub/{publicId}`;
- HMAC por canal;
- allowlist de teste configurada no proprio OpenBSP;
- `sendMode: disabled` ate o webhook assinado ser observado;
- `sendMode: allowlist` somente para piloto controlado.

Nao ha fallback para outro webhook, outro fluxo, outro provider ou outro
writer.

## O Que O Teste Prova

Um piloto completo com o canal dedicado prova:

- normalizacao real do payload entregue pelo Hub;
- verificacao HMAC sobre os bytes crus;
- deduplicacao por canal e provider event/WAMID;
- criacao de `channelThreads` e mensagens;
- reconciliacao de status com o outbox existente;
- janela de 24h na thread correta;
- envio manual allowlist-only com WAMID persistido;
- logs/auditoria sem expor segredos.

## Sequencia Segura

1. Confirmar owner/DPA/DPIA.
2. Confirmar allowlists e denylists server-side sem revelar valores.
3. Reutilizar ou reservar o canal lab no Settings.
4. Validar saude/identidade do canal no Hub antes de guardar credenciais.
5. Guardar token e HMAC apenas via UI/secret store.
6. Copiar a URL dedicada para o Hub.
7. Receber um inbound assinado da allowlist.
8. Confirmar thread e janela de 24h.
9. Ativar piloto allowlist-only.
10. Enviar uma resposta de teste apenas ao remetente autorizado.
11. Confirmar WAMID e status/delivery.
12. Voltar a `disabled` se o piloto terminou.

## Guardrails

- Sem campanhas.
- Sem mensagens fora da allowlist.
- Sem expor token, HMAC, channel ID completo, telefone completo ou payload real
  em docs, commits ou respostas.
- Sem alterar outro projeto, outro webhook ou outro provedor durante este
  teste.
