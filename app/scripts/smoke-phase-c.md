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
