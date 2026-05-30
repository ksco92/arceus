# Integration test setup

`.github/workflows/integ-test.yml` drives
`scripts/integration-test-evolution.sh` against real AWS — four real
`cdk deploy`s exercising column and partition evolution through the
`IcebergTable` construct. The workflow runs when:

- a PR is labeled `run-integ-test`, OR
- a repo collaborator comments `/run-integ-test` on a PR, OR
- the workflow is manually dispatched from the Actions tab.

To make this work, two things have to exist in the AWS account that
the test deploys to (200400004453 today):

1. A **GitHub OIDC identity provider** registered with IAM (one-time
   per account).
2. An **IAM role** the workflow can assume, trust-policied to this
   repository and permission-policied for what the integ test does.

The ARN of that role goes into the `AWS_INTEG_ROLE_ARN` **repository
variable** (Settings → Secrets and variables → Actions → Variables →
New repository variable). Variables, not secrets — the ARN isn't
sensitive and putting it in `vars.` keeps it readable in logs for
debugging.

## 1. OIDC provider (one-time)

If `https://token.actions.githubusercontent.com` isn't already in
IAM → Identity providers, create it:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

(The thumbprint is GitHub's; if AWS docs ever publish a different one,
use that. Recent AWS releases also accept omitting `--thumbprint-list`
entirely — the IAM service validates against GitHub's known certs.)

## 2. The IAM role

### Trust policy

Replace `200400004453` with the account ID you're deploying to.
`repo:ksco92/arceus:*` scopes the role to any branch or PR of this
repo — tighten to `repo:ksco92/arceus:ref:refs/heads/main` if you
only ever want main to assume.

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": "arn:aws:iam::200400004453:oidc-provider/token.actions.githubusercontent.com"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
                },
                "StringLike": {
                    "token.actions.githubusercontent.com:sub": "repo:ksco92/arceus:*"
                }
            }
        }
    ]
}
```

### Permissions policy

The integration test does the following AWS actions:

| Service | Why |
| --- | --- |
| CloudFormation | Create / update / delete `IcebergEvolutionStack`. |
| IAM (PassRole) | Pass the CDK bootstrap roles to CloudFormation. |
| S3 | Read + write the data lake bucket; read + write the Athena results bucket. |
| Glue | Read database + table metadata; the Iceberg table writes go through the `OpenTableFormatInput` path. |
| Lake Formation | Read settings + grant the test table to the developer principal. |
| Athena | Start queries, poll status, fetch results. |
| KMS | Encrypt / decrypt the bucket KMS keys. |
| SSM | Read `/cdk-bootstrap/hnb659fds/version` parameter. |
| STS | `GetCallerIdentity` for the script. |

The simplest correct policy attaches the AWS-managed
`PowerUserAccess` (no IAM management, everything else) plus an
inline policy granting only `iam:PassRole` to the CDK bootstrap
roles. Attach both to the role:

```bash
ROLE_NAME=ArceusIntegTestRole

aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
```

Inline policy (`iam-passrole.json`):

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": "iam:PassRole",
            "Resource": [
                "arn:aws:iam::200400004453:role/cdk-hnb659fds-cfn-exec-role-200400004453-us-east-1",
                "arn:aws:iam::200400004453:role/cdk-hnb659fds-deploy-role-200400004453-us-east-1",
                "arn:aws:iam::200400004453:role/cdk-hnb659fds-file-publishing-role-200400004453-us-east-1",
                "arn:aws:iam::200400004453:role/cdk-hnb659fds-image-publishing-role-200400004453-us-east-1",
                "arn:aws:iam::200400004453:role/cdk-hnb659fds-lookup-role-200400004453-us-east-1"
            ]
        }
    ]
}
```

```bash
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name CdkBootstrapPassRole \
  --policy-document file://iam-passrole.json
```

If you'd rather not use `PowerUserAccess` (it's wide), the alternative
is a hand-written policy granting `cloudformation:*`, `s3:*`,
`glue:*`, `lakeformation:*`, `athena:*`, `kms:*`, `ssm:GetParameter`,
`sts:GetCallerIdentity`, and `iam:PassRole` on the bootstrap roles.
Same blast radius, more typing — useful only if you also want to
scope each `Resource:` line. For a single-purpose integ-test role in
a sandbox account, `PowerUserAccess` is the standard.

### Create the role

```bash
aws iam create-role \
  --role-name ArceusIntegTestRole \
  --assume-role-policy-document file://trust-policy.json

aws iam attach-role-policy \
  --role-name ArceusIntegTestRole \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess

aws iam put-role-policy \
  --role-name ArceusIntegTestRole \
  --policy-name CdkBootstrapPassRole \
  --policy-document file://iam-passrole.json
```

### Wire it to GitHub

The role ARN looks like
`arn:aws:iam::200400004453:role/ArceusIntegTestRole`. Add it to the
repo:

- Settings → Secrets and variables → Actions → **Variables** tab →
  **New repository variable**
- Name: `AWS_INTEG_ROLE_ARN`
- Value: the ARN

The workflow reads it via `${{ vars.AWS_INTEG_ROLE_ARN }}`.

## Run the test

- **From a PR (label)**: open the PR → Labels → add `run-integ-test`.
- **From a PR (comment)**: post a new PR comment containing exactly
  `/run-integ-test`.
- **Manually**: Actions tab → "Integration test" → Run workflow.

The workflow comments back on the PR with success / failure plus a
link to the run logs. The script teardown step (`DESTROY=1`) deletes
the `IcebergEvolutionStack` at the end so the account is left clean.
