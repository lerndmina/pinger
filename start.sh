#!/bin/bash
# start.sh

echo "Checking prerequisites..."

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo "Node.js is not installed. Please install from https://nodejs.org"
  exit 1
fi

# Check for Python
if ! command -v python &>/dev/null; then
  echo "Python is not installed. Please install from https://python.org"
  exit 1
fi

# Check for Bun
if ! command -v bun &>/dev/null; then
  echo "Bun is not installed. Installing..."
  curl -fsSL https://bun.sh/install | bash
  if [ $? -ne 0 ]; then
    echo "Failed to install Bun"
    exit 1
  fi
  source ~/.bashrc
fi

# Install dependencies
echo "Installing dependencies..."
bun install
if [ $? -ne 0 ]; then
  echo "Failed to install dependencies"
  exit 1
fi

# Start pinger
echo "Starting pinger..."
bun run src/index.ts 1.1.1.1
