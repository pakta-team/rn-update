#!/usr/bin/env bash
set -euo pipefail

source_root="$(cd "$(dirname "$0")/.." && pwd)"
root="${T24_TEMP_ROOT:-$(mktemp -d "${TMPDIR:-/tmp}/pakta-t24-XXXXXXXX")}"
mkdir -p "$root"/{downloads,logs,tmp,cache,tools,compilers,fixtures}
root="$(cd "$root" && pwd)"
case "$root/" in "$source_root/"*) printf 'TEMP must be outside the CLI\n' >&2; exit 2;; esac
export TMPDIR="$root/tmp" TEMP="$root/tmp" TMP="$root/tmp"
export npm_config_cache="$root/cache/npm" BUN_INSTALL_CACHE_DIR="$root/cache/bun"
export XDG_CACHE_HOME="$root/cache" NO_COLOR=1
exec > >(tee "$root/logs/runner.log") 2>&1
printf 'T24_TEMP_ROOT=%s\n' "$root"
uname -a
fetch() {
  curl --fail --location --retry 3 --retry-all-errors --connect-timeout 20 --max-time 180 "$1" -o "$2"
}
for version in 24.11.1 18.17.0; do
  archive="node-v$version-linux-x64.tar.xz"
  fetch "https://nodejs.org/dist/v$version/$archive" "$root/downloads/$archive"
  fetch "https://nodejs.org/dist/v$version/SHASUMS256.txt" "$root/downloads/node-$version-SHASUMS256.txt"
  (cd "$root/downloads"; awk -v name="$archive" '$2 == name' "node-$version-SHASUMS256.txt" | sha256sum --check)
  tar -xJf "$root/downloads/$archive" -C "$root/tools"
done
fetch 'https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-1.3.14.tgz' "$root/downloads/bun.tgz"
mkdir -p "$root/tools/bun"
tar -xzf "$root/downloads/bun.tgz" -C "$root/tools/bun"
export PATH="$root/tools/node-v24.11.1-linux-x64/bin:$root/tools/bun/package/bin:$PATH"
node --version
bun --version
python3 - "$source_root" "$root/work" <<'PY'
import hashlib, json, pathlib, shutil, sys
source, target = map(pathlib.Path, sys.argv[1:])
shutil.copytree(source, target, ignore=shutil.ignore_patterns('node_modules', 'lib', '.git'))
manifest = {str(p.relative_to(target)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(target.rglob('*')) if p.is_file()}
(target.parent / 'source-sha256.json').write_text(json.dumps(manifest, indent=2) + '\n')
PY
cd "$root/work"
bun install --frozen-lockfile > "$root/logs/install.log" 2>&1
fixture_url='https://raw.githubusercontent.com/sunnylqm/hbc-diff-benchmark/e6a870a1c26c4b64c7860d7e1aa575707d22ad88'
for file in base.jsbundle s3-medium-feature.jsbundle; do
  fetch "$fixture_url/fixtures/$file" "$root/fixtures/$file"
done
fetch "$fixture_url/LICENSE" "$root/fixtures/LICENSE"
printf '11c8ad8f7e8c7c59ee45582c77d896a35fa646617f3ba0f5b338a425a7c93b7d  %s/base.jsbundle\na693e68254b6c13fae8f839d20c14f9d11c5ab98d4be1b8d13ba1e929a12d752  %s/s3-medium-feature.jsbundle\n' "$root/fixtures" "$root/fixtures" | sha256sum --check | tee "$root/logs/fixtures.log"
test -s "$root/fixtures/LICENSE"
export HERMES_METRO_FIXTURES="$root/fixtures"
failed=0
run_check() {
  local name="$1"
  shift
  local status=0
  "$@" > "$root/logs/$name.log" 2>&1 || status=$?
  printf '%s\t%s\n' "$name" "$status" | tee -a "$root/results.tsv"
  tail -n 18 "$root/logs/$name.log"
  if [ "$status" -ne 0 ]; then failed=1; fi
}
for row in '96 react-native@0.77.3 sdks/hermesc/linux64-bin/hermesc' '98.16 hermes-compiler@250829098.0.16 hermesc/linux64-bin/hermesc' '98.17 hermes-compiler@250829098.0.17 hermesc/linux64-bin/hermesc' '99 hermes-compiler@260318099.0.4 hermesc/linux64-bin/hermesc'; do
  read -r label package executable <<< "$row"
  compiler_root="$root/compilers/$label"
  mkdir -p "$compiler_root"
  npm pack "$package" --pack-destination "$root/downloads" --json > "$root/logs/compiler-$label-package.json"
  archive="$(node -e 'console.log(require(process.argv[1])[0].filename)' "$root/logs/compiler-$label-package.json")"
  tar -xzf "$root/downloads/$archive" --strip-components=1 -C "$compiler_root" "package/$executable" package/package.json
  EXPECTED_PACKAGE="$package" node -e 'const p=require(process.argv[1]);if(`${p.name}@${p.version}`!==process.env.EXPECTED_PACKAGE)throw Error("compiler package mismatch")' "$compiler_root/package.json"
  export HERMESC="$compiler_root/$executable"
  "$HERMESC" -version | tee "$root/logs/compiler-$label-version.log"
  EXPECTED_HBC="${label%%.*}" bun -e 'import {probeHbcVersion} from "./src/utils/hermes-base"; if(probeHbcVersion(process.env.HERMESC)!==Number(process.env.EXPECTED_HBC))throw Error("HBC mismatch")'
  sha256sum "$root/downloads/$archive" "$HERMESC" | tee "$root/logs/compiler-$label-sha256.log"
  run_check "hermes-$label" bun test tests/hermes-*.test.ts
  run_check "fuzz-$label" bun run fuzz:hermes-base --rounds 50 --seed "${label%%.*}" --out "$root/fuzz-$label" --verbose
done
run_check lint bun run lint
run_check build bun run build
node18="$root/tools/node-v18.17.0-linux-x64/bin/node"
"$node18" -e 'if(process.version!=="v18.17.0")throw Error("Node version mismatch");console.log(process.version)'
run_check node18-smoke "$node18" scripts/smoke-lib.js
run_check node18-async timeout 30s "$node18" tests/fixtures/hermes-async-check.cjs '{"operation":"abort","modulePath":"./lib/utils/hermes-base.js"}'
if ! python3 - "$root/logs/node18-async.log" <<'PY'
import json, pathlib, sys
lines = pathlib.Path(sys.argv[1]).read_text().splitlines()
results = [json.loads(line.split('HERMES_ASYNC_RESULT', 1)[1].strip())
           for line in lines if 'HERMES_ASYNC_RESULT' in line]
assert len(results) == 1 and results[0]['status'] == 'dump-failed', results
PY
then failed=1; printf 'node18-async-result\t1\n' >> "$root/results.tsv"; fi
run_check node18-blockers env HERMES_TEST_NODE="$node18" bun test tests/hermes-blockers.test.ts
sha256sum "$root"/downloads/* > "$root/downloads-sha256.txt"
printf 'T24 exit=%s; evidence=%s\n' "$failed" "$root"
exit "$failed"
