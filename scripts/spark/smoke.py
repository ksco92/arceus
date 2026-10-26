"""Smoke test for the Spark toolchain: lists databases, then round-trips a
one-column Iceberg table through the Glue catalog and the lake bucket."""
from pyspark.sql import SparkSession

TABLE = "glue.sample_database.spark_smoke"

spark = SparkSession.builder.appName("spark-smoke").getOrCreate()

databases = [row[0] for row in spark.sql("SHOW DATABASES IN glue").collect()]
assert "sample_database" in databases, f"sample_database not in {databases}"

spark.sql(f"DROP TABLE IF EXISTS {TABLE} PURGE")
spark.sql(f"CREATE TABLE {TABLE} (id bigint) USING iceberg")
try:
    spark.sql(f"INSERT INTO {TABLE} VALUES (1), (2), (3)")
    count = spark.sql(f"SELECT count(*) FROM {TABLE}").first()[0]
    assert count == 3, f"expected 3 rows, got {count}"
finally:
    spark.sql(f"DROP TABLE {TABLE} PURGE")

print("spark smoke OK")
spark.stop()
