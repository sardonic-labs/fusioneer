#!/usr/bin/env bash
set -euo pipefail

# bootstrap.sh — install fusioneer into a consumer repo as submodule
# Usage: git submodule add https://github.com/sardonic-labs/fusioneer .opencode/fusioneer && ./.opencode/fusioneer/bootstrap.sh

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
FUSIONEER_DIR=".opencode/fusioneer"
TEMPLATE_DIR="$REPO_ROOT/$FUSIONEER_DIR"

echo ">> fusioneer bootstrap — repo: $REPO_ROOT"

mkdir -p "$REPO_ROOT/.opencode/agents"
mkdir -p "$REPO_ROOT/.github/workflows"

# Copy agent templates if not already present
for agent in issue-tackle pr-review; do
  src="$TEMPLATE_DIR/.opencode/agents/$agent.md"
  dst="$REPO_ROOT/.opencode/agents/$agent.md"
  if [ -f "$src" ] && [ ! -f "$dst" ]; then
    cp "$src" "$dst"
    echo "   copied $agent.md"
  fi
done

# Copy fusioneer.json template
if [ -f "$TEMPLATE_DIR/.opencode/fusioneer.json" ] && [ ! -f "$REPO_ROOT/.opencode/fusioneer.json" ]; then
  cp "$TEMPLATE_DIR/.opencode/fusioneer.json" "$REPO_ROOT/.opencode/fusioneer.json"
  echo "   copied fusioneer.json"
fi

# Copy REVIEW.md
if [ -f "$TEMPLATE_DIR/.opencode/fusioneer/REVIEW.md" ] && [ ! -f "$REPO_ROOT/.opencode/fusioneer/REVIEW.md" ]; then
  mkdir -p "$REPO_ROOT/.opencode/fusioneer"
  cp "$TEMPLATE_DIR/.opencode/fusioneer/REVIEW.md" "$REPO_ROOT/.opencode/fusioneer/REVIEW.md"
  echo "   copied REVIEW.md"
fi

# Ensure GLOBAL_CTX.md
if [ ! -f "$REPO_ROOT/GLOBAL_CTX.md" ] && [ -f "$TEMPLATE_DIR/GLOBAL_CTX.md" ]; then
  cp "$TEMPLATE_DIR/GLOBAL_CTX.md" "$REPO_ROOT/GLOBAL_CTX.md"
  echo "   copied GLOBAL_CTX.md"
fi

# Workflow stub
WORKFLOW_SRC="$TEMPLATE_DIR/.github/workflows/fusioneer.yml"
WORKFLOW_DST="$REPO_ROOT/.github/workflows/fusioneer.yml"
if [ -f "$WORKFLOW_SRC" ] && [ ! -f "$WORKFLOW_DST" ]; then
  cp "$WORKFLOW_SRC" "$WORKFLOW_DST"
  echo "   copied fusioneer.yml workflow"
fi

echo ">> done. Commit: git add .opencode GLOBAL_CTX.md .github/workflows/fusioneer.yml && git commit -m 'chore: install fusioneer agents'"
