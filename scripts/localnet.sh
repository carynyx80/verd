#!/usr/bin/env bash
# Starts a fresh local Solana validator with the Stewra program preloaded,
# then creates the platform config (2% raise fee, 1% swap fee, no minimum lockup).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
PROGRAM_ID=$(solana-keygen pubkey target/deploy/verd-keypair.json)
[ -f target/deploy/verd.so ] || anchor build
solana-test-validator --reset --quiet --ledger .anchor/dev-ledger \
  --bpf-program "$PROGRAM_ID" target/deploy/verd.so &
VALIDATOR=$!
trap 'kill $VALIDATOR' EXIT
until solana cluster-version -u localhost >/dev/null 2>&1; do sleep 1; done
echo "Validator up. Program: $PROGRAM_ID"
node scripts/init-config.mjs --rpc http://127.0.0.1:8899
echo "Fund a wallet with:  solana airdrop 50 <ADDRESS> -u localhost"
wait $VALIDATOR
