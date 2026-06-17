#!/bin/bash
set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== MiniMax2API Docker Entrypoint ===${NC}"

# Check if config.json exists
if [ ! -f "/app/config.json" ]; then
    echo -e "${RED}ERROR: config.json not found!${NC}"
    echo -e "${YELLOW}Mount it with: -v ./config.json:/app/config.json${NC}"
    echo ""
    echo "Example:"
    echo "  docker run -v ./config.json:/app/config.json minimax2api"
    exit 1
fi

# Validate config.json
if ! python3 -c "import json; json.load(open('/app/config.json'))" 2>/dev/null; then
    echo -e "${RED}ERROR: config.json is not valid JSON!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ config.json found and valid${NC}"

# Set Puppeteer Chrome path
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
export PUPPETEER_SKIP_DOWNLOAD=true

# Show configuration
echo -e "${GREEN}Environment:${NC}"
echo "  PUPPETEER_EXECUTABLE_PATH: ${PUPPETEER_EXECUTABLE_PATH}"
echo "  PORT: ${PORT:-8000}"
echo "  LAZY_PORT: ${LAZY_PORT:-5005}"

echo -e "${GREEN}Starting service...${NC}"
echo ""

# Execute the command passed to the container
exec "$@"
