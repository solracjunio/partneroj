#!/usr/bin/env bash
# Deploys a commit of main to the VPS (docs/operacao.md):
#   infra/production/deploy.sh            # what is on origin/main now
#   infra/production/deploy.sh <commit>   # a given commit, e.g. to go back
# Runs from your computer; the server builds the images itself.
set -euo pipefail

host="partneroj"
dir="partneroj"
repo="https://github.com/solracjunio/partneroj.git"
ref="${1:-origin/main}"

ssh "$host" bash -s -- "$dir" "$repo" "$ref" <<'REMOTE'
set -euo pipefail
dir="$1" repo="$2" ref="$3"

[ -d "$dir/.git" ] || git clone --quiet "$repo" "$dir"
cd "$dir"
git fetch --quiet origin
git checkout --quiet --detach "$ref"
echo "deploying $(git log -1 --format='%h %s')"

if [ ! -f infra/production/.env ]; then
  echo "missing ~/$dir/infra/production/.env (see .env.example)" >&2
  exit 1
fi

# --wait: returns only when the API is healthy, or fails if the migrate
# step or a health check fails. The previous containers keep running
# until their replacements are built.
docker compose -f infra/production/compose.yml up --detach --build \
  --wait --wait-timeout 300 --remove-orphans
docker image prune --force >/dev/null
docker compose -f infra/production/compose.yml ps
REMOTE
