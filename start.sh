#!/bin/bash
# start.sh

# cd to the directory of the script
cd "$(dirname "$0")"

echo "Checking prerequisites..."

# Check for Node.js
if ! command -v node &>/dev/null; then
  echo "Node.js is not installed. Please install from https://nodejs.org"
  exit 1
fi

echo "Found Node.js: $(node --version)"

# Check for Python (python3 or python)
if command -v python3 &>/dev/null; then
  PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
  PYTHON_CMD="python"
else
  echo "Python is not installed. Please install from https://python.org"
  exit 1
fi

echo "Found Python: $($PYTHON_CMD --version)"

# Check for git
if ! command -v git &>/dev/null; then
  echo "git is not installed. Please install git"
  exit 1
fi

echo "Found git: $(git --version)"

# Check for Bun
if ! command -v bun &>/dev/null; then
  echo "Bun is not installed. Installing..."
  # Check for bun's dependencies
  if ! command -v unzip &>/dev/null; then
    echo "unzip is not installed. Please install unzip"
    exit 1
  fi
  curl -fsSL https://bun.sh/install | bash
  if [ $? -ne 0 ]; then
    echo "Failed to install Bun"
    exit 1
  fi
  source ~/.bashrc
fi

echo "Found Bun: $(bun --version)"

# Install dependencies
echo "Installing dependencies..."
bun install
if [ $? -ne 0 ]; then
  echo "Failed to install dependencies"
  exit 1
fi

echo "Dependencies installed successfully"

# Start pinger with arguments or default to 1.1.1.1
echo "Starting pinger..."
if [ $# -eq 0 ]; then
  bun run src/index.ts 1.1.1.1
else
  bun run src/index.ts "$@"
fi
