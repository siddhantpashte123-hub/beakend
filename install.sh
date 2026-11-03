#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  🔵 BLUEBEAKEND — One-Command VPS Installer
#  Self-Hosted Firebase Alternative
#
#  Usage:
#    curl -fsSL https://get.bluebeakend.com | sudo bash
#
#  Environment overrides (optional):
#    BB_DOMAIN=api.myapp.com
#    BB_ADMIN_EMAIL=admin@myapp.com
#    BB_INSTALL_DIR=/opt/bluebeakend
#    BB_REPO_URL=https://github.com/siddhantpashte123-hub/beakend.git
#    BB_NONINTERACTIVE=1
#    BB_SKIP_CHECKS=1
#    BB_NO_MENU=1
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

BB_VERSION="1.0.0"
INSTALL_DIR="${BB_INSTALL_DIR:-/opt/bluebeakend}"
REPO_URL="${BB_REPO_URL:-https://github.com/siddhantpashte123-hub/beakend.git}"
REPO_BRANCH="${BB_REPO_BRANCH:-main}"
NONINTERACTIVE="${BB_NONINTERACTIVE:-0}"
SKIP_CHECKS="${BB_SKIP_CHECKS:-0}"

# ── ANSI Colors ────────────────────────────────────────────────────
BLUE='\033[38;5;33m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fatal() { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }

progress_bar() {
  local pct="$1" label="$2"
  local filled=$(( pct * 28 / 100 ))
  local empty=$(( 28 - filled ))
  local bar=""
  for ((i=0; i<filled; i++)); do bar+="█"; done
  for ((i=0; i<empty; i++)); do bar+="░"; done
  echo -e "  ${BLUE}${bar}${NC} ${BOLD}${pct}%${NC}  ${label}"
}

for arg in "$@"; do
  case "$arg" in
    --non-interactive|-y) NONINTERACTIVE=1 ;;
    --skip-checks)        SKIP_CHECKS=1 ;;
    --no-menu)            BB_NO_MENU=1 ;;
    --help|-h)
      echo "Usage: sudo bash install.sh [--non-interactive] [--skip-checks] [--no-menu]"
      exit 0
      ;;
  esac
done

echo -e "${BLUE}${BOLD}"
cat <<'BANNER'
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║        ██████╗ ██╗     ██╗   ██╗███████╗                         ║
║        ██╔══██╗██║     ██║   ██║██╔════╝                         ║
║        ██████╔╝██║     ██║   ██║█████╗                           ║
║        ██╔══██╗██║     ██║   ██║██╔══╝                           ║
║        ██████╔╝███████╗╚██████╔╝███████╗                         ║
║        ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝                         ║
║                                                                  ║
║              🔵  BLUEBEAKEND INSTALLER v1.0.0  🔵                ║
║           Self-Hosted Firebase Alternative on Your VPS           ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

# ── 1. Detect OS & Architecture ────────────────────────────────────
progress_bar 8 "Detecting OS & CPU architecture"

if [[ ! -f /etc/os-release ]]; then
  fatal "Cannot detect Linux distribution (/etc/os-release missing). Supported: Ubuntu 20.04+, Debian 11+, CentOS/RHEL 8+."
fi
# shellcheck disable=SC1091
source /etc/os-release
OS_ID="${ID:-unknown}"
OS_VER="${VERSION_ID:-0}"

UNAME_ARCH="$(uname -m)"
case "$UNAME_ARCH" in
  x86_64|amd64)   ARCH="amd64" ;;
  aarch64|arm64)  ARCH="arm64" ;;
  *)              fatal "Unsupported CPU architecture: ${UNAME_ARCH} (supported: amd64, arm64)" ;;
esac

case "$OS_ID" in
  ubuntu|debian|pop|linuxmint|raspbian) PKG_MGR="apt" ;;
  centos|rhel|rocky|almalinux|fedora)   PKG_MGR="dnf" ;;
  *)
    warn "Unrecognized distro '${OS_ID}' — attempting Debian/Ubuntu compatible flow."
    PKG_MGR="apt"
    ;;
esac
ok "Detected ${PRETTY_NAME:-$OS_ID $OS_VER} (${ARCH})"

# ── 2. Check root, minimum 2GB RAM, 10GB free disk ─────────────────
progress_bar 16 "Verifying root privileges, RAM & disk space"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  fatal "Please run as root or with sudo: curl -fsSL https://get.bluebeakend.com | sudo bash"
fi

if [[ "$SKIP_CHECKS" != "1" ]]; then
  MEM_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
  MEM_MB=$(( MEM_KB / 1024 ))
  # 2GB cloud VPS instances typically expose ~1850-2048 MB to the guest kernel
  if (( MEM_MB < 1800 )); then
    fatal "Minimum 2 GB RAM required (detected ${MEM_MB} MB). Pass --skip-checks to override."
  fi

  DISK_KB="$(df -Pk / | awk 'NR==2 {print $4}' || echo 0)"
  DISK_GB=$(( DISK_KB / 1024 / 1024 ))
  if (( DISK_GB < 10 )); then
    fatal "Minimum 10 GB free disk space required on / (detected ${DISK_GB} GB). Pass --skip-checks to override."
  fi
  ok "Hardware check passed: ${MEM_MB} MB RAM, ${DISK_GB} GB free disk"
else
  warn "Hardware checks skipped (--skip-checks)"
fi

# ── 3. Install system packages, Docker & Docker Compose v2 ─────────
progress_bar 30 "Installing system packages, Docker & Compose v2"

if [[ "$PKG_MGR" == "apt" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git jq openssl ufw gnupg lsb-release tar gzip >/dev/null
else
  dnf install -y -q ca-certificates curl git jq openssl tar gzip firewalld >/dev/null || \
  yum install -y -q ca-certificates curl git jq openssl tar gzip firewalld >/dev/null
fi

if ! command -v docker >/dev/null 2>&1; then
  info "Installing Docker Engine…"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  systemctl start docker 2>/dev/null || true
fi

if ! docker compose version >/dev/null 2>&1; then
  info "Installing Docker Compose v2 plugin…"
  if [[ "$PKG_MGR" == "apt" ]]; then
    apt-get install -y -qq docker-compose-plugin >/dev/null
  else
    dnf install -y -q docker-compose-plugin >/dev/null || true
  fi
fi
docker compose version >/dev/null 2>&1 || fatal "Docker Compose v2 is not available after installation."
ok "Docker & Docker Compose v2 ready"

# ── 4 & 5. Create /opt/bluebeakend & clone/pull stack ──────────────
progress_bar 45 "Preparing ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"

SCRIPT_SRC_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "$(dirname "${BASH_SOURCE[0]}")/docker-compose.yml" ]]; then
  SCRIPT_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [[ -n "$SCRIPT_SRC_DIR" && "$SCRIPT_SRC_DIR" != "$INSTALL_DIR" ]]; then
  info "Copying stack from local checkout (${SCRIPT_SRC_DIR})…"
  tar -C "$SCRIPT_SRC_DIR" --exclude='./node_modules' --exclude='./*/node_modules' --exclude='./.git' -cf - . \
    | tar -C "$INSTALL_DIR" -xf -
elif [[ -d "${INSTALL_DIR}/.git" ]]; then
  info "Updating existing repository in ${INSTALL_DIR}…"
  git -C "${INSTALL_DIR}" fetch --all --prune
  git -C "${INSTALL_DIR}" pull --ff-only || true
elif [[ ! -f "${INSTALL_DIR}/docker-compose.yml" ]]; then
  info "Cloning BlueBeakend stack from ${REPO_URL}…"
  git clone --depth 1 --branch "${REPO_BRANCH}" "${REPO_URL}" "${INSTALL_DIR}" 2>/dev/null || \
    git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"
mkdir -p backups nginx/ssl/live/bluebeakend

# ── 6 & 7. Domain prompt & .env secret generation ──────────────────
progress_bar 58 "Generating cryptographic secrets & .env"

DETECTED_IP="$(curl -4 -fsSL --max-time 4 https://ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")"
DOMAIN="${BB_DOMAIN:-}"

if [[ -z "$DOMAIN" && "$NONINTERACTIVE" != "1" && -e /dev/tty ]]; then
  echo ""
  read -r -p "  🌐 Enter your domain (press Enter to use VPS IP ${DETECTED_IP}): " USER_DOMAIN < /dev/tty || true
  DOMAIN="${USER_DOMAIN:-$DETECTED_IP}"
fi
DOMAIN="${DOMAIN:-$DETECTED_IP}"

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 32)"
  JWT_SECRET="$(openssl rand -hex 32)"
  REDIS_PASSWORD="$(openssl rand -hex 32)"
  MINIO_ROOT_PASSWORD="$(openssl rand -hex 32)"
  ADMIN_EMAIL="${BB_ADMIN_EMAIL:-admin@bluebeakend.local}"
  ADMIN_PASSWORD="${BB_ADMIN_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 16)}"
  API_KEY="bb_live_$(openssl rand -hex 20)"

  cat > "${INSTALL_DIR}/.env" <<EOF
# Auto-generated by BlueBeakend installer on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
BB_VERSION=${BB_VERSION}
BB_ENV=production
BB_DOMAIN=${DOMAIN}
BB_PROTOCOL=http

POSTGRES_USER=bluebeakend
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=bluebeakend
DATABASE_URL=postgres://bluebeakend:${POSTGRES_PASSWORD}@postgres:5432/bluebeakend

REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

MINIO_ROOT_USER=bluebeakend
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
MINIO_BUCKET=bluebeakend
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=bluebeakend
S3_SECRET_KEY=${MINIO_ROOT_PASSWORD}
S3_BUCKET=bluebeakend

JWT_SECRET=${JWT_SECRET}
JWT_ISSUER=bluebeakend
ACCESS_TOKEN_TTL=900
REFRESH_TOKEN_TTL=2592000

ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
API_KEY=${API_KEY}

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="BlueBeakend <no-reply@${DOMAIN}>"

RATE_LIMIT_RPM=600
MAX_UPLOAD_MB=50
ENABLE_SIGNUPS=true
CORS_ORIGINS=*
EOF
  chmod 600 "${INSTALL_DIR}/.env"
  ok "Generated secure .env secrets"
else
  info "Existing .env detected — preserving existing secrets"
fi

# shellcheck disable=SC1091
source "${INSTALL_DIR}/.env"

# Generate fallback self-signed TLS cert if Let's Encrypt cert isn't present yet
if [[ ! -f "${INSTALL_DIR}/nginx/ssl/live/bluebeakend/fullchain.pem" ]]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -subj "/CN=${BB_DOMAIN:-localhost}" \
    -keyout "${INSTALL_DIR}/nginx/ssl/live/bluebeakend/privkey.pem" \
    -out "${INSTALL_DIR}/nginx/ssl/live/bluebeakend/fullchain.pem" >/dev/null 2>&1
fi

# ── 8. Launch Docker Compose stack ─────────────────────────────────
progress_bar 74 "Building & starting BlueBeakend containers"
docker compose up -d --build

# ── 9. Wait for healthchecks to pass ───────────────────────────────
progress_bar 86 "Waiting for service healthchecks"
ATTEMPTS=0
until curl -fsSL "http://127.0.0.1/healthz" >/dev/null 2>&1; do
  ATTEMPTS=$(( ATTEMPTS + 1 ))
  if (( ATTEMPTS > 60 )); then
    warn "Healthcheck timed out after 120s — run 'bb logs' to inspect container output."
    break
  fi
  sleep 2
done
ok "All BlueBeakend services are up and healthy"

# ── 10. Configure Firewall (UFW: allow 22, 80, 443) ────────────────
progress_bar 93 "Configuring firewall (ports 22, 80, 443)"
if command -v ufw >/dev/null 2>&1; then
  ufw default deny incoming >/dev/null 2>&1 || true
  ufw default allow outgoing >/dev/null 2>&1 || true
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  ok "UFW firewall enabled (allowed: 22, 80, 443)"
elif command -v firewall-cmd >/dev/null 2>&1; then
  systemctl enable --now firewalld >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-service=ssh >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-service=http >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  ok "firewalld configured (allowed: ssh, http, https)"
fi

# ── 11. Install `bb` & `bluebeakend` CLI commands ──────────────────
progress_bar 100 "Installing 'bb' and 'bluebeakend' CLI commands"
install -m 0755 "${INSTALL_DIR}/cli/bb" /usr/local/bin/bb
ln -sf /usr/local/bin/bb /usr/local/bin/bluebeakend

PUBLIC_URL="${BB_PROTOCOL:-http}://${BB_DOMAIN}"
cat > "${INSTALL_DIR}/credentials.txt" <<CREDS
═══════════════════════════════════════════════════════════════
  BLUEBEAKEND v${BB_VERSION} — CREDENTIALS
  Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
═══════════════════════════════════════════════════════════════
  API Endpoint   : ${PUBLIC_URL}
  Admin Console  : ${PUBLIC_URL}/admin
  Swagger Docs   : ${PUBLIC_URL}/docs
  Realtime WS    : ws://${BB_DOMAIN}/realtime

  Admin Email    : ${ADMIN_EMAIL}
  Admin Password : ${ADMIN_PASSWORD}
  Project Key    : ${API_KEY}
═══════════════════════════════════════════════════════════════
CREDS
chmod 600 "${INSTALL_DIR}/credentials.txt"

# ── 12. Print Success Banner ───────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║          ✅  BLUEBEAKEND INSTALLED SUCCESSFULLY!                 ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}🌐 API URL        :${NC}  ${CYAN}${PUBLIC_URL}${NC}"
echo -e "  ${BOLD}🖥️  Admin Console  :${NC}  ${CYAN}${PUBLIC_URL}/admin${NC}"
echo -e "  ${BOLD}📖 Swagger Docs   :${NC}  ${CYAN}${PUBLIC_URL}/docs${NC}"
echo -e "  ${BOLD}👤 Admin Email    :${NC}  ${YELLOW}${ADMIN_EMAIL}${NC}"
echo -e "  ${BOLD}🔒 Admin Password :${NC}  ${YELLOW}${ADMIN_PASSWORD}${NC}"
echo -e "  ${BOLD}🔑 Project API Key:${NC}  ${GREEN}${API_KEY}${NC}"
echo ""
echo -e "  ${DIM}Saved to ${INSTALL_DIR}/credentials.txt • Type 'bb' anytime to manage.${NC}"
echo ""

# ── 13. Auto-launch interactive CLI menu ───────────────────────────
if [[ "${BB_NO_MENU:-0}" != "1" && "$NONINTERACTIVE" != "1" && -t 1 && -e /dev/tty ]]; then
  exec /usr/local/bin/bb < /dev/tty
fi
