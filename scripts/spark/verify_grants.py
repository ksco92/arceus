"""Grant checks for IcebergSurfaceStack, run under an assumed grantee role:
`write` inserts one row into grants_test; `read` expects that row and the
row the read-write role inserted through Athena."""
import sys

from pyspark.sql import SparkSession

TABLE = "glue.sample_database.grants_test"

spark = SparkSession.builder.appName("verify-grants").getOrCreate()

if sys.argv[1] == "write":
    spark.sql(f"INSERT INTO {TABLE} VALUES (1, 'spark')")
else:
    rows = [tuple(r) for r in spark.sql(f"SELECT id, source FROM {TABLE} ORDER BY id").collect()]
    assert rows == [(1, "spark"), (2, "athena")], f"unexpected grants_test rows: {rows}"

spark.stop()
