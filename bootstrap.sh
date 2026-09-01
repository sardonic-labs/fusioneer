#!/usr/bin/env bash
set -euo pipefail

# bootstrap.sh — install fusioneer into a consumer repo as submodule
# Usage: git submodule add https://github.com/sardonic-labs/fusioneer .opencode/fusioneer && ./.opencode/fusioneer/bootstrap.sh [--update] [--dry-run]

DRY_RUN=false
UPDATE=false
DOMAIN="${FUSIONEER_DOMAIN:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift;;
    --update) UPDATE=true; shift;;
    --domain=*) DOMAIN="${1#--domain=}"; shift;;
    --domain) DOMAIN="${2:-}"; shift 2;;
    *) shift;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TEMPLATE_DIR="$REPO_ROOT/.opencode/fusioneer"

if [ ! -d "$TEMPLATE_DIR/.opencode" ]; then
  # Running inside fusioneer itself (no submodule) — use repo root as template source
  if [ -d "$REPO_ROOT/.opencode/agents" ]; then
    TEMPLATE_DIR="$REPO_ROOT"
  else
    echo "error: $TEMPLATE_DIR not found — run: git submodule add https://github.com/sardonic-labs/fusioneer .opencode/fusioneer" >&2
    exit 2
  fi
fi

# Pin submodule to current fusioneer version (record in consumer repo)
FUSIONEER_REF="$(git -C "$TEMPLATE_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
echo ">> fusioneer bootstrap — repo: $REPO_ROOT (fusioneer@$FUSIONEER_REF) dryRun=$DRY_RUN update=$UPDATE"

copy_if_needed() {
  local src="$1" dst="$2" label="$3"
  if [ ! -f "$src" ]; then return 0; fi
  if [ -f "$dst" ] && [ "$UPDATE" = false ]; then echo "   skip $label (exists, use --update to overwrite)"; return 0; fi
  if [ "$DRY_RUN" = true ]; then echo "   [dry-run] would copy $label -> $dst"; return 0; fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  echo "   copied $label"
}

mkdir -p "$REPO_ROOT/.opencode/agents" "$REPO_ROOT/.github/workflows"

for agent in issue-tackle pr-review; do
  copy_if_needed "$TEMPLATE_DIR/.opencode/agents/$agent.md" "$REPO_ROOT/.opencode/agents/$agent.md" "$agent.md"
done
copy_if_needed "$TEMPLATE_DIR/.opencode/fusioneer.json" "$REPO_ROOT/.opencode/fusioneer.json" "fusioneer.json"
copy_if_needed "$TEMPLATE_DIR/.opencode/fusioneer/REVIEW.md" "$REPO_ROOT/.opencode/fusioneer/REVIEW.md" "REVIEW.md"
if [ ! -f "$REPO_ROOT/GLOBAL_CTX.md" ] || [ "$UPDATE" = true ]; then
  copy_if_needed "$TEMPLATE_DIR/GLOBAL_CTX.md" "$REPO_ROOT/GLOBAL_CTX.md" "GLOBAL_CTX.md"
else
  echo "   skip GLOBAL_CTX.md (exists)"
fi
copy_if_needed "$TEMPLATE_DIR/.github/workflows/fusioneer.yml" "$REPO_ROOT/.github/workflows/fusioneer.yml" "fusioneer.yml"

# Ask where fusioneer is hosted (replaces secrets.FUSIONEER_DOMAIN indirection)
WORKFLOW_DST="$REPO_ROOT/.github/workflows/fusioneer.yml"
if [ -f "$WORKFLOW_DST" ] && [ "$DRY_RUN" = false ]; then
  if [ -z "$DOMAIN" ] && [ -t 0 ]; then
    printf "Where is fusioneer hosted? (e.g. https://fusioneer.example.com) [%s]: " "${DOMAIN:-}" >&2
    read -r INPUT || INPUT=""
    if [ -n "$INPUT" ]; then DOMAIN="$INPUT"; fi
  fi
  if [ -n "$DOMAIN" ]; then
    # Validate basic URL
    if [[ ! "$DOMAIN" =~ ^https:// ]]; then echo "warning: DOMAIN should start with https:// — got '$DOMAIN'" >&2; fi
    # Inline domain into workflow (no secrets leak in logs, no env needed)
    # Replace `secrets.FUSIONEER_DOMAIN` with literal
    tmp="$(mktemp)"
    sed "s|\${{ secrets.FUSIONEER_DOMAIN }}|$DOMAIN|g; s|\${{ secrets.FUSIONEER_DOMAIN:-}}|$DOMAIN|g" "$WORKFLOW_DST" > "$tmp" && mv "$tmp" "$WORKFLOW_DST"
    # Also remove the env indirection: set literal directly so steps don't need secrets
    # Ensure workflow still works if user later prefers secrets — keep fallback
    echo "   set fusioneer domain -> $DOMAIN in fusioneer.yml"
  else
    echo "   note: no domain given — workflow uses \${{ secrets.FUSIONEER_DOMAIN }}. Set via: gh secret set FUSIONEER_DOMAIN --body https://...  or re-run: bootstrap.sh --domain https://..." >&2
  fi
fi

if [ "$DRY_RUN" = true ]; then echo ">> dry-run done (no files written)"; exit 0; fi
echo ">> done (fusioneer@$FUSIONEER_REF). Commit: git add .opencode GLOBAL_CTX.md .github/workflows/fusioneer.yml && git commit -m 'chore: install fusioneer agents'"
