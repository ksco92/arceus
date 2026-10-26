"""Smoke test for the Spark toolchain: lists databases, then writes to and
reads from the CDK-created Iceberg table through the Glue catalog and the
lake bucket."""
from pyspark.sql import SparkSession

TABLE = "glue.sample_database.spark_smoke"

spark = SparkSession.builder.appName("spark-smoke").getOrCreate()

databases = [row[0] for row in spark.sql("SHOW DATABASES IN glue").collect()]
assert "sample_database" in databases, f"sample_database not in {databases}"

spark.sql(f"INSERT INTO {TABLE} VALUES (1)")
count = spark.sql(f"SELECT count(*) FROM {TABLE}").first()[0]
assert count == 1, f"expected 1 row, got {count}"

spark.stop()
