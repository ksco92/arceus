# Integration test setup

`.github/workflows/integ-test.yml` drives
`scripts/integration-test-evolution.sh` against real AWS — four real
`cdk deploy`s exercising column and partition evolution through the
`IcebergTable` construct. The workflow runs when:

- a PR is labeled `run-integ-test` **and the PR's head branch is on the same repo** (fork PRs are refused at the workflow's gate; use `workflow_dispatch` after manual review of the diff), OR
- a repo collaborator comments `/run-integ-test` on a PR, OR
- the workflow is manually dispatched from the Actions tab.

## Security note

The workflow checks out PR-supplied code and runs it (`npm ci`, `npm test`, `bash scripts/integration-test-evolution.sh`) with **cloud-admin AWS credentials**. Same-repo PRs are auto-trusted because only collaborators can push to them. Fork PRs are refused at the gate; if you want to run the workflow against a fork PR, manually `workflow_dispatch` after auditing every file in the diff — especially `package.json` (postinstall scripts), `scripts/integration-test-evolution.sh`, and `bin/arceus.ts`.

## Prerequisites

The integ-test workflow assumes two things already exist in the target AWS account:

1. **`ArceusStack` is deployed.** `IcebergEvolutionStack` (the stack the workflow deploys) imports the data lake bucket (`data-lake-bucket-<account>`) and the Glue database (`sample_database`) — both owned by `ArceusStack`. From a clean checkout of this repo:

   ```bash
   export DEVELOPER_IAM_USER=<your-iam-user-name>
   npm ci
   npm run build
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1   # one-time per account/region
   npx cdk deploy ArceusStack
   ```

2. **The account is `cdk bootstrap`ped** (covered by the bootstrap command above). The inline IAM policy below references the five `cdk-hnb659fds-*` roles that bootstrap creates; without them, `iam:PassRole` has nothing to point at.

3. **The OIDC role is a Lake Formation data lake admin.** `ArceusStack` enables Lake Formation on the data lake, and Lake Formation gates `glue:GetTable` independently of IAM. The workflow's verify-step Athena calls need `Describe` on the table, which the OIDC role only gets implicitly by being a data lake admin. Without it, the very first verify step after the first `cdk deploy` fails with `AccessDeniedException ... Required Describe on evolution_test`. Add the role once after creating it:

   ```bash
   aws lakeformation get-data-lake-settings --region us-east-1 > /tmp/lf.json
   # Edit /tmp/lf.json to append:
   #   { "DataLakePrincipalIdentifier": "arn:aws:iam::<ACCOUNT_ID>:role/ArceusIntegTestRole" }
   # to DataLakeSettings.DataLakeAdmins, then:
   aws lakeformation put-data-lake-settings --region us-east-1 --cli-input-json file:///tmp/lf.json
   ```

## What needs to exist in AWS for the workflow itself

In addition to the prereqs above:

1. A **GitHub OIDC identity provider** registered with IAM (one-time per account).
2. An **IAM role** the workflow can assume, trust-policied to this repository and permission-policied for what the integ test does.

The ARN of that role goes into the `AWS_INTEG_ROLE_ARN` **repository variable** (Settings → Secrets and variables → Actions → Variables → New repository variable). Variables, not secrets — the ARN isn't sensitive and putting it in `vars.` keeps it readable in logs for debugging.

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

Replace `<ACCOUNT_ID>` with the account ID you're deploying to.
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
                "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
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
                "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-cfn-exec-role-<ACCOUNT_ID>-us-east-1",
                "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-deploy-role-<ACCOUNT_ID>-us-east-1",
                "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-file-publishing-role-<ACCOUNT_ID>-us-east-1",
                "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-image-publishing-role-<ACCOUNT_ID>-us-east-1",
                "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-lookup-role-<ACCOUNT_ID>-us-east-1"
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
`arn:aws:iam::<ACCOUNT_ID>:role/ArceusIntegTestRole`. Add it to the
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
