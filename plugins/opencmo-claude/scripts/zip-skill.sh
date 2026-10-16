#!/usr/bin/env bash
# Packs skills/opencmo into opencmo-skill.zip for claude.ai (Settings → Capabilities → Skills →
# Upload). The zip is a build output: not committed.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$here/opencmo-skill.zip}"
rm -f "$out"
(cd "$here/skills" && zip -qr "$out" opencmo)
echo "wrote $out"
