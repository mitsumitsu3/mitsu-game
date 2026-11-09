"""Discover existing game resources, validate, then optionally deploy the guard."""

import argparse
import json
import subprocess
import tempfile
from decimal import Decimal
from pathlib import Path

from build_template import build


def aws(args, *command, region=None):
    output = subprocess.check_output([
        "aws", "--profile", args.profile, "--region", region or args.region,
        "--no-cli-pager", "--output", "json", *command,
    ], text=True)
    return json.loads(output) if output.strip() else {}


def resources(args, stack):
    # CLI pagination remains enabled; do not truncate resources with --no-paginate.
    response = aws(args, "cloudformation", "list-stack-resources", "--stack-name", stack)
    return {item["LogicalResourceId"]: item["PhysicalResourceId"]
            for item in response["StackResourceSummaries"]}


def deploy(args):
    account = aws(args, "sts", "get-caller-identity")["Account"]
    budget = aws(args, "budgets", "describe-budget", "--account-id", account,
                 "--budget-name", args.budget, region="us-east-1")["Budget"]
    if (budget["TimeUnit"] != "MONTHLY" or budget["BudgetType"] != "COST"
            or budget["BudgetLimit"]["Unit"] != "USD"
            or Decimal(budget["BudgetLimit"]["Amount"]) != Decimal("5")):
        raise ValueError("Expected the existing USD 5 monthly cost budget")
    if budget.get("CostFilters") or budget.get("FilterExpression"):
        raise ValueError("Expected an unfiltered account-wide budget")
    notification = {"NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN",
                    "Threshold": 100, "ThresholdType": "PERCENTAGE"}
    subscribers = aws(args, "budgets", "describe-subscribers-for-notification",
                      "--account-id", account, "--budget-name", args.budget,
                      "--notification", json.dumps(notification), region="us-east-1")["Subscribers"]
    backend = resources(args, args.backend_stack)
    frontend = resources(args, args.frontend_stack)
    api_id = backend["AppSyncApi"].split("/")[-1]
    function = backend["ResolverFunction"]
    api = aws(args, "appsync", "get-graphql-api", "--api-id", api_id)["graphqlApi"]
    if api["authenticationType"] != "AWS_IAM" or api.get("additionalAuthenticationProviders"):
        raise ValueError("Guard requires IAM-only AppSync authentication")
    if aws(args, "lambda", "list-provisioned-concurrency-configs", "--function-name", function)["ProvisionedConcurrencyConfigs"]:
        raise ValueError("Remove game provisioned concurrency before using this guard")
    parameters = {
        "BudgetName": args.budget, "GameFunctionName": function,
        "ClientRoleName": backend["CognitoUnauthRole"],
        "AppSyncRoleName": backend["AppSyncServiceRole"],
        "ApiId": api_id, "DistributionId": frontend["CloudFrontDistribution"],
    }
    expected_tables = {"RoomTable": "mitsu-game-rooms", "PlayerTable": "mitsu-game-players",
                       "AnswerTable": "mitsu-game-answers"}
    if any(backend.get(key) != value for key, value in expected_tables.items()):
        raise ValueError("Unexpected game table names; update the template before deploying")
    if not any(item["SubscriptionType"] == "EMAIL" for item in subscribers):
        raise ValueError("Keep an existing USD 5 email notification configured")

    with tempfile.TemporaryDirectory(prefix="mitsu-game-cost-guard-") as temporary:
        template = Path(temporary) / "cloudformation.json"
        template.write_text(json.dumps(build(), indent=2))
        aws(args, "cloudformation", "validate-template", "--template-body", "file://" + str(template))
        print(json.dumps({"account": account, "parameters": parameters,
                          "existing_subscribers": subscribers, "execute": args.execute}, indent=2))
        if not args.execute:
            print("Read-only validation passed. Use --execute to deploy and connect the budget.")
            return

        # An existing SNS subscriber must never be replaced silently.
        stack = aws(args, "cloudformation", "list-stacks", "--stack-status-filter",
                    "CREATE_COMPLETE", "UPDATE_COMPLETE")
        existing = next((item for item in stack["StackSummaries"] if item["StackName"] == args.stack), None)
        old_topic = None
        if existing:
            outputs = aws(args, "cloudformation", "describe-stacks", "--stack-name", args.stack)["Stacks"][0]["Outputs"]
            old_topic = next(item["OutputValue"] for item in outputs if item["OutputKey"] == "BudgetTopicArn")
        sns = [item["Address"] for item in subscribers if item["SubscriptionType"] == "SNS"]
        if sns and sns != [old_topic]:
            raise ValueError("Budget already has another SNS subscriber; refusing to replace it")

        subprocess.run([
            "aws", "--profile", args.profile, "--region", args.region, "--no-cli-pager",
            "cloudformation", "deploy", "--stack-name", args.stack,
            "--template-file", str(template), "--capabilities", "CAPABILITY_IAM",
            "--no-fail-on-empty-changeset", "--parameter-overrides",
            *[f"{key}={value}" for key, value in parameters.items()],
        ], check=True)
        outputs = aws(args, "cloudformation", "describe-stacks", "--stack-name", args.stack)["Stacks"][0]["Outputs"]
        topic = next(item["OutputValue"] for item in outputs if item["OutputKey"] == "BudgetTopicArn")
        if not sns:
            aws(args, "budgets", "create-subscriber", "--account-id", account,
                "--budget-name", args.budget, "--notification", json.dumps(notification),
                "--subscriber", json.dumps({"SubscriptionType": "SNS", "Address": topic}), region="us-east-1")
        # Run once now; no need to wait for an SNS event or the hourly rule.
        response = Path(temporary) / "response.json"
        invocation = aws(args, "lambda", "invoke", "--function-name", args.stack,
                         "--cli-binary-format", "raw-in-base64-out", "--payload", '{"mode":"enforce"}', str(response))
        print(response.read_text())
        if invocation.get("FunctionError"):
            raise RuntimeError("Guard invocation failed; inspect CloudWatch logs before considering deployment complete")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default="personal-sso")
    parser.add_argument("--region", default="ap-northeast-1")
    parser.add_argument("--budget", default="mitsu-game-monthly-budget")
    parser.add_argument("--backend-stack", default="mitsu-game-backend-stack")
    parser.add_argument("--frontend-stack", default="mitsu-game-stack")
    parser.add_argument("--stack", default="mitsu-game-cost-guard")
    parser.add_argument("--execute", action="store_true", help="Deploy and connect the existing budget; otherwise read-only")
    deploy(parser.parse_args())
