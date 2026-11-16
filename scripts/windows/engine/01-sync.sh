#!/usr/bin/env bash
# Step 1 (Windows): check out Chromium $CHROMIUM_VERSION (env.sh) for a Windows target into
# $AC_CHROMIUM_BUILD (default ~/chromium-build-win), without history, then run its hooks; no build.
# On a Mac host, only the Windows target's deps (target_os_only) and, of the CIPD packages, only the ones a build uses
# (cipd.ensure, versions from this Chromium's DEPS): the rest are tests, other platforms and prebuilt tools.
# On a Linux host (Chromium's supported one for Windows cross builds), the standard checkout: gclient adds the host,
# so the Linux sysroot and host tools come with it, and every CIPD package DEPS lists.
# The hooks that need the Windows toolchain fail until toolchain.sh has run: run this again after it.
# Usage: scripts/windows/engine/01-sync.sh --apply | --help (under the chromium lock)
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$AC_MAC_BUILD_DIR/step-guard.sh" "$@"
if [[ ! -x "$CB/depot_tools/gclient" ]]; then
  git clone --depth=1 https://chromium.googlesource.com/chromium/tools/depot_tools.git "$CB/depot_tools"
fi
[[ -f "$CB/depot_tools/python3_bin_reldir.txt" ]] || "$CB/depot_tools/ensure_bootstrap" < /dev/null
rm -rf "$CB/series-base"
mkdir -p "$CB/chromium_git/chromium"
cd "$CB/chromium_git/chromium"
case "$(uname -s)" in
  Darwin) target_os_only="target_os_only = True"; trimmed_cipd=1 ;;
  Linux) target_os_only=""; trimmed_cipd=0 ;;
  *) echo "01-sync.sh: cross-build Windows from a Linux or Mac host" >&2; exit 64 ;;
esac
cat > .gclient <<GCLIENT
solutions = [{'managed': False, 'name': 'src',
  'url': 'https://chromium.googlesource.com/chromium/src.git@refs/tags/$CHROMIUM_VERSION',
  'custom_vars': {'checkout_pgo_profiles': True, 'source_tarball': False, 'siso_version': 'latest'},
  'custom_deps': {}, 'deps_file': 'DEPS', 'safesync_url': ''}]
target_os = ['win']
$target_os_only
GCLIENT
if [ -d src/.git ]; then
  timeout 3600 git -C src fetch --depth=1 --no-tags origin "refs/tags/$CHROMIUM_VERSION:refs/tags/$CHROMIUM_VERSION"
  git -C src -c advice.detachedHead=false checkout -q -f "refs/tags/$CHROMIUM_VERSION"
fi
if [[ $trimmed_cipd == 1 ]]; then
  timeout 7200 gclient sync --no-history --nohooks --reset --force -D -j 16 --ignore-dep-type=cipd < /dev/null
  timeout 3600 cipd ensure -log-level warning -root "$CB/chromium_git/chromium" -ensure-file "$AC_WIN_BUILD_DIR/cipd.ensure" < /dev/null
else
  timeout 7200 gclient sync --no-history --nohooks --reset --force -D -j 16 < /dev/null
fi
gclient runhooks < /dev/null
