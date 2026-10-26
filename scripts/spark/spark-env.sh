# Sourced by the integration scripts. Defines the pinned Spark toolchain
# paths and `spark_submit`, which runs a PySpark program against the Glue
# Data Catalog as catalog `glue`. Install the toolchain with
# scripts/spark/install-spark.sh.
#
# Optional env vars:
#   SPARK_INSTALL_DIR - default <repo>/.spark
#   AWS_REGION        - default us-east-1
#   ACCOUNT_ID        - default: from `aws sts get-caller-identity`

SPARK_VERSION="4.1.3"
ICEBERG_VERSION="1.12.0"
SPARK_DIST="spark-${SPARK_VERSION}-bin-hadoop3"
ICEBERG_RUNTIME_JAR="iceberg-spark-runtime-4.1_2.13-${ICEBERG_VERSION}.jar"
ICEBERG_AWS_JAR="iceberg-aws-bundle-${ICEBERG_VERSION}.jar"

SPARK_INSTALL_DIR="${SPARK_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.spark}"
export SPARK_HOME="${SPARK_INSTALL_DIR}/${SPARK_DIST}"
export SPARK_JARS="${SPARK_INSTALL_DIR}/jars/${ICEBERG_RUNTIME_JAR},${SPARK_INSTALL_DIR}/jars/${ICEBERG_AWS_JAR}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export SPARK_LOCAL_IP="${SPARK_LOCAL_IP:-127.0.0.1}"

spark_submit() {
    local account="${ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
    "${SPARK_HOME}/bin/spark-submit" \
        --master 'local[2]' \
        --jars "$SPARK_JARS" \
        --conf spark.ui.enabled=false \
        --conf spark.sql.geospatial.enabled=true \
        --conf spark.sql.extensions=org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions \
        --conf spark.sql.catalog.glue=org.apache.iceberg.spark.SparkCatalog \
        --conf spark.sql.catalog.glue.catalog-impl=org.apache.iceberg.aws.glue.GlueCatalog \
        --conf spark.sql.catalog.glue.io-impl=org.apache.iceberg.aws.s3.S3FileIO \
        --conf "spark.sql.catalog.glue.warehouse=s3://data-lake-bucket-${account}/" \
        "$@"
}
