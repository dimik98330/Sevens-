#!/usr/bin/env bash
# One-command demo setup (07 section 1). Never overwrites an existing .env
# or existing data. Not a substitute for HTTPS/access control on a public host.
set -euo pipefail

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail 'docker is required'
docker compose version >/dev/null 2>&1 || fail 'docker compose is required'

if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || fail '.env.example is missing'
  cp .env.example .env
  if command -v openssl >/dev/null 2>&1; then
    demo_password="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 32)"
  else
    demo_password="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
  fi
  pg_password="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
  # Portable in-place secret injection without sed -i flavors. Generated
  # passwords are alphanumeric, so the derived DATABASE_URL needs no escaping.
  # The app reads ONLY DATABASE_URL (07 section 4); derive it here so the
  # readiness wait below can succeed.
  python3 - "$demo_password" "$pg_password" <<'EOF'
import sys
from pathlib import Path
demo_password, pg_password = sys.argv[1], sys.argv[2]
path = Path('.env')
values = {}
for line in path.read_text(encoding='utf-8').splitlines():
    if '=' in line and not line.startswith('#'):
        key, _, value = line.partition('=')
        values[key.strip()] = value.strip()
values['DEMO_PASSWORD'] = values.get('DEMO_PASSWORD') or demo_password
values['POSTGRES_PASSWORD'] = values.get('POSTGRES_PASSWORD') or pg_password
user = values.get('POSTGRES_USER', 'abai_app')
db = values.get('POSTGRES_DB', 'abai')
values['DATABASE_URL'] = f'postgresql://{user}:{values["POSTGRES_PASSWORD"]}@db:5432/{db}'
lines = []
seen = set()
for line in path.read_text(encoding='utf-8').splitlines():
    if '=' in line and not line.startswith('#'):
        key, _, _ = line.partition('=')
        key = key.strip()
        if key in values:
            lines.append(f'{key}={values[key]}')
            seen.add(key)
            continue
    lines.append(line)
for key in ('DATABASE_URL', 'DEMO_PASSWORD', 'POSTGRES_PASSWORD'):
    if key not in seen:
        lines.append(f'{key}={values[key]}')
path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
EOF
  printf 'Created .env with generated DEMO_PASSWORD, POSTGRES_PASSWORD and derived DATABASE_URL.\n'
fi

docker compose up --build -d
docker compose ps

app_port="$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
app_port="${app_port:-3000}"
printf 'Waiting for readiness...\n'
for _ in $(seq 1 30); do
  if curl --fail --silent "http://localhost:${app_port}/api/health/ready" >/dev/null 2>&1; then
    printf 'Ready: http://localhost:%s/\n' "$app_port"
    printf 'Demo accounts (synthetic, from docs/fixtures/demo-seed.json; passwords only in your local .env):\n'
    python3 - <<'EOF'
import json
try:
    fixture = json.load(open('docs/fixtures/demo-seed.json', encoding='utf-8'))
    for u in fixture.get('users', []):
        print(f"- {u.get('displayName')} [{u.get('role')}] <{u.get('email')}>")
except OSError as exc:
    print(f'(could not list demo accounts: {exc})')
EOF
    printf 'Prototype notice: routes and agency cabinets are demonstrational; nothing is sent to official state systems.\n'
    exit 0
  fi
  sleep 5
done
fail 'App did not become ready; inspect with: docker compose logs --tail=100 init api app'
