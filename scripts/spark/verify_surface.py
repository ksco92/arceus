"""Engine checks for IcebergSurfaceStack: one transforms_test row, then the
nested_test list, struct, and map roundtrip, through the Glue catalog."""
from pyspark.sql import SparkSession

TRANSFORMS = "glue.sample_database.transforms_test"
NESTED = "glue.sample_database.nested_test"

spark = SparkSession.builder.appName("verify-surface").getOrCreate()


def scalar(sql):
    return spark.sql(sql).first()[0]


spark.sql(f"""INSERT INTO {TRANSFORMS} VALUES
  (TIMESTAMP '2026-03-15 14:30:00+00:00',
   TIMESTAMP '2026-03-15 14:30:00+00:00',
   TIMESTAMP '2026-03-15 14:30:00+00:00',
   TIMESTAMP '2026-03-15 14:30:00+00:00',
   12345, 'alice@example.com', 99)""")
count = scalar(f"SELECT count(*) FROM {TRANSFORMS}")
assert count == 1, f"expected transforms_test count=1, got {count}"

spark.sql(f"""INSERT INTO {NESTED} VALUES
  (1, array('x', 'y', 'z'),
   named_struct('first_name', 'Ada', 'last_name', 'Lovelace', 'age', 36),
   map('country', 'UK', 'tier', 'gold')),
  (2, array('only-one'),
   named_struct('first_name', 'Grace', 'last_name', 'Hopper', 'age', CAST(NULL AS INT)),
   map('country', 'US'))""")

tag = scalar(f"SELECT tags[0] FROM {NESTED} WHERE id = 1")
assert tag == "x", f"expected tags[0]='x', got {tag!r}"

profile = spark.sql(
    f"SELECT profile.first_name, profile.last_name FROM {NESTED} WHERE id = 2"
).first()
assert tuple(profile) == ("Grace", "Hopper"), f"unexpected profile: {tuple(profile)}"

tier = scalar(f"SELECT attrs['tier'] FROM {NESTED} WHERE id = 1")
assert tier == "gold", f"expected attrs['tier']='gold', got {tier!r}"

spark.stop()
