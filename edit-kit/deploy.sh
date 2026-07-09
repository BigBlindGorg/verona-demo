#!/usr/bin/env bash
# Build + commit + push to GitHub + deploy to Netlify.
# Usage: ./edit-kit/deploy.sh "what you changed"
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:-content update}"

python3 edit-kit/build.py

git add -A
git commit -m "$MSG" || echo "(nothing new to commit)"
git push origin main

# grep doubles as the success check: "Deploy is live" is printed on every successful deploy
if npx --yes netlify-cli@latest deploy --dir . --prod \
    --site 81a1a4e4-9143-4b28-9d35-9396cc9fcfb3 --message "$MSG" 2>&1 |
    grep -E "Deploy is live|Production URL"; then
  echo "done -> https://verona-demo.netlify.app  (hard-refresh: Cmd+Shift+R)"
else
  echo "NETLIFY DEPLOY FAILED — changes are on GitHub but NOT live. Re-run: ./edit-kit/deploy.sh" >&2
  exit 1
fi
