#!/usr/bin/env bash
set -euo pipefail
umask 077

app="${1:?Application is required}"
release="${2:?Release is required}"
port="${3:?Port is required}"
health_path="${4:?Health path is required}"
[[ "$app" =~ ^[a-z][a-z0-9-]*$ ]]
[[ "$release" =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]]
[[ "$port" =~ ^[0-9]+$ ]] && (( port > 0 && port < 65536 ))
[[ "$health_path" =~ ^/[a-zA-Z0-9/_-]+$ ]]

root="/srv/$app"
incoming="$root/incoming/$release"
destination="$root/releases/$release"
exec 9>"$root/deploy.lock"
flock -n 9

previous=''
if [[ -L "$root/current" ]]; then
  previous="$(readlink -f "$root/current")"
  test -d "$previous"
elif [[ -e "$root/current" ]]; then
  echo "$root/current must be a release symlink." >&2
  exit 1
fi
activated=false

start_app() {
  local release_path="$1"
  local exists
  exists="$(pm2 jlist | node -e '
    let s="";process.stdin.on("data",d=>s+=d);
    process.stdin.on("end",()=>console.log(JSON.parse(s).some(p=>p.name===process.argv[1])));
  ' "$app")" || return
  if [[ "$exists" == true ]]; then
    pm2 delete "$app" || return
  fi
  pm2 start "$release_path/ecosystem.config.cjs" --only "$app"
}

health_check() {
  local expected_release="$1"
  local attempt
  for attempt in {1..30}; do
    if pm2 jlist | node -e '
      let s="";process.stdin.on("data",d=>s+=d);
      process.stdin.on("end",()=>process.exit(JSON.parse(s).some(
        p=>p.name===process.argv[1]&&p.pm2_env.status==="online"&&
          p.pm2_env.pm_cwd===process.argv[2]
      )?0:1));
    ' "$app" "$expected_release" &&
      curl --fail --silent --max-time 5 "http://127.0.0.1:$port$health_path" |
        node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const h=JSON.parse(s);process.exit(h.status==="ok"?0:1)});'; then
      return 0
    fi
    sleep 2
  done
  echo "Health check failed for $app" >&2
  return 1
}

finish() {
  local status=$?
  trap - EXIT
  if (( status != 0 )); then
    echo "Deployment failed for $app ($release)." >&2
    if [[ "$activated" == true ]]; then
      if [[ -n "$previous" && -d "$previous" ]]; then
        echo "Restoring previous release and environment." >&2
        if ! ln -s "$previous" "$root/current.rollback" ||
          ! mv -Tf "$root/current.rollback" "$root/current" ||
          ! cp "$incoming/previous.env" "$root/shared/.env" ||
          ! start_app "$previous" || ! health_check "$previous" || ! pm2 save; then
          echo "ROLLBACK FAILED: manual intervention required." >&2
        fi
      else
        if ! pm2 delete "$app"; then
          echo "Failed to stop unhealthy first deployment." >&2
        fi
        if ! pm2 save --force; then
          echo "Failed to persist PM2 state after failed first deployment." >&2
        fi
        rm -f "$root/current"
      fi
    fi
  fi
  rm -f "$incoming/app.env" "$incoming/previous.env" \
    "$incoming/release.tar.gz" "$incoming/lightsail.sh"
  rmdir "$incoming"
  exit "$status"
}
trap finish EXIT

node -e 'if(Number(process.versions.node.split(".")[0])!==24)throw new Error("Node.js 24 is required")'
command -v pm2 >/dev/null
pm2 ping
test ! -e "$destination"
mkdir "$destination"
tar -xzf "$incoming/release.tar.gz" -C "$destination"
test -f "$destination/main.js"
test -f "$destination/package-lock.json"
cd "$destination"
npm ci --omit=dev --no-audit --no-fund

echo "Applying pending migrations for $app before activation."
(
  cd "$destination/migration"
  npm ci --omit=dev --no-audit --no-fund
  node - "$incoming/app.env" <<'NODE'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { parse } = require('dotenv');
const environment = parse(fs.readFileSync(process.argv[2]));
if (!environment.DATABASE_URL) {
  throw new Error('APP_ENV must provide this application\'s DATABASE_URL');
}
const result = spawnSync(process.execPath, [
  require.resolve('prisma/build/index.js'),
  'migrate', 'deploy', '--config', 'prisma.config.ts',
], { env: { ...process.env, ...environment }, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) throw new Error(`Migration process terminated by ${result.signal}`);
process.exit(result.status);
NODE
)

if [[ -n "$previous" ]]; then
  test -f "$root/shared/.env"
  cp "$root/shared/.env" "$incoming/previous.env"
fi
cp "$incoming/app.env" "$root/shared/.env.next"
chmod 600 "$root/shared/.env.next"
ln -s "$destination" "$root/current.next"
activated=true
mv -f "$root/shared/.env.next" "$root/shared/.env"
mv -Tf "$root/current.next" "$root/current"
start_app "$destination"
health_check "$destination"
pm2 save
echo "Deployed $app release $release."
