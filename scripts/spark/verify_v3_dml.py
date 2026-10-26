"""Exercise a CloudFormation-created Iceberg v3 table through Spark: deletion vectors, row
lineage, variant, unknown, geo types, MERGE, time travel, maintenance procedures, and an
in-place v2 to v3 upgrade. Expects freshly deployed, empty tables from IcebergV3DmlStack."""
from pyspark.sql import SparkSession

DML = "glue.sample_database.v3_dml_test"
UPGRADE = "glue.sample_database.v3_upgrade_test"
POINT_WKB = "0101000000000000000000F03F0000000000000040"
COLUMNS = "account_id, email, payload, home, shape, balance, updated_at"

spark = SparkSession.builder.appName("verify-v3-dml").getOrCreate()


def query(sql: str) -> list[tuple]:
    return [tuple(row) for row in spark.sql(sql).collect()]


def check(actual: object, expected: object, label: str) -> None:
    assert actual == expected, f"{label}: expected {expected!r}, got {actual!r}"
    print(f"  ok  {label}: {actual!r}")


def source_row(account_id: int, payload: str, balance: str) -> str:
    """SELECT producing one row in COLUMNS order; `placeholder` is left out so it stays NULL."""
    return (
        f"SELECT {account_id}L AS account_id, '{account_id}@example.com' AS email,"
        f" parse_json('{payload}') AS payload, ST_GeogFromWKB(X'{POINT_WKB}') AS home,"
        f" ST_SetSRID(ST_GeomFromWKB(X'{POINT_WKB}'), 4326) AS shape,"
        f" CAST({balance} AS DECIMAL(12,2)) AS balance, TIMESTAMP '2026-01-01 09:00:00+00:00' AS updated_at"
    )


def current_snapshot() -> int:
    return query(f"SELECT snapshot_id FROM {DML}.refs WHERE name = 'main'")[0][0]


def last_added_dvs() -> str | None:
    sql = f"SELECT summary['added-dvs'] FROM {DML}.snapshots WHERE snapshot_id = {current_snapshot()}"
    return query(sql)[0][0]


def lineage() -> dict[int, tuple[int, int]]:
    """account_id -> (_row_id, _last_updated_sequence_number) for every live row of DML."""
    rows = query(f"SELECT account_id, _row_id, _last_updated_sequence_number FROM {DML}")
    return {account_id: (row_id, seq) for account_id, row_id, seq in rows}


def row_ids() -> dict[int, int]:
    """account_id -> _row_id for every live row of DML."""
    return {account_id: row_id for account_id, (row_id, _) in lineage().items()}


def balances() -> list[tuple]:
    """(account_id, balance as string) for every live row of DML, ordered."""
    return query(f"SELECT account_id, CAST(balance AS STRING) FROM {DML} ORDER BY account_id")


print("v3_dml_test: INSERT")
# bucket[4] puts accounts 1 and 2 in bucket 0 and accounts 3 and 5 in bucket 3, so the UPDATE of 2
# and the DELETE of 5 each hit a file that keeps a live row and must write a deletion vector.
spark.sql(
    f"INSERT INTO {DML} ({COLUMNS}) "
    + " UNION ALL ".join(
        [
            source_row(1, '{"a":1,"tag":"x"}', "100.00"),
            source_row(2, '{"a":2}', "200.00"),
            source_row(3, '{"a":3}', "300.00"),
            source_row(5, '{"a":5}', "500.00"),
        ]
    )
)
check(sorted(row_ids().values()), [0, 1, 2, 3], "_row_id assigned from 0")
check(query(f"SELECT count(*) FROM {DML} WHERE placeholder IS NULL"), [(4,)], "placeholder reads NULL")
check(
    query(f"SELECT account_id, variant_get(payload, '$.a', 'int') FROM {DML} ORDER BY account_id"),
    [(1, 1), (2, 2), (3, 3), (5, 5)],
    "variant_get $.a",
)
check(
    query(f"SELECT to_json(payload) FROM {DML} WHERE account_id = 1"),
    [('{"a":1,"tag":"x"}',)],
    "to_json round trip",
)
check(
    query(
        f"SELECT hex(ST_AsBinary(home)), hex(ST_AsBinary(shape)), ST_SRID(home), ST_SRID(shape)"
        f" FROM {DML} WHERE account_id = 1"
    ),
    [(POINT_WKB, POINT_WKB, 4326, 4326)],
    "geography and geometry WKB and SRID",
)

print("v3_dml_test: UPDATE writes a deletion vector and keeps _row_id")
before = lineage()
spark.sql(f"UPDATE {DML} SET balance = CAST(250.00 AS DECIMAL(12,2)) WHERE account_id = 2")
after = lineage()
check(last_added_dvs(), "1", "UPDATE snapshot added-dvs")
check(after[2][0], before[2][0], "account 2 _row_id after UPDATE")
check(after[2][1] > before[2][1], True, "account 2 _last_updated_sequence_number rises")
check(after[1], before[1], "account 1 lineage untouched by UPDATE")

print("v3_dml_test: DELETE")
spark.sql(f"DELETE FROM {DML} WHERE account_id = 5")
check(last_added_dvs(), "1", "DELETE snapshot added-dvs")
check(balances(), [(1, "100.00"), (2, "250.00"), (3, "300.00")], "rows after UPDATE and DELETE")
check(
    query(
        f"SELECT DISTINCT file_format, referenced_data_file IS NOT NULL, content_offset IS NOT NULL,"
        f" content_size_in_bytes IS NOT NULL FROM {DML}.files WHERE content = 1"
    ),
    [("PUFFIN", True, True, True)],
    "every position delete is a Puffin deletion vector",
)

print("v3_dml_test: MERGE INTO and time travel")
pre_merge = current_snapshot()
spark.sql(
    f"MERGE INTO {DML} t USING ("
    + " UNION ALL ".join(
        [
            source_row(1, '{"a":1,"tag":"x"}', "111.00"),
            source_row(4, '{"a":4}', "400.00"),
            source_row(6, '{"a":6}', "600.00"),
        ]
    )
    + ") s ON t.account_id = s.account_id"
    " WHEN MATCHED THEN UPDATE SET balance = s.balance"
    f" WHEN NOT MATCHED THEN INSERT ({COLUMNS})"
    " VALUES (s.account_id, s.email, s.payload, s.home, s.shape, s.balance, s.updated_at)"
)
after_merge = [(1, "111.00"), (2, "250.00"), (3, "300.00"), (4, "400.00"), (6, "600.00")]
check(balances(), after_merge, "rows after MERGE")
check(
    query(f"SELECT account_id FROM {DML} VERSION AS OF {pre_merge} ORDER BY account_id"),
    [(1,), (2,), (3,)],
    "VERSION AS OF pre-MERGE snapshot",
)
check(
    query(f"SELECT account_id, variant_get(payload, '$.a', 'int') FROM {DML} ORDER BY account_id"),
    [(1, 1), (2, 2), (3, 3), (4, 4), (6, 6)],
    "variant_get after MERGE",
)

print("v3_dml_test: rewrite_data_files and expire_snapshots")
before = row_ids()
rewrite = spark.sql(
    f"CALL glue.system.rewrite_data_files(table => 'sample_database.v3_dml_test',"
    f" options => map('rewrite-all', 'true'))"
).first()
check(rewrite.rewritten_data_files_count > 0, True, "rewrite_data_files rewrote files")
check(row_ids(), before, "_row_id after rewrite")
spark.sql(
    "CALL glue.system.expire_snapshots(table => 'sample_database.v3_dml_test',"
    " older_than => TIMESTAMP '2099-01-01 00:00:00', retain_last => 1)"
)
check(query(f"SELECT count(*) FROM {DML}.snapshots"), [(1,)], "snapshots left after expire_snapshots")
check(balances(), after_merge, "rows after maintenance")

print("v3_upgrade_test: v2 INSERT, upgrade, v3 INSERT")
spark.sql(f"INSERT INTO {UPGRADE} VALUES (1L, 'written at v2')")
spark.sql(f"ALTER TABLE {UPGRADE} SET TBLPROPERTIES ('format-version' = '3')")
check(
    query(f"SHOW TBLPROPERTIES {UPGRADE} ('format-version')"),
    [("format-version", "3")],
    "format-version after upgrade",
)
spark.sql(f"INSERT INTO {UPGRADE} VALUES (2L, 'written at v3')")
check(
    query(f"SELECT id, _row_id FROM {UPGRADE} ORDER BY id"),
    [(1, 1), (2, 0)],
    "_row_id after the first v3 commit",
)

spark.stop()
