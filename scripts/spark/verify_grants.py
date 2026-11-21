"""Grant checks for IcebergSurfaceStack, run under an assumed grantee role:
`write` inserts one row into grants_test; `read` expects that row and the
row the read-write role inserted through Athena."""
import argparse

from pyspark.sql import SparkSession

TABLE = "glue.sample_database.grants_test"


def write(spark):
    spark.sql(f"INSERT INTO {TABLE} VALUES (1, 'spark')")


def read(spark):
    rows = [tuple(r) for r in spark.sql(f"SELECT id, source FROM {TABLE} ORDER BY id").collect()]
    assert rows == [(1, "spark"), (2, "athena")], f"unexpected grants_test rows: {rows}"


PHASES = {"write": write, "read": read}

parser = argparse.ArgumentParser()
parser.add_argument("--phase", choices=sorted(PHASES), required=True)
args = parser.parse_args()

spark = SparkSession.builder.appName(f"verify-grants-{args.phase}").getOrCreate()
PHASES[args.phase](spark)
spark.stop()
