#!/usr/bin/env bash
#
# Installs the pinned Spark + Iceberg toolchain used by the integration
# scripts: Spark, iceberg-spark-runtime, and iceberg-aws-bundle. Every
# file is checked against a sha512 pinned below; a mismatch exits
# non-zero naming the file. Files that are already installed and verified
# are not downloaded again. Requires a JDK 17 on PATH to run Spark.
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
ICEBERG_RUNTIME_SHA512="ac1e2cb00970309f0c6bf241fabf334aef373c1f3e3b443181d429d5f2c0903ace47df9cfc1d55c95807a096cf405ae0a8868831b9e9eb5696dfdb6380587f38"
ICEBERG_AWS_SHA512="b01456f80142c8837004e31329a0f40db8a9d44917a4a694cb7d8d6d3a68cb20c61e6f7788fa1bdcb95c0edf724322b49667d6f9ef60fc9cc46da5c24ce5c7de"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
header() { printf '\n=== %s ===\n' "$*"; }

verify() {
    local file="$1" expected="$2" actual
    actual=$(shasum -a 512 "$file" | cut -d' ' -f1)
    if [ "$actual" != "$expected" ]; then
        red "sha512 mismatch for $(basename "$file"): expected $expected, got $actual" >&2
        return 1
    fi
}

install_jar() {
    local jar="$1" url="$2" sha="$3" dest="${SPARK_INSTALL_DIR}/jars/$1"
    if [ -f "$dest" ]; then
        verify "$dest" "$sha"
        green "$jar already installed"
        return
    fi
    header "Downloading $jar"
    curl -fsSL --retry 3 --connect-timeout 30 --max-time 600 -o "${dest}.part" "$url"
    verify "${dest}.part" "$sha"
    mv "${dest}.part" "$dest"
}

mkdir -p "${SPARK_INSTALL_DIR}/jars"

if [ -x "${SPARK_HOME}/bin/spark-submit" ]; then
    green "${SPARK_DIST} already installed"
else
    header "Downloading ${SPARK_DIST}.tgz"
    work=$(mktemp -d "${SPARK_INSTALL_DIR}/extract.XXXXXX")
    curl -fsSL --retry 3 --connect-timeout 30 --max-time 1800 -o "${work}/spark.tgz" "$SPARK_URL"
    verify "${work}/spark.tgz" "$SPARK_SHA512"
    tar -xzf "${work}/spark.tgz" -C "$work"
    rm -rf "$SPARK_HOME"
    mv "${work}/${SPARK_DIST}" "$SPARK_HOME"
    rm -rf "$work"
fi

install_jar "$ICEBERG_RUNTIME_JAR" "${MAVEN}/iceberg-spark-runtime-4.1_2.13/${ICEBERG_VERSION}/${ICEBERG_RUNTIME_JAR}" "$ICEBERG_RUNTIME_SHA512"
install_jar "$ICEBERG_AWS_JAR" "${MAVEN}/iceberg-aws-bundle/${ICEBERG_VERSION}/${ICEBERG_AWS_JAR}" "$ICEBERG_AWS_SHA512"

green "Spark toolchain ready in ${SPARK_INSTALL_DIR}"
