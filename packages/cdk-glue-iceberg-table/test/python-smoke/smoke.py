import re
from pathlib import Path

import aws_cdk as cdk
from aws_cdk import aws_iam as iam
from aws_cdk.assertions import Template

readme = (Path(__file__).resolve().parents[2] / "README.md").read_text()
samples = [b for b in re.findall(r"```python\n(.*?)```", readme, re.S) if "IcebergTable(" in b]
assert len(samples) == 2, "expected the main and the format version 3 examples"

stack = cdk.Stack(cdk.App(), "Smoke", env=cdk.Environment(account="123456789012", region="us-east-1"))
namespace = {"self": stack}
for sample in samples:
    exec(sample, namespace)

orders = stack.node.find_child("OrdersTable")
orders.grant_read(iam.Role(stack, "Reader", assumed_by=iam.ServicePrincipal("lambda.amazonaws.com")))

resources = Template.from_stack(stack).to_json()["Resources"].values()
tables = {r["Properties"]["Name"]: r["Properties"] for r in resources if r["Type"] == "AWS::Glue::Table"}
(policy,) = [r["Properties"] for r in resources if r["Type"] == "AWS::IAM::Policy"]
iceberg = tables["orders"]["OpenTableFormatInput"]["IcebergInput"]
table_input = iceberg["IcebergTableInput"]
bucket_field = table_input["PartitionSpec"]["Fields"][1]
(read,) = [s for s in policy["PolicyDocument"]["Statement"] if "glue:GetTable" in s["Action"]]

assert iceberg["Version"] == "2"
assert (bucket_field["FieldId"], bucket_field["Transform"]) == (1001, "bucket[16]")
assert table_input["Schema"]["IdentifierFieldIds"] == [1]
assert len(read["Resource"]) == 3
assert tables["events"]["OpenTableFormatInput"]["IcebergInput"]["Version"] == "3"
