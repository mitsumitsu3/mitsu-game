"""Latch the game off when the existing account-wide monthly budget exceeds USD 5."""

import json
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

LOG = logging.getLogger(__name__)
LOG.setLevel(logging.INFO)


def read_latch(ssm, parameter):
    try:
        return json.loads(ssm.get_parameter(Name=parameter)["Parameter"]["Value"])
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ParameterNotFound":
            raise
        return None


def shutdown(clients, config):
    """Attempt every independent control even if another one fails; retries are safe."""
    api = config["API_ARN"]
    tables = config["TABLE_ARNS"].split(",")
    policies = {
        config["CLIENT_ROLE"]: [{
            "Effect": "Deny", "Action": "appsync:GraphQL", "Resource": api + "/*",
        }],
        config["APPSYNC_ROLE"]: [
            {"Effect": "Deny", "Action": "lambda:InvokeFunction",
             "Resource": [config["FUNCTION_ARN"], config["FUNCTION_ARN"] + ":*"]},
            {"Effect": "Deny", "Action": "dynamodb:*",
             "Resource": tables + [arn + "/index/*" for arn in tables]},
        ],
    }
    errors = []

    def attempt(name, action):
        try:
            action()
            LOG.info("Control applied: %s", name)
        except Exception as exc:
            LOG.exception("Control failed: %s", name)
            errors.append(f"{name}: {type(exc).__name__}")

    # Stop paid compute first, then direct API access and the public website.
    attempt("lambda", lambda: clients["lambda"].put_function_concurrency(
        FunctionName=config["FUNCTION_ARN"], ReservedConcurrentExecutions=0))
    for role, statements in policies.items():
        attempt(role, lambda role=role, statements=statements: clients["iam"].put_role_policy(
            RoleName=role, PolicyName="MitsuGameCostGuardDeny",
            PolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": statements})))

    def disable_distribution():
        current = clients["cloudfront"].get_distribution_config(Id=config["DISTRIBUTION_ID"])
        distribution = current["DistributionConfig"]
        if distribution["Enabled"]:
            distribution["Enabled"] = False
            clients["cloudfront"].update_distribution(
                Id=config["DISTRIBUTION_ID"], IfMatch=current["ETag"],
                DistributionConfig=distribution)

    attempt("cloudfront", disable_distribution)
    if errors:
        # SNS/Lambda retries and the hourly check retry partially failed shutdowns.
        raise RuntimeError("Incomplete shutdown: " + "; ".join(errors))


def run(event, clients, config):
    # SNS payloads never supply resource IDs, amounts or thresholds. All decisions
    # use the configured budget and the AWS-side persistent latch.
    mode = event.get("mode", "enforce")
    if mode not in ("enforce", "dry-run"):
        raise ValueError("Unsupported mode")
    latch = read_latch(clients["ssm"], config["LATCH_PARAMETER"])
    threshold = Decimal(config["THRESHOLD_USD"])
    spend = None
    if latch is None:
        budget = clients["budgets"].describe_budget(
            AccountId=config["ACCOUNT_ID"], BudgetName=config["BUDGET_NAME"])["Budget"]
        if budget["TimeUnit"] != "MONTHLY" or budget["BudgetType"] != "COST":
            raise ValueError("Expected a monthly cost budget")
        if budget.get("HealthStatus", {}).get("Status", "HEALTHY") != "HEALTHY":
            raise ValueError("Budget data is unhealthy")
        actual = budget["CalculatedSpend"]["ActualSpend"]
        if actual["Unit"] != "USD":
            raise ValueError("Expected USD budget data")
        spend = Decimal(actual["Amount"])
        if not spend.is_finite() or not threshold.is_finite() or threshold <= 0:
            raise ValueError("Invalid budget amount or threshold")
        should_stop = spend > threshold
    else:
        # Never restart automatically, including after a month rolls over, a
        # credit reduces spend, or the billing API is temporarily unavailable.
        should_stop = True

    result = {"mode": mode, "latched": latch is not None,
              "actual_usd": str(spend) if spend is not None else None,
              "threshold_usd": str(threshold), "would_stop": should_stop}
    if mode == "dry-run" or not should_stop:
        LOG.info("Budget check: %s", json.dumps(result))
        return result

    if latch is None:
        latch = {"tripped_at": datetime.now(timezone.utc).isoformat(),
                 "actual_usd": str(spend), "threshold_usd": str(threshold),
                 "budget_name": config["BUDGET_NAME"]}
        try:
            clients["ssm"].put_parameter(Name=config["LATCH_PARAMETER"], Type="String",
                                        Value=json.dumps(latch), Overwrite=False)
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ParameterAlreadyExists":
                raise
            # A simultaneous invocation already persisted the same shutdown decision.

    shutdown(clients, config)
    result.update(latched=True, stopped=True)
    LOG.warning("Game stopped: %s", json.dumps(result))
    return result


def handler(event, context):
    region = os.environ["AWS_REGION"]
    clients = {name: boto3.client(name, region_name=("us-east-1" if name == "budgets" else region))
               for name in ("ssm", "budgets", "lambda", "iam", "cloudfront")}
    return run(event, clients, os.environ)
