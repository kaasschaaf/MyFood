#!/usr/bin/env bash
#
# Builds the GitHub Pages artifact for Kost.
#
# GitHub Pages serves exactly one site per repository, so the integration
# branch is published *next to* production instead of on its own host:
#
#   https://<user>.github.io/MyFood/       <- main      (production)
#   https://<user>.github.io/MyFood/dev/   <- develop   (preview)
#
# Both trees are built on every deploy, whichever branch triggered it, so a
# release never wipes the preview and the preview never wipes the release.
#
# Environment:
#   OUT          output directory (default: ./_site)
#   PROD_REF     ref served at the site root (default: main)
#   DEV_REF      ref served under /dev (default: develop, skipped when absent)
#   AH_API_BASE  AH proxy URL written into js/runtime-config.js (may be empty)
#   BUILD_TIME   ISO timestamp for the build stamp (default: now)
set -euo pipefail

OUT=${OUT:-$PWD/_site}
PROD_REF=${PROD_REF:-main}
DEV_REF=${DEV_REF:-develop}
AH_API_BASE=${AH_API_BASE:-}
BUILD_TIME=${BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}

# Everything the browser needs. The pipeline, the tests, the Cloudflare worker
# and node_modules stay out of the artifact.
APP_PATHS=(index.html producten.html manifest.json sw.js css js data icons)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

say() { printf '%s\n' "$*"; }

# Extracts a ref, installs its dependencies and produces its stylesheet.
build_ref() {
  local ref=$1 dir=$2
  say "· building $ref"
  mkdir -p "$dir"
  git archive "$ref" | tar -x -C "$dir"
  (
    cd "$dir"
    npm ci --silent --no-audit --no-fund
    npm run --silent build:css >/dev/null
  )
}

# Writes the deployment-only values. The proxy URL and build stamp come from the
# deployment, not from the branch, so they are never committed.
write_runtime_config() {
  local dir=$1 channel=$2
  node -e '
    const fs = require("node:fs");
    const [, file, channel, base, stamp] = process.argv;
    fs.writeFileSync(file, [
      "// Regenerated at deploy time by .github/workflows/deploy.yml.",
      `globalThis.MYFOOD_AH_API_BASE = ${JSON.stringify(base)};`,
      `globalThis.MYFOOD_BUILD_TIME = ${JSON.stringify(stamp)};`,
      `globalThis.KOST_CHANNEL = ${JSON.stringify(channel)};`,
      ""
    ].join("\n"));
  ' "$dir/js/runtime-config.js" "$channel" "$AH_API_BASE" "$BUILD_TIME"
}

# Copies only the runtime files of a built tree into the artifact.
copy_app() {
  local dir=$1 dest=$2 path
  mkdir -p "$dest"
  for path in "${APP_PATHS[@]}"; do
    if [ -e "$dir/$path" ]; then
      cp -R "$dir/$path" "$dest/"
    else
      say "  ! $path missing in $dir"
    fi
  done
}

# Marks the preview in the page itself: a badge that links back to production
# and a robots meta so the duplicate content stays out of search results.
add_preview_marks() {
  local dir=$1 label=$2
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const [dir, label] = process.argv.slice(1);
    const badge = `<a href="../" class="kost-dev-badge" title="develop preview ${label} — klik voor productie" style="position:fixed;left:1rem;bottom:1rem;z-index:2147483000;display:inline-flex;align-items:center;gap:.4rem;border-radius:9999px;background:#1f2937;color:#fff;padding:.45rem .8rem;font:600 11px/1 ui-sans-serif,system-ui;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;box-shadow:0 6px 18px rgba(15,23,42,.3);opacity:.92">dev · ${label}</a>`;
    const robots = `<meta name="robots" content="noindex, nofollow">`;
    for (const file of ["index.html", "producten.html"]) {
      const target = path.join(dir, file);
      if (!fs.existsSync(target)) continue;
      let html = fs.readFileSync(target, "utf8");
      if (html.includes("kost-dev-badge")) continue;
      html = html.replace("</head>", `  ${robots}\n</head>`);
      html = html.replace("</body>", `${badge}\n</body>`);
      fs.writeFileSync(target, html);
    }
  ' "$dir" "$label"
}

say "GitHub Pages artifact"
say "  production  $PROD_REF -> /"
say "  preview     $DEV_REF -> /dev/"
say "  output      $OUT"

rm -rf "$OUT"
mkdir -p "$OUT"

build_ref "$PROD_REF" "$WORK/prod"
write_runtime_config "$WORK/prod" production
copy_app "$WORK/prod" "$OUT"

if git rev-parse --verify --quiet "$DEV_REF^{commit}" >/dev/null; then
  build_ref "$DEV_REF" "$WORK/dev"
  write_runtime_config "$WORK/dev" dev
  copy_app "$WORK/dev" "$OUT/dev"
  add_preview_marks "$OUT/dev" "$(git rev-parse --short "$DEV_REF")"
  say "· preview marked noindex with a badge back to production"
else
  say "· $DEV_REF not found, preview skipped"
fi

touch "$OUT/.nojekyll"

say "  size        $(du -sh "$OUT" | cut -f1)"
say "  files       $(find "$OUT" -type f | wc -l | tr -d ' ')"
say "done"
