#!/usr/bin/env bash
# Saves your Claude API key into app/.env.local without showing it on screen.
set -euo pipefail
cd "$(dirname "$0")/.."
read -rsp "Paste your Claude API key, then press Enter (it won't be shown): " KEY; echo
if [[ -z "$KEY" ]]; then echo "No key entered, nothing changed."; exit 1; fi
touch .env.local
grep -v '^ANTHROPIC_API_KEY=' .env.local > .env.local.tmp || true
echo "ANTHROPIC_API_KEY=$KEY" >> .env.local.tmp
mv .env.local.tmp .env.local
chmod 600 .env.local
echo "Saved. Tell Claude it's done."
