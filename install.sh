#!/usr/bin/env bash
set -euo pipefail
# install.sh — one-liner VPS + per-repo installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/sardonic-labs/fusioneer/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/sardonic-labs/fusioneer/main/install.sh | bash -s -- --domain https://fusioneer.example.com --vps
#   bunx fusioneer init --domain https://fusioneer.example.com  # per-repo alternative (no curl)

DOMAIN=""
VPS=false
while [ $# -gt 0 ]; do case "$1" in --domain=*) DOMAIN="${1#--domain=}"; shift;; --domain) DOMAIN="${2:-}"; shift 2;; --vps) VPS=true; shift;; *) shift;; esac; done
if [ -z "$DOMAIN" ] && [ -n "${FUSIONEER_DOMAIN:-}" ]; then DOMAIN="$FUSIONEER_DOMAIN"; fi
if [ -z "$DOMAIN" ] && [ -t 0 ]; then printf "Where is fusioneer hosted? (https://fusioneer.example.com): " >&2; read -r DOMAIN || true; fi

if [ "$VPS" = true ] || [ ! -f "./.opencode/fusioneer.json" ]; then
  # Detect context: inside fusioneer repo (VPS) vs consumer repo (per-repo)
  if [ -f "./docker-compose.yml" ] && [ -f "./.env.example" ]; then
    echo ">> VPS setup"
    if [ ! -f .env ]; then cp .env.example .env; echo "   created .env from .env.example — edit tokens"; fi
    if [ -n "$DOMAIN" ]; then
      if grep -q "FUSIONEER_DOMAIN" .env; then sed -i "s|FUSIONEER_DOMAIN=.*|FUSIONEER_DOMAIN=$DOMAIN|" .env; else echo "FUSIONEER_DOMAIN=$DOMAIN" >> .env; fi
      echo "   set FUSIONEER_DOMAIN=$DOMAIN in .env"
    fi
    echo "   next: edit .env (ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET=\$(openssl rand -hex 32), FUSIONEER_DASHBOARD_TOKEN=\$(openssl rand -hex 32))"
    echo "   then: docker compose up -d && curl http://localhost:3000/health"
    exit 0
  fi
fi

# Per-repo path
echo ">> per-repo install"
if [ ! -d .git ]; then echo "error: not a git repo (run inside your repo)" >&2; exit 2; fi
if [ ! -d .opencode/fusioneer ]; then
  echo "   adding submodule sardonic-labs/fusioneer -> .opencode/fusioneer"
  git submodule add https://github.com/sardonic-labs/fusioneer .opencode/fusioneer
fi
if [ -n "$DOMAIN" ]; then bash .opencode/fusioneer/bootstrap.sh --domain "$DOMAIN"
else bash .opencode/fusioneer/bootstrap.sh; fi
echo ">> done — git add .opencode GLOBAL_CTX.md .github/workflows/fusioneer.yml && git commit -m 'chore: install fusioneer agents'"
if command -v gh >/dev/null 2>&1 && [ -n "$DOMAIN" ] && [ -t 0 ]; then
  printf "Set GitHub secret FUSIONEER_DOMAIN now via gh? [y/N]: " >&2; read -r ANS || true
  if [[ "$ANS" =~ ^[Yy] ]]; then gh secret set FUSIONEER_DOMAIN --body "$DOMAIN" && echo "   gh secret set ✓"; fi
fi
