"""DML checks for IcebergDmlStack's v2 merge-on-read table: INSERT, UPDATE,
DELETE, MERGE INTO, time travel, compaction, and snapshot expiration, in order
in one Spark session."""
from datetime import datetime, timedelta, timezone

from pyspark.sql import SparkSession

TABLE = "glue.sample_database.dml_test"
PROCEDURE_TABLE = "sample_database.dml_test"

spark = SparkSession.builder.appName("verify-dml").getOrCreate()


def scalar(sql):
    return spark.sql(sql).first()[0]


def check(label, expected, actual):
    assert expected == actual, f"{label}: expected {expected!r}, got {actual!r}"
    print(f"  {label} OK ({actual})")


def count(where=""):
    return scalar(f"SELECT count(*) FROM {TABLE} {where}")


def balance(account_id):
    return str(scalar(f"SELECT balance FROM {TABLE} WHERE account_id = {account_id}"))


def snapshot_ids():
    rows = spark.sql(f"SELECT snapshot_id FROM {TABLE}.snapshots ORDER BY committed_at").collect()
    return [row[0] for row in rows]


print("STEP 1 - INSERT 5 seed accounts")
spark.sql(f"""INSERT INTO {TABLE} VALUES
  (1, 'a@example.com', CAST(100.00 AS DECIMAL(12,2)), TIMESTAMP '2026-01-01 09:00:00+00:00'),
  (2, 'b@example.com', CAST(200.00 AS DECIMAL(12,2)), TIMESTAMP '2026-01-01 09:00:00+00:00'),
  (3, 'c@example.com', CAST(300.00 AS DECIMAL(12,2)), TIMESTAMP '2026-01-01 09:00:00+00:00'),
  (4, 'd@example.com', CAST(400.00 AS DECIMAL(12,2)), TIMESTAMP '2026-01-01 09:00:00+00:00'),
  (5, 'e@example.com', CAST(500.00 AS DECIMAL(12,2)), TIMESTAMP '2026-01-01 09:00:00+00:00')""")
check("row count after INSERT", 5, count())

print("STEP 2 - UPDATE balance for account_id=2")
spark.sql(f"""UPDATE {TABLE}
  SET balance = CAST(250.00 AS DECIMAL(12,2)), last_updated_at = TIMESTAMP '2026-02-01 09:00:00+00:00'
  WHERE account_id = 2""")
check("balance updated", "250.00", balance(2))
check("row count unchanged after UPDATE", 5, count())

print("STEP 3 - DELETE account_id=4")
spark.sql(f"DELETE FROM {TABLE} WHERE account_id = 4")
check("row count after DELETE", 4, count())
check("deleted row gone", 0, count("WHERE account_id = 4"))

print("STEP 4 - capture pre-MERGE snapshot id")
snapshot_pre_merge = snapshot_ids()[-1]
print(f"  pre-MERGE snapshot_id = {snapshot_pre_merge}")

print("STEP 5 - MERGE INTO (update id=3, insert id=6 and id=7)")
spark.sql(f"""MERGE INTO {TABLE} t
  USING (
    SELECT 3 AS account_id, 'c@example.com' AS email,
           CAST(333.00 AS DECIMAL(12,2)) AS balance,
           TIMESTAMP '2026-03-01 09:00:00+00:00' AS last_updated_at
    UNION ALL SELECT 6, 'f@example.com', CAST(600.00 AS DECIMAL(12,2)),
           TIMESTAMP '2026-03-01 09:00:00+00:00'
    UNION ALL SELECT 7, 'g@example.com', CAST(700.00 AS DECIMAL(12,2)),
           TIMESTAMP '2026-03-01 09:00:00+00:00'
  ) s
  ON t.account_id = s.account_id
  WHEN MATCHED THEN UPDATE
    SET balance = s.balance, last_updated_at = s.last_updated_at
  WHEN NOT MATCHED THEN INSERT
    (account_id, email, balance, last_updated_at)
    VALUES (s.account_id, s.email, s.balance, s.last_updated_at)""")
check("row count after MERGE (4 + 2 inserts)", 6, count())
check("id=3 updated via MERGE", "333.00", balance(3))
check("id=6 inserted via MERGE", 1, count("WHERE account_id = 6"))
check("id=7 inserted via MERGE", 1, count("WHERE account_id = 7"))

print("STEP 6 - time travel to the pre-MERGE snapshot")
as_of = f"VERSION AS OF {snapshot_pre_merge}"
check("time-travel count", 4, count(as_of))
check("time-travel pre-MERGE sees no id=6", 0, count(f"{as_of} WHERE account_id = 6"))

print("STEP 7 - rewrite_data_files")
spark.sql(f"CALL glue.system.rewrite_data_files(table => '{PROCEDURE_TABLE}')")
check("row count unchanged after compaction", 6, count())

print("STEP 8 - expire_snapshots")
before = len(snapshot_ids())
future = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
spark.sql(
    f"CALL glue.system.expire_snapshots(table => '{PROCEDURE_TABLE}', "
    f"older_than => TIMESTAMP '{future}', retain_last => 1)"
)
after = len(snapshot_ids())
assert before > 1, f"expected more than 1 snapshot before expiry, got {before}"
check("snapshots remaining after expiry", 1, after)
check("row count unchanged after expiry", 6, count())

print("STEP 9 - final state")
rows = spark.sql(f"SELECT account_id, balance FROM {TABLE} ORDER BY account_id").collect()
actual = [(row[0], str(row[1])) for row in rows]
expected = [(1, "100.00"), (2, "250.00"), (3, "333.00"), (5, "500.00"), (6, "600.00"), (7, "700.00")]
check("final state", expected, actual)

spark.stop()
