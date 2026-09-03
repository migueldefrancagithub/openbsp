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
