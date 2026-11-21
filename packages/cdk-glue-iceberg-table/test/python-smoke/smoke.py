import aws_cdk as cdk
from aws_cdk import aws_iam as iam
from aws_cdk.assertions import Template
from aws_cdk.aws_glue import Database
from aws_cdk.aws_s3 import Bucket
from cdk_glue_iceberg_table import (
    IcebergColumn,
    IcebergFormatVersion,
    IcebergPartitionField,
    IcebergPartitionTransform,
    IcebergTable,
    IcebergType,
)

stack = cdk.Stack(cdk.App(), "Smoke", env=cdk.Environment(account="123456789012", region="us-east-1"))

bucket = Bucket(stack, "Warehouse")
db = Database(stack, "Db", database_name="analytics")

table = IcebergTable(stack, "OrdersTable",
    database=db,
    table_name="orders",
    location=f"s3://{bucket.bucket_name}/analytics/orders/",
    columns=[
        IcebergColumn(name="order_id", type=IcebergType.LONG, required=True, id=1),
        IcebergColumn(name="customer_id", type=IcebergType.LONG, required=True, id=2),
        IcebergColumn(name="placed_at", type=IcebergType.TIMESTAMPTZ, required=True, id=3),
    ],
    partition_spec=[
        IcebergPartitionField(source_column="placed_at", transform=IcebergPartitionTransform.DAY, field_id=1000),
        IcebergPartitionField(source_column="customer_id", transform=IcebergPartitionTransform.bucket(16), field_id=1001),
    ],
    identifier_field_names=["order_id"],
    format_version=IcebergFormatVersion.V2,
)
table.grant_read(iam.Role(stack, "Reader", assumed_by=iam.ServicePrincipal("lambda.amazonaws.com")))

resources = Template.from_stack(stack).to_json()["Resources"].values()
(glue_table,) = [r["Properties"] for r in resources if r["Type"] == "AWS::Glue::Table"]
(policy,) = [r["Properties"] for r in resources if r["Type"] == "AWS::IAM::Policy"]
iceberg = glue_table["OpenTableFormatInput"]["IcebergInput"]
table_input = iceberg["IcebergTableInput"]
bucket_field = table_input["PartitionSpec"]["Fields"][1]
(read,) = [s for s in policy["PolicyDocument"]["Statement"] if "glue:GetTable" in s["Action"]]

assert glue_table["Name"] == "orders"
assert iceberg["Version"] == "2"
assert (bucket_field["FieldId"], bucket_field["Transform"]) == (1001, "bucket[16]")
assert table_input["Schema"]["IdentifierFieldIds"] == [1]
assert len(read["Resource"]) == 3
