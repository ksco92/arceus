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
SPARK_SHA512="391d04f40da0f6e961513d1ad72a6e3d51aef99f751c835e058a329b01369d83d17c2a9c68fad6be9496eea6687107d0d3d6893f7a53f53ddbfe669022220523"
MAVEN="https://repo1.maven.org/maven2/org/apache/iceberg"
DOWNLOADS="${SPARK_INSTALL_DIR}/downloads"
ICEBERG_RUNTIME_SHA512="ac1e2cb00970309f0c6bf241fabf334aef373c1f3e3b443181d429d5f2c0903ace47df9cfc1d55c95807a096cf405ae0a8868831b9e9eb5696dfdb6380587f38"
ICEBERG_AWS_SHA512="b01456f80142c8837004e31329a0f40db8a9d44917a4a694cb7d8d6d3a68cb20c61e6f7788fa1bdcb95c0edf724322b49667d6f9ef60fc9cc46da5c24ce5c7de"

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
