#!/usr/bin/env bash
# Release consolidado (Fases A+B+C) — correr a partir da raiz do repositório.
# Ordem: Convex prod → backfills → merge do PR (Vercel constrói main).
set -euo pipefail
PROD="prod:effervescent-butterfly-531"
PR="${PR:-21}"
cd "$(dirname "$0")/.."
CONVEX_DEPLOYMENT="$PROD" npx convex deploy --yes
for fn in leads:_backfillLeadStatus leads:_backfillOrigin clinic:_backfillOpenHumanCases; do
  CONVEX_DEPLOYMENT="$PROD" npx convex run "$fn" '{}'
done
CONVEX_DEPLOYMENT="$PROD" npx convex run analyticsRollups:backfill '{"days": 30}'
CONVEX_DEPLOYMENT="$PROD" npx convex function-spec | grep -c '"aiRuntime:claimTurn"' >/dev/null && echo "prod has aiRuntime:claimTurn ✔"
gh pr merge "$PR" --merge --delete-branch=false
echo "Merged PR #$PR — Vercel builds main. Next: smoke-phase-a/b/c.md and 'npx convex env set ANTHROPIC_API_KEY …' (or a clinic key in Settings › AI)."
