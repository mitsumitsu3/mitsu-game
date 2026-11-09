import copy
import json
import sys
import types
import unittest
from unittest.mock import Mock

# Production uses the boto3 bundled in Lambda. Local tests need no dependency
# installation and cannot accidentally make real AWS calls.
try:
    import boto3
    import botocore.exceptions
except ImportError:
    class ClientError(Exception):
        def __init__(self, response, operation_name):
            self.response = response
            super().__init__(response)
    sys.modules["boto3"] = types.ModuleType("boto3")
    sys.modules["botocore"] = types.ModuleType("botocore")
    errors = types.ModuleType("botocore.exceptions")
    errors.ClientError = ClientError
    sys.modules["botocore.exceptions"] = errors

from botocore.exceptions import ClientError
from build_template import build
from handler import run

CONFIG = {
    "ACCOUNT_ID": "123456789012", "BUDGET_NAME": "game-budget", "THRESHOLD_USD": "5",
    "LATCH_PARAMETER": "/game/latched", "API_ARN": "arn:aws:appsync:region:123456789012:apis/game",
    "FUNCTION_ARN": "arn:aws:lambda:region:123456789012:function:game",
    "CLIENT_ROLE": "guest", "APPSYNC_ROLE": "backend", "DISTRIBUTION_ID": "GAME",
    "TABLE_ARNS": "arn:aws:dynamodb:region:123456789012:table/game",
}


def error(code):
    return ClientError({"Error": {"Code": code, "Message": code}}, "Test")


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.clients = {key: Mock() for key in ("ssm", "budgets", "lambda", "iam", "cloudfront")}
        self.clients["ssm"].get_parameter.side_effect = error("ParameterNotFound")
        self.budget = {"TimeUnit": "MONTHLY", "BudgetType": "COST",
                       "CalculatedSpend": {"ActualSpend": {"Amount": "0.001", "Unit": "USD"}}}
        self.clients["budgets"].describe_budget.return_value = {"Budget": self.budget}
        self.distribution = {"Enabled": True, "Comment": "preserve me", "Origins": {"Items": [{"Id": "origin"}]}}
        self.clients["cloudfront"].get_distribution_config.return_value = {
            "ETag": "current-version", "DistributionConfig": copy.deepcopy(self.distribution)}

    def amount(self, amount):
        self.budget["CalculatedSpend"]["ActualSpend"]["Amount"] = amount

    def assert_no_mutations(self):
        self.clients["ssm"].put_parameter.assert_not_called()
        self.clients["lambda"].put_function_concurrency.assert_not_called()
        self.clients["iam"].put_role_policy.assert_not_called()
        self.clients["cloudfront"].update_distribution.assert_not_called()

    def test_below_and_exact_threshold_do_not_stop(self):
        for amount in ("0.001", "4.99", "5", "5.000"):
            with self.subTest(amount=amount):
                self.amount(amount)
                self.assertFalse(run({}, self.clients, CONFIG)["would_stop"])
                self.assert_no_mutations()

    def test_over_threshold_stops_all_layers_without_changing_other_config(self):
        self.amount("5.0001")
        self.assertTrue(run({}, self.clients, CONFIG)["stopped"])
        self.clients["lambda"].put_function_concurrency.assert_called_once_with(
            FunctionName=CONFIG["FUNCTION_ARN"], ReservedConcurrentExecutions=0)
        calls = self.clients["iam"].put_role_policy.call_args_list
        self.assertEqual({call.kwargs["RoleName"] for call in calls}, {"guest", "backend"})
        for call in calls:
            self.assertEqual(call.kwargs["PolicyName"], "MitsuGameCostGuardDeny")
            for statement in json.loads(call.kwargs["PolicyDocument"])["Statement"]:
                self.assertEqual(statement["Effect"], "Deny")
                self.assertNotEqual(statement["Resource"], "*")
        expected = dict(self.distribution, Enabled=False)
        self.clients["cloudfront"].update_distribution.assert_called_once_with(
            Id="GAME", IfMatch="current-version", DistributionConfig=expected)
        self.assertFalse(self.clients["ssm"].put_parameter.call_args.kwargs["Overwrite"])

    def test_dry_run_over_threshold_has_no_writes(self):
        self.amount("999")
        result = run({"mode": "dry-run"}, self.clients, CONFIG)
        self.assertTrue(result["would_stop"])
        self.assertFalse(result["latched"])
        self.assert_no_mutations()

    def test_sns_payload_cannot_override_budget_or_target(self):
        event = {"Records": [{"Sns": {"Message": '{"amount":999,"function":"other"}'}}]}
        self.assertFalse(run(event, self.clients, CONFIG)["would_stop"])
        self.clients["budgets"].describe_budget.assert_called_once_with(
            AccountId=CONFIG["ACCOUNT_ID"], BudgetName=CONFIG["BUDGET_NAME"])
        self.assert_no_mutations()

    def test_latch_remains_stopped_after_rollover_or_billing_outage(self):
        self.clients["ssm"].get_parameter.side_effect = None
        self.clients["ssm"].get_parameter.return_value = {"Parameter": {"Value": '{"tripped_at":"last month"}'}}
        self.clients["budgets"].describe_budget.side_effect = RuntimeError("billing down")
        self.assertTrue(run({}, self.clients, CONFIG)["stopped"])
        self.clients["budgets"].describe_budget.assert_not_called()

    def test_one_failure_does_not_skip_other_controls(self):
        self.amount("6")
        self.clients["lambda"].put_function_concurrency.side_effect = error("AccessDeniedException")
        with self.assertLogs("handler", level="ERROR"), self.assertRaisesRegex(RuntimeError, "Incomplete shutdown"):
            run({}, self.clients, CONFIG)
        self.assertEqual(self.clients["iam"].put_role_policy.call_count, 2)
        self.clients["cloudfront"].update_distribution.assert_called_once()
        self.clients["ssm"].put_parameter.assert_called_once()

    def test_already_disabled_distribution_is_not_updated(self):
        self.amount("6")
        self.clients["cloudfront"].get_distribution_config.return_value["DistributionConfig"]["Enabled"] = False
        run({}, self.clients, CONFIG)
        self.clients["cloudfront"].update_distribution.assert_not_called()

    def test_concurrent_latch_creation_is_safe(self):
        self.amount("6")
        self.clients["ssm"].put_parameter.side_effect = error("ParameterAlreadyExists")
        self.assertTrue(run({}, self.clients, CONFIG)["stopped"])

    def test_cannot_lose_latch_on_ssm_access_failure(self):
        self.clients["ssm"].get_parameter.side_effect = error("AccessDeniedException")
        with self.assertRaises(ClientError):
            run({}, self.clients, CONFIG)
        self.assert_no_mutations()

    def test_invalid_currency_or_nonfinite_amount_cannot_stop_game(self):
        for amount, unit in (("6", "JPY"), ("NaN", "USD"), ("Infinity", "USD")):
            with self.subTest(amount=amount, unit=unit):
                self.budget["CalculatedSpend"]["ActualSpend"] = {"Amount": amount, "Unit": unit}
                with self.assertRaises(ValueError):
                    run({}, self.clients, CONFIG)
                self.assert_no_mutations()

    def test_unhealthy_budget_does_not_trigger_a_new_stop(self):
        self.amount("6")
        self.budget["HealthStatus"] = {"Status": "UNHEALTHY"}
        with self.assertRaises(ValueError):
            run({}, self.clients, CONFIG)
        self.assert_no_mutations()

    def test_persist_failure_prevents_an_unlatched_stop(self):
        self.amount("6")
        self.clients["ssm"].put_parameter.side_effect = error("AccessDeniedException")
        with self.assertRaises(ClientError):
            run({}, self.clients, CONFIG)
        self.clients["lambda"].put_function_concurrency.assert_not_called()

    def test_template_embeds_current_handler_and_limits_write_permissions(self):
        template = build()
        compile(template["Resources"]["GuardFunction"]["Properties"]["Code"]["ZipFile"], "index.py", "exec")
        statements = template["Resources"]["GuardRole"]["Properties"]["Policies"][0]["PolicyDocument"]["Statement"]
        self.assertTrue(all(statement["Resource"] != "*" for statement in statements))
        self.assertNotIn("ce:GetCostAndUsage", json.dumps(statements))
        self.assertNotIn("DynamoDB::Table", json.dumps(template))


if __name__ == "__main__":
    unittest.main()
