"""Run the engine-side checks for one step of integration-test-evolution.sh."""
import argparse

from pyspark.sql import SparkSession

TABLE = "glue.sample_database.evolution_test"
NESTED = "glue.sample_database.nested_evolution_test"


def phase_1(spark: SparkSession) -> None:
    spark.sql(
        f"""INSERT INTO {TABLE} VALUES
        (10, 'a@example.com', TIMESTAMP '2026-01-01 09:00:00+00:00'),
        (11, 'b@example.com', TIMESTAMP '2026-01-02 09:00:00+00:00'),
        (12, 'c@example.com', TIMESTAMP '2026-01-03 09:00:00+00:00')"""
    )
    spark.sql(
        f"""INSERT INTO {NESTED} VALUES
        (100, array('t1', 't2'), map('k1', 'v1', 'k2', 'v2'), named_struct('line1', 'L1', 'city', 'C1'))"""
    )


def phase_2(spark: SparkSession) -> None:
    rows = spark.sql(f"SELECT customer_id, region FROM {TABLE} ORDER BY customer_id").collect()
    assert rows == [(10, None), (11, None), (12, None)], f"pre-existing rows: expected region NULL for ids 10-12, got {rows}"
    spark.sql(f"INSERT INTO {TABLE} VALUES (13, 'd@example.com', TIMESTAMP '2026-02-01 09:00:00+00:00', 'us-east-1')")


def phase_3(spark: SparkSession) -> None:
    rows = spark.sql(f"SELECT contact_email FROM {TABLE} WHERE customer_id = 10").collect()
    assert rows == [("a@example.com",)], f"contact_email for customer_id 10: expected a@example.com, got {rows}"


def phase_4(spark: SparkSession) -> None:
    rows = spark.sql(f"SELECT customer_id, contact_email FROM {TABLE} ORDER BY customer_id").collect()
    assert len(rows) >= 4, f"row count: expected at least 4, got {len(rows)}: {rows}"


def phase_5(spark: SparkSession) -> None:
    spark.sql(f"INSERT INTO {TABLE} VALUES (14, 'e@example.com', TIMESTAMP '2026-03-05 09:00:00+00:00')")
    rows = spark.sql(f"SELECT customer_id FROM {TABLE} ORDER BY customer_id").collect()
    assert len(rows) >= 5, f"row count: expected at least 5, got {len(rows)}: {rows}"


def read_nested(spark: SparkSession, extra: str) -> list[tuple]:
    columns = "id, element_at(tags, 1), element_at(tags, 2), attrs['k1'], attrs['k2'], addr.line1, addr.city"
    return [tuple(row) for row in spark.sql(f"SELECT {columns}, {extra} FROM {NESTED} ORDER BY id").collect()]


def check_nested(spark: SparkSession, extra: str, old: list[tuple], insert: str, new: tuple) -> None:
    rows = read_nested(spark, extra)
    assert rows == old, f"nested rows loaded before this step: expected {old}, got {rows}"
    spark.sql(f"INSERT INTO {NESTED} VALUES {insert}")
    rows = read_nested(spark, extra)
    assert rows == old + [new], f"nested rows after the insert: expected {old + [new]}, got {rows}"


def phase_7(spark: SparkSession) -> None:
    check_nested(
        spark,
        "note",
        [(100, "t1", "t2", "v1", "v2", "L1", "C1", None)],
        "(101, array('u1', 'u2'), map('k1', 'w1', 'k2', 'w2'), named_struct('line1', 'M1', 'city', 'D1'), 'n101')",
        (101, "u1", "u2", "w1", "w2", "M1", "D1", "n101"),
    )


def phase_8(spark: SparkSession) -> None:
    check_nested(
        spark,
        "note, addr.zip",
        [
            (100, "t1", "t2", "v1", "v2", "L1", "C1", None, None),
            (101, "u1", "u2", "w1", "w2", "M1", "D1", "n101", None),
        ],
        "(102, array('x1', 'x2'), map('k1', 'y1', 'k2', 'y2'),"
        " named_struct('line1', 'N1', 'zip', 'Z102', 'city', 'E1'), 'n102')",
        (102, "x1", "x2", "y1", "y2", "N1", "E1", "n102", "Z102"),
    )


PHASES = {1: phase_1, 2: phase_2, 3: phase_3, 4: phase_4, 5: phase_5, 7: phase_7, 8: phase_8}

parser = argparse.ArgumentParser()
parser.add_argument("--phase", type=int, choices=sorted(PHASES), required=True)
args = parser.parse_args()

spark = SparkSession.builder.appName(f"verify-evolution-{args.phase}").getOrCreate()
PHASES[args.phase](spark)
spark.stop()
