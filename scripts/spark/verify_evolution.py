"""Run the engine-side checks for one step of integration-test-evolution.sh."""
import argparse

from pyspark.sql import SparkSession

TABLE = "glue.sample_database.evolution_test"


def expect(label: str, expected: object, actual: object) -> None:
    if expected != actual:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def expect_min_rows(spark: SparkSession, query: str, minimum: int) -> None:
    rows = spark.sql(query).collect()
    if len(rows) < minimum:
        raise AssertionError(f"expected at least {minimum} rows, got {len(rows)}: {rows}")


def phase_1(spark: SparkSession) -> None:
    spark.sql(
        f"""INSERT INTO {TABLE} VALUES
        (10, 'a@example.com', TIMESTAMP '2026-01-01 09:00:00+00:00'),
        (11, 'b@example.com', TIMESTAMP '2026-01-02 09:00:00+00:00'),
        (12, 'c@example.com', TIMESTAMP '2026-01-03 09:00:00+00:00')"""
    )


def phase_2(spark: SparkSession) -> None:
    rows = spark.sql(f"SELECT customer_id, region FROM {TABLE} ORDER BY customer_id").collect()
    expect("pre-existing rows", [(10, None), (11, None), (12, None)], [tuple(r) for r in rows])
    spark.sql(f"INSERT INTO {TABLE} VALUES (13, 'd@example.com', TIMESTAMP '2026-02-01 09:00:00+00:00', 'us-east-1')")


def phase_3(spark: SparkSession) -> None:
    rows = spark.sql(f"SELECT contact_email FROM {TABLE} WHERE customer_id = 10").collect()
    expect("contact_email for customer_id 10", [("a@example.com",)], [tuple(r) for r in rows])


def phase_4(spark: SparkSession) -> None:
    expect_min_rows(spark, f"SELECT customer_id, contact_email FROM {TABLE} ORDER BY customer_id", 4)


def phase_5(spark: SparkSession) -> None:
    spark.sql(f"INSERT INTO {TABLE} VALUES (14, 'e@example.com', TIMESTAMP '2026-03-05 09:00:00+00:00')")
    expect_min_rows(spark, f"SELECT customer_id FROM {TABLE} ORDER BY customer_id", 5)


PHASES = {1: phase_1, 2: phase_2, 3: phase_3, 4: phase_4, 5: phase_5}

parser = argparse.ArgumentParser()
parser.add_argument("--phase", type=int, choices=sorted(PHASES), required=True)
args = parser.parse_args()

spark = SparkSession.builder.appName(f"verify-evolution-{args.phase}").getOrCreate()
PHASES[args.phase](spark)
spark.stop()
