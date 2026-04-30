#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Users/erikomatsuoka/cursorprojects/Your Memory"

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "Project directory not found: $ROOT_DIR"
  exit 1
fi

cd "$ROOT_DIR"

if [[ -z "${1:-}" ]]; then
  echo "Usage: ./deploy-firebase.sh <RAILWAY_API_URL>"
  echo "Example: ./deploy-firebase.sh https://your-memory-api-production.up.railway.app"
  exit 1
fi

RAILWAY_API_URL="$1"

cat > "frontend/.env.production" <<EOF
VITE_API_URL=$RAILWAY_API_URL
EOF

echo "Wrote frontend/.env.production with VITE_API_URL=$RAILWAY_API_URL"
echo "Next steps:"
echo "  1) firebase login --reauth   (if needed)"
echo "  2) firebase use --add        (first time only)"
echo "  3) npm --prefix frontend run build"
echo "  4) firebase deploy --only hosting"
