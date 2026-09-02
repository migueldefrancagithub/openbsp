# Release — Fases A + B (PR #19 → PR #20)

Ordem obrigatória: **Convex primeiro, Vercel depois.** O Vercel constrói o Next a partir
de `main` automaticamente; se `main` receber a UI antes de `npx convex deploy`, a app
chama funções que ainda não existem em produção (o erro "Could not find public
function" do incidente inicial). Nunca colar tokens, IDs completos de canal, números
completos ou payloads reais em issues, commits ou respostas.

## 0. Pré-condições
```bash
cd app
npm ci
npm run typecheck && npm run check:errors && npx vitest run && npm run build
node scripts/predeploy-check.mjs
```
Os PRs devem estar `CLEAN` no GitHub: #19 (Fase A, base `main`) e #20 (Fase B, base = branch
da Fase A). Depois do merge de #19, o #20 passa a apontar para `main` automaticamente
(GitHub re-baseia PRs empilhados); se não passar, `gh pr edit 20 --base main`.

## 1. Deploy Convex (produção) — a partir da branch já consolidada
```bash
# na worktree/branch que contém A + B (claude/openbsp-phase-c contém ambas)
cd app
CONVEX_DEPLOYMENT=prod:effervescent-butterfly-531 npx convex deploy --yes
```
O schema só expande (tabelas novas: threadSystemEvents, customFieldDefinitions,
opsAlerts, trackedLinks, clinicProfessionals, clinicSettings, presence,
assignmentRules, analyticsDailyRollups; campos/índices novos). Sem contracção, sem
apagar histórico.

## 2. Backfills (idempotentes, paginados; correr uma vez, por esta ordem)
```bash
CONVEX_DEPLOYMENT=prod:effervescent-butterfly-531 npx convex run leads:_backfillLeadStatus '{}'
CONVEX_DEPLOYMENT=prod:effervescent-butterfly-531 npx convex run leads:_backfillOrigin '{}'
CONVEX_DEPLOYMENT=prod:effervescent-butterfly-531 npx convex run clinic:_backfillOpenHumanCases '{}'
CONVEX_DEPLOYMENT=prod:effervescent-butterfly-531 npx convex run analyticsRollups:backfill '{"days": 30}'
```
Cada um auto-reagenda as páginas seguintes em background; repetir é seguro.

## 3. Merge dos PRs e deploy Vercel
```bash
gh pr ready 19 && gh pr merge 19 --merge
gh pr ready 20 && gh pr merge 20 --merge     # confirmar antes que a base é main
```
O Vercel constrói `main`. Confirmar em https://openbsp-ashy.vercel.app que a app abre.

## 4. Smoke em produção
- `app/scripts/smoke-phase-a.md` (15 passos) e `app/scripts/smoke-phase-b.md` (B1–B8).
- Antes do primeiro envio automático: adicionar o número de teste à allowlist do
  piloto em Definições › Canais e confirmar `sendMode: allowlist`.
- Verificar crons no dashboard Convex: follow-up executor (1 min), sweeps (5–10 min),
  rollups (1 h), retenção (diário).

## 5. Rollback
- Convex: `npx convex deploy` da `main` anterior (00744e6) **não** remove tabelas nem
  dados; as funções novas deixam de existir e a UI antiga volta a funcionar.
- Vercel: "Promote" do deployment anterior.
