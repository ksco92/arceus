#!/usr/bin/env bash
#
# Installs the pinned Spark + Iceberg toolchain used by the integration
# scripts. Each download is kept under downloads/ and checked against a
# sha512 pinned below on every run (a mismatch exits non-zero naming the
# file); the Spark tree is then extracted fresh from the verified archive.
# Requires a JDK 17 on PATH to run Spark.
#
# Usage:
#   scripts/spark/install-spark.sh
#
# Optional env vars:
#   SPARK_INSTALL_DIR - default <repo>/.spark
#
set -euo pipefail

# shellcheck source=scripts/spark/spark-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/spark-env.sh"

SPARK_URL="https://archive.apache.org/dist/spark/spark-${SPARK_VERSION}/${SPARK_DIST}.tgz"
SPARK_SHA512="9f39e588e7d4c70ec0126109679f386eb9bfa26979dc42669fe4f3e3446a082dca8ffbf5e8dbe8ad411cf2ce5bf803ce670341620bf52d968067acf86626106e"
MAVEN="https://repo1.maven.org/maven2/org/apache/iceberg"
DOWNLOADS="${SPARK_INSTALL_DIR}/downloads"
ICEBERG_RUNTIME_SHA512="f4620bb2d20777146a769a8a939a5bed658e1d5708b6a5155e1f6e831c0bfd29bd1f82618dc59bc0f30399ffcb03add3e66656286692dc6c2be94e4e1f4e7479"
ICEBERG_AWS_SHA512="bb50f7dc5f36a001efecf15e4d03eff955466f06557261fbacdd7fe0d88113c82e0b9b2af96cd554cef4a1d4c2348fc950270bc3f51cf6bf1e4526f46ce336a0"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
header() { printf '\n=== %s ===\n' "$*"; }

verify() {
    local file="$1" expected="$2" name="$3" actual
    actual=$(shasum -a 512 "$file" | cut -d' ' -f1)
    if [ "$actual" != "$expected" ]; then
        red "sha512 mismatch for ${name}: expected $expected, got $actual" >&2
        return 1
    fi
}

download() {
    local url="$1" dest="$2" sha="$3" max_time="$4" name
    name=$(basename "$dest")
    if [ -f "$dest" ]; then
        verify "$dest" "$sha" "$name"
        green "$name already downloaded"
        return
    fi
    header "Downloading $name"
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 --connect-timeout 30 --max-time "$max_time" -o "${dest}.part" "$url"
    verify "${dest}.part" "$sha" "$name"
    mv "${dest}.part" "$dest"
}

mkdir -p "$DOWNLOADS"
download "$SPARK_URL" "${DOWNLOADS}/spark.tgz" "$SPARK_SHA512" 1800
download "${MAVEN}/${ICEBERG_SPARK_ARTIFACT}/${ICEBERG_VERSION}/${ICEBERG_RUNTIME_JAR}" "${DOWNLOADS}/${ICEBERG_RUNTIME_JAR}" "$ICEBERG_RUNTIME_SHA512" 600
download "${MAVEN}/iceberg-aws-bundle/${ICEBERG_VERSION}/${ICEBERG_AWS_JAR}" "${DOWNLOADS}/${ICEBERG_AWS_JAR}" "$ICEBERG_AWS_SHA512" 600

rm -rf "$SPARK_HOME"
tar -xzf "${DOWNLOADS}/spark.tgz" -C "$SPARK_INSTALL_DIR"

green "Spark toolchain ready in ${SPARK_INSTALL_DIR}"
