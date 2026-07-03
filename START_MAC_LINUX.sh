#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "============================================"
echo "SEO AEO GEO Live Checker"
echo "============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node.js LTS from https://nodejs.org/ and run this file again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Reinstall Node.js LTS from https://nodejs.org/."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing required files. This may take a minute on the first run..."
  npm install
fi

echo
echo "Starting the tool..."
echo "Open http://localhost:3000 in your browser."
echo "Keep this terminal open while you use the tool."
echo

if command -v open >/dev/null 2>&1; then
  open http://localhost:3000 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open http://localhost:3000 || true
fi

npm start
