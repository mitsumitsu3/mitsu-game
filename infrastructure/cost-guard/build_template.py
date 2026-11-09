"""Generate a deployable CloudFormation template with inline Lambda source."""

import json
from pathlib import Path


def build():
    sub = lambda value: {"Fn::Sub": value}
    ref = lambda name: {"Ref": name}
    arn = lambda name: {"Fn::GetAtt": [name, "Arn"]}
    budget_arn = sub("arn:${AWS::Partition}:budgets::${AWS::AccountId}:budget/${BudgetName}")
    function_arn = sub("arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:${GameFunctionName}")
    role_arns = [sub("arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${" + name + "}")
                 for name in ("ClientRoleName", "AppSyncRoleName")]
    statement = lambda actions, resources: {"Effect": "Allow", "Action": actions, "Resource": resources}
    parameters = {
        "BudgetName": "mitsu-game-monthly-budget", "GameFunctionName": "mitsu-game-resolver",
        "ClientRoleName": "mitsu-game-cognito-unauth-role", "AppSyncRoleName": "mitsu-game-appsync-role",
    }
    resources = {
        "BudgetTopic": {"Type": "AWS::SNS::Topic"},
        "BudgetTopicPolicy": {"Type": "AWS::SNS::TopicPolicy", "Properties": {
            "Topics": [ref("BudgetTopic")], "PolicyDocument": {
                "Version": "2012-10-17", "Statement": [{
                    "Effect": "Allow", "Principal": {"Service": "budgets.amazonaws.com"},
                    "Action": "sns:Publish", "Resource": ref("BudgetTopic"),
                    "Condition": {"StringEquals": {"aws:SourceAccount": ref("AWS::AccountId")},
                                  "ArnEquals": {"aws:SourceArn": budget_arn}},
                }],
            }}},
        "GuardRole": {"Type": "AWS::IAM::Role", "Properties": {
            "AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{
                "Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole"}]},
            "Policies": [{"PolicyName": "CostGuard", "PolicyDocument": {
                "Version": "2012-10-17", "Statement": [
                    statement(["budgets:ViewBudget"], budget_arn),
                    statement(["ssm:GetParameter", "ssm:PutParameter"],
                              sub("arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter${LatchParameter}")),
                    statement(["lambda:PutFunctionConcurrency"], function_arn),
                    statement(["iam:PutRolePolicy"], role_arns),
                    statement(["cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution"],
                              sub("arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${DistributionId}")),
                    statement(["logs:CreateLogStream", "logs:PutLogEvents"],
                              sub("arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}:*")),
                ]}}],
        }},
        "GuardLogGroup": {"Type": "AWS::Logs::LogGroup", "Properties": {
            "LogGroupName": sub("/aws/lambda/${AWS::StackName}"), "RetentionInDays": 14}},
        "GuardFunction": {"Type": "AWS::Lambda::Function", "DependsOn": "GuardLogGroup", "Properties": {
            "FunctionName": ref("AWS::StackName"), "Runtime": "python3.13", "Handler": "index.handler",
            "Role": arn("GuardRole"), "MemorySize": 128, "Timeout": 60,
            "Code": {"ZipFile": Path(__file__).with_name("handler.py").read_text()},
            "Environment": {"Variables": {
                "ACCOUNT_ID": ref("AWS::AccountId"), "BUDGET_NAME": ref("BudgetName"),
                "THRESHOLD_USD": ref("ThresholdUsd"), "LATCH_PARAMETER": ref("LatchParameter"),
                "FUNCTION_ARN": function_arn, "CLIENT_ROLE": ref("ClientRoleName"),
                "APPSYNC_ROLE": ref("AppSyncRoleName"), "DISTRIBUTION_ID": ref("DistributionId"),
                "API_ARN": sub("arn:${AWS::Partition}:appsync:${AWS::Region}:${AWS::AccountId}:apis/${ApiId}"),
                "TABLE_ARNS": sub("arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/mitsu-game-rooms,arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/mitsu-game-players,arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/mitsu-game-answers"),
            }},
        }},
        "BudgetInvokePermission": {"Type": "AWS::Lambda::Permission", "Properties": {
            "FunctionName": ref("GuardFunction"), "Action": "lambda:InvokeFunction",
            "Principal": "sns.amazonaws.com", "SourceArn": ref("BudgetTopic"),
            "SourceAccount": ref("AWS::AccountId")}},
        "BudgetSubscription": {"Type": "AWS::SNS::Subscription", "DependsOn": "BudgetInvokePermission", "Properties": {
            "Protocol": "lambda", "Endpoint": arn("GuardFunction"), "TopicArn": ref("BudgetTopic")}},
        "HourlyCheck": {"Type": "AWS::Events::Rule", "Properties": {
            "ScheduleExpression": "rate(1 hour)", "State": "ENABLED",
            "Targets": [{"Id": "Guard", "Arn": arn("GuardFunction"), "Input": '{"mode":"enforce"}',
                         "RetryPolicy": {"MaximumRetryAttempts": 2, "MaximumEventAgeInSeconds": 3600}}]}},
        "HourlyInvokePermission": {"Type": "AWS::Lambda::Permission", "Properties": {
            "FunctionName": ref("GuardFunction"), "Action": "lambda:InvokeFunction",
            "Principal": "events.amazonaws.com", "SourceArn": arn("HourlyCheck"),
            "SourceAccount": ref("AWS::AccountId")}},
    }
    return {
        "AWSTemplateFormatVersion": "2010-09-09",
        "Description": "Mitsu Game: latch game off above existing monthly account budget threshold",
        "Parameters": {
            **{key: {"Type": "String", "Default": value} for key, value in parameters.items()},
            "ApiId": {"Type": "String", "AllowedPattern": "[a-z0-9]+"},
            "DistributionId": {"Type": "String", "AllowedPattern": "[A-Z0-9]+"},
            "ThresholdUsd": {"Type": "String", "Default": "5", "AllowedPattern": "[0-9]+(\\.[0-9]+)?"},
            "LatchParameter": {"Type": "String", "Default": "/mitsu-game/cost-guard/tripped"},
        },
        "Resources": resources,
        "Outputs": {"BudgetTopicArn": {"Value": ref("BudgetTopic")},
                    "GuardFunctionName": {"Value": ref("GuardFunction")},
                    "HourlyRuleName": {"Value": ref("HourlyCheck")}},
    }


if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
