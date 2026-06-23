#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# git-setup.sh
# Initialises the local project and links it to the GitHub remote repository.
#
# Usage:
#   chmod +x git-setup.sh
#   ./git-setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e  # Exit immediately on any error

# ── Colours for output ────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Colour

echo ""
echo -e "${GREEN}🚗 Driver Booking Bot — Git Setup${NC}"
echo "─────────────────────────────────────────"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Create .gitignore
# ─────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}📝 Writing .gitignore...${NC}"

cat > .gitignore << 'EOF'
# Environment variables — NEVER commit this
.env

# Node modules
node_modules/

# Logs
logs/
*.log
npm-debug.log*

# OS files
.DS_Store
Thumbs.db

# Editor directories
.idea/
.vscode/
*.swp
*.swo

# Runtime data
pids/
*.pid

# Build output
dist/
build/
EOF

echo -e "${GREEN}✅ .gitignore created${NC}"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Initialise git if not already initialised
# ─────────────────────────────────────────────────────────────────────────────
if [ ! -d ".git" ]; then
  echo -e "${YELLOW}🔧 Initialising git repository...${NC}"
  git init
  echo -e "${GREEN}✅ Git initialised${NC}"
else
  echo -e "${GREEN}✅ Git already initialised — skipping${NC}"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Set default branch to main
# ─────────────────────────────────────────────────────────────────────────────
git checkout -q -b main 2>/dev/null || git checkout -q main 2>/dev/null || true
echo -e "${GREEN}✅ Branch set to main${NC}"

# ─────────────────────────────────────────────────────────────────────────────
# 4. Link to GitHub remote
# ─────────────────────────────────────────────────────────────────────────────
REMOTE_URL="git@github.com:A2MladZ/driver-booking-bot.git"

if git remote get-url origin &>/dev/null; then
  echo -e "${YELLOW}🔄 Remote 'origin' already exists — updating URL...${NC}"
  git remote set-url origin "$REMOTE_URL"
else
  echo -e "${YELLOW}🔗 Adding remote origin...${NC}"
  git remote add origin "$REMOTE_URL"
fi

echo -e "${GREEN}✅ Remote origin set to: ${REMOTE_URL}${NC}"

# ─────────────────────────────────────────────────────────────────────────────
# 5. Stage all files
# ─────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}📦 Staging all files...${NC}"
git add .

# Show what's being committed
echo ""
echo -e "${YELLOW}Files staged for commit:${NC}"
git status --short
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 6. Initial commit
# ─────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}💾 Creating initial commit...${NC}"
git commit -m "feat: initial project setup — WhatsApp Driver Booking Bot

- Express server with graceful shutdown
- WhatsApp Cloud API webhook (verify + receive messages)
- Google Calendar integration (FreeBusy, create, cancel events)
- Natural language date/time parser (chrono-node + dayjs)
- Command intent parser (availability, book, cancel, my bookings)
- Admin REST API for booking management
- Zod-validated environment configuration
- Structured logger (JSON in prod, coloured in dev)
- Global error handling middleware
- Health check endpoint"

echo -e "${GREEN}✅ Initial commit created${NC}"

# ─────────────────────────────────────────────────────────────────────────────
# 7. Push to GitHub
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}🚀 Pushing to GitHub...${NC}"

git push -u origin main

echo ""
echo "─────────────────────────────────────────"
echo -e "${GREEN}🎉 Done! Project is now live on GitHub.${NC}"
echo -e "   👉  https://github.com/A2MladZ/driver-booking-bot"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. cp .env.example .env       ← fill in your credentials"
echo "  2. npm install                ← install dependencies"
echo "  3. npm run dev                ← start the dev server"
echo ""
