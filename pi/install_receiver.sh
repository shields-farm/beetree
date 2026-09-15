#!/bin/bash
# Install the Mentra Live photo receiver on a Raspberry Pi (Zero W or newer).
#
# Idempotent: safe to re-run to update the script or the unit file.
#
#   sudo bash pi/install_receiver.sh --beetree-url https://your-host.your-tailnet.ts.net:8443 \
#                                    --beetree-key <KEY> --upload-token <TOKEN>
#
# Deliberately does NOT enable or start the service — bring it up yourself after
# checking the credentials landed correctly.
set -euo pipefail

BEETREE_URL=""
BEETREE_KEY=""
UPLOAD_TOKEN=""
PORT=8790
STATE_DIR=/var/lib/mentra
INSTALL_DIR=/opt/mentra
ENV_FILE=/etc/mentra-receiver.env
RUN_USER="${SUDO_USER:-mark}"

while [ $# -gt 0 ]; do
  case "$1" in
    --beetree-url)  BEETREE_URL="$2"; shift 2 ;;
    --beetree-key)  BEETREE_KEY="$2"; shift 2 ;;
    --upload-token) UPLOAD_TOKEN="$2"; shift 2 ;;
    --port)         PORT="$2"; shift 2 ;;
    --state-dir)    STATE_DIR="$2"; shift 2 ;;
    --user)         RUN_USER="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root (use sudo)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/mentra_receiver.py" ] || { echo "mentra_receiver.py not found next to this script" >&2; exit 1; }

# Port 8787 is taken by Hermes on some hosts; check before installing into a
# collision that would silently shadow one service with another.
if command -v ss >/dev/null 2>&1 && ss -tln 2>/dev/null | grep -q ":$PORT "; then
  echo "WARNING: something is already listening on port $PORT"
  ss -tln | grep ":$PORT " || true
fi

echo "==> user:   $RUN_USER"
echo "==> port:   $PORT"
echo "==> state:  $STATE_DIR"
echo "==> beetree $BEETREE_URL"

install -d -m 0755 "$INSTALL_DIR"
install -m 0755 "$SCRIPT_DIR/mentra_receiver.py" "$INSTALL_DIR/mentra_receiver.py"
install -m 0644 "$SCRIPT_DIR/mentra-receiver.service" /etc/systemd/system/mentra-receiver.service

install -d -m 0700 -o "$RUN_USER" -g "$RUN_USER" "$STATE_DIR"
install -d -m 0700 -o "$RUN_USER" -g "$RUN_USER" "$STATE_DIR/uploads"
install -d -m 0700 -o "$RUN_USER" -g "$RUN_USER" "$STATE_DIR/forwarded"
install -d -m 0700 -o "$RUN_USER" -g "$RUN_USER" "$STATE_DIR/spool"

# Credentials file: 0600, root-owned but read by systemd before dropping to
# RUN_USER. Keeps the token out of the unit file and out of `ps`.
umask 077
cat > "$ENV_FILE" <<EOF
# Mentra Live photo receiver — credentials. Do not commit.
BEETREE_URL=$BEETREE_URL
BEETREE_API_KEY=$BEETREE_KEY
MENTRA_UPLOAD_TOKEN=$UPLOAD_TOKEN
EOF
chmod 0600 "$ENV_FILE"
chown root:root "$ENV_FILE"

# Point the unit at the chosen port/state dir without editing the shipped file.
sed -i "s#--port 8790#--port $PORT#; s#--state-dir /var/lib/mentra#--state-dir $STATE_DIR#" \
  /etc/systemd/system/mentra-receiver.service

systemctl daemon-reload

# Smoke-test the script itself before it runs under systemd.
if python3 -c "import ast,sys; ast.parse(open('$INSTALL_DIR/mentra_receiver.py').read())"; then
  echo "==> syntax OK"
else
  echo "syntax check FAILED" >&2
  exit 1
fi

cat <<EOF

Installed. Not started yet — verify, then enable:

  sudo systemctl start mentra-receiver
  curl -s http://localhost:$PORT/health | python3 -m json.tool
  sudo journalctl -u mentra-receiver -f

The glasses' webhook URL is:

  http://<pi-lan-ip>:$PORT/upload

Point Mentra's requestPhoto({ webhookUrl }) at that, with authToken set to
MENTRA_UPLOAD_TOKEN. If the Pi is on the tailnet, a Tailscale name works too.
EOF
