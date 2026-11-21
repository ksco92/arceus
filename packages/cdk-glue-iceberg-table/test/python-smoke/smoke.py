import json

import aws_cdk as cdk
from aws_cdk import aws_glue as glue
from aws_cdk import aws_iam as iam
from aws_cdk.assertions import Template
from cdk_glue_iceberg_table import (
    IcebergColumn,
    IcebergFormatVersion,
    IcebergPartitionField,
    IcebergPartitionTransform,
    IcebergSortDirection,
    IcebergSortField,
    IcebergStructFieldDefinition,
    IcebergTable,
    IcebergType,
)

stack = cdk.Stack(cdk.App(), "Smoke", env=cdk.Environment(account="123456789012", region="us-east-1"))
table = IcebergTable(
    stack,
    "Events",
    database=glue.Database(stack, "Db", database_name="analytics"),
    table_name="events",
    location="s3://smoke-warehouse/events/",
    columns=[
        IcebergColumn(id=1, name="id", type=IcebergType.LONG, required=True),
        IcebergColumn(
            id=2,
            name="payload",
            type=IcebergType.struct([IcebergStructFieldDefinition(id=3, name="kind", type=IcebergType.STRING)]),
        ),
        IcebergColumn(id=4, name="occurred_at", type=IcebergType.TIMESTAMP),
    ],
    partition_spec=[
        IcebergPartitionField(source_column="occurred_at", transform=IcebergPartitionTransform.DAY, field_id=1000),
    ],
    sort_order=[IcebergSortField(source_column="id", direction=IcebergSortDirection.ASC)],
    format_version=IcebergFormatVersion.V2,
)
table.grant_read(iam.Role(stack, "Reader", assumed_by=iam.ServicePrincipal("lambda.amazonaws.com")))

resources = Template.from_stack(stack).to_json()["Resources"].values()
(glue_table,) = [r["Properties"] for r in resources if r["Type"] == "AWS::Glue::Table"]
(policy,) = [r["Properties"] for r in resources if r["Type"] == "AWS::IAM::Policy"]
iceberg = glue_table["OpenTableFormatInput"]["IcebergInput"]
table_input = iceberg["IcebergTableInput"]
payload = next(f for f in table_input["Schema"]["Fields"] if f["Name"] == "payload")
partition = table_input["PartitionSpec"]["Fields"][0]
(read,) = [s for s in policy["PolicyDocument"]["Statement"] if "glue:GetTable" in s["Action"]]

assert glue_table["Name"] == "events"
assert iceberg["Version"] == "2"
assert json.loads(payload["Type"])["fields"][0]["id"] == 3
assert (partition["FieldId"], partition["Transform"]) == (1000, "day")
assert len(read["Resource"]) == 3
