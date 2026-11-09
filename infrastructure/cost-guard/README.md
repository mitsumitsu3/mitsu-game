# 月5 USD超過時のゲーム停止

既存の `mitsu-game-monthly-budget` の実績額が **5 USDを超えた場合**に、mitsuゲームの処理とWeb配信を止める。5 USDちょうどでは停止しない。

この予算は **AWSアカウント全体**を対象としている。他のプロジェクトの料金で5 USDを超えてもmitsuゲームを停止するが、他のプロジェクトのリソースには変更を加えない。

## 構成と動作

既存のゲーム用スタックとは独立した `mitsu-game-cost-guard` スタックを追加する。既存ゲームのLambdaコードやCloudFormationスタックを再デプロイする必要はない。

```text
既存Budgetsの100%超過通知 ─ SNS ─┐
                              ├─ 停止用Lambda ─ Budgetsの実績確認
EventBridge（1時間ごと）────────┘                   │ 5 USD超
                                                   ▼
                                        SSMに停止フラグを永続化
                                                   │
                 ┌─────────────────────────────────┼───────────────────┐
                 ▼                                 ▼                   ▼
       ゲームLambdaの同時実行数を0        AppSync用IAMロールにDeny    CloudFront無効化
```

具体的な停止対象：

| 対象 | 処理 |
| --- | --- |
| `mitsu-game-resolver` | 予約済み同時実行数を0にして新規実行を拒否 |
| `mitsu-game-cognito-unauth-role` | ゲームAPIへの `appsync:GraphQL` を明示的に拒否 |
| `mitsu-game-appsync-role` | ゲームLambdaの実行とゲームの3テーブルへのアクセスを明示的に拒否 |
| ゲーム用CloudFrontディストリビューション | `Enabled=false`。ETagで競合を検出し、他の設定は維持 |

IAMには `MitsuGameCostGuardDeny` という追加のインラインポリシーを使い、既存ポリシーは上書きしない。DynamoDB/S3のデータ、API、関数は削除しない。

停止フラグは `/mitsu-game/cost-guard/tripped` に記録する。翌月になった場合や返金・クレジットで金額が減った場合も、自動再開しない。一度停止したら、1時間ごとの確認で停止設定を再適用する。ゲーム側の再デプロイで停止設定を変更しないこと。

SNSの本文を金額や停止対象として信用せず、Budgetsの実績値と設定済みリソースのみを使う。一部の停止処理が失敗しても他の処理を試み、エラーを返す。Lambdaの非同期再試行と1時間ごとのチェックで部分失敗を再試行する。

## 制約

- **5 USDという請求上限を保証する仕組みではない。** Budgetsの料金データには遅れがあり、通常の更新は8〜12時間間隔。急増の最中には停止前に大幅に超過する可能性がある。1時間ごとのチェックは料金データの更新自体を早めない。
- IAM変更やCloudFront停止の反映にも時間がかかる。既に実行中のLambdaや成立済みの接続を瞬時に終了させるものではない。
- AppSyncのAPI自体は削除しない。拒否されたアクセスや既存の接続など、課金が完全にゼロになる保証はない。
- S3/DynamoDB/ログの保存料等は残る。Lambda内から呼ぶ **OpenAI APIの料金はAWS Budgetsの集計外**。ゲームLambdaの新規実行停止は以降の呼び出し抑制になるが、OpenAI側の独立した予算管理も必要。
- 予算APIやSSMが利用できない場合、新たな停止判断はできずエラーになる。停止フラグが既に読める場合は予算APIの障害中も停止設定を再適用する。
- 監視用のLambda・EventBridge・SNS・SSM・ログ自体にも利用量に応じた料金があり、アカウント全体の予算に含まれる。Cost Explorerの有料APIを定期実行する構成は使わない。
- ゲーム用Lambdaにはプロビジョニング済み同時実行がないことが前提。AppSyncはIAM認証のみを想定する。新たな認証方式、ゲーム関数、配信経路を増やした場合は停止対象を見直す。

## 検証

必要なのはPython 3.9以上とAWS CLI v2。ローカルへのboto3インストールは不要。実行環境ではLambdaに含まれるboto3を使う。

```bash
python3 -m unittest discover -s infrastructure/cost-guard -p 'test_*.py' -v
```

実環境のリソース探索とCloudFormationテンプレートの検証のみを行う。次のコマンドはAWSリソースを変更しない。

```bash
python3 infrastructure/cost-guard/deploy.py --profile personal-sso
```

`build_template.py` が `handler.py` を埋め込んだCloudFormation JSONを生成する。生成物はコミットせず、Lambdaのソースと定義を同時に更新する。

```bash
python3 infrastructure/cost-guard/build_template.py > /tmp/mitsu-game-cost-guard.json
```

## デプロイ

```bash
python3 infrastructure/cost-guard/deploy.py --profile personal-sso --execute
```

このコマンドは、対象アカウント・既存スタック・予算5 USD・100%超過の既存通知・認証方式・プロビジョニング済み同時実行なしを確認してから：

1. 専用CloudFormationスタックをデプロイする（IAM権限を含む）。API IDとCloudFront IDは既存のゲームスタックから解決する。
2. 既存の100%超過通知にSNS購読先を追加する。既存の4 USD/5 USDのメール通知を維持する。他のSNS購読先がある場合は上書きせず中断する。
3. 停止判定を1回実行する。**既に実績が5 USDを超えていれば、この時点で停止する。**

予算へのSNS購読先追加は、既存予算を置き換えないためデプロイスクリプトから行う。ここで失敗した場合はエラー終了する。スクリプトを再実行して接続を完了すること。時間ごとの停止判定はスタック側にある。

新規インストール時は、ゲームLambdaの同時実行設定、CloudFrontの有効/無効、対象ロールに同名ポリシーがないことを記録しておく。検証時点のゲームLambdaは予約済み同時実行数の設定なし。運用変更があれば復旧時はその変更を尊重する。

### デプロイ後の確認

```bash
aws lambda invoke --profile personal-sso --region ap-northeast-1 \
  --function-name mitsu-game-cost-guard --cli-binary-format raw-in-base64-out \
  --payload '{"mode":"dry-run"}' /tmp/mitsu-game-cost-guard-status.json
cat /tmp/mitsu-game-cost-guard-status.json
```

`FunctionError` がないこと、金額が実績と一致すること、予算未超過・停止フラグなしなら `would_stop=false` であることを確認する。ログは `/aws/lambda/mitsu-game-cost-guard`（14日保存）。失敗時はLambdaの `Errors` メトリクスとログを確認する。

本番ゲームを意図的に停止する試験は、利用者への影響を確認したうえで別途実施する。通知や稼働中の停止処理の実サービスでの完全な試験は、ローカルのモックテストでは代替できない。

## 手動復旧

原因と料金を確認し、予算の最新実績が5 USD以下であることを確認してから復旧する。月が替わった場合も手動操作が必要。5 USD超のまま再開すると、保護を有効に戻した時点で再停止する。

以下のCLIにはすべて `--profile personal-sso --region ap-northeast-1` を指定する。

1. `HourlyRuleName` スタック出力のルールを `aws events disable-rule --name <ルール名>` で無効化し、停止用Lambdaを `aws lambda put-function-concurrency --function-name mitsu-game-cost-guard --reserved-concurrent-executions 0` で止める。実行中の処理が終了するまで最低60秒待つ。
2. `aws iam delete-role-policy --role-name <ロール名> --policy-name MitsuGameCostGuardDeny` で上記2ロールから停止用ポリシーだけを削除する。元から存在するポリシーは変更しない。
3. ゲームLambdaの元の同時実行設定を復元する。元が設定なしなら `aws lambda delete-function-concurrency --function-name mitsu-game-resolver`。元が数値指定ならその数値に戻す。
4. `aws cloudfront get-distribution-config --id <ゲームのID>` で最新設定とETagを取得し、`DistributionConfig.Enabled` を元の値（通常 `true`）に戻す。`aws cloudfront update-distribution --id <ゲームのID> --if-match <ETag> --distribution-config file://<更新JSON>` を実行して反映を待つ。他の設定は維持する。
5. APIとWeb配信の復旧を確認後、`aws ssm delete-parameter --name /mitsu-game/cost-guard/tripped` で停止フラグを解除する。
6. `aws lambda delete-function-concurrency --function-name mitsu-game-cost-guard`、`aws events enable-rule --name <ルール名>` で保護を戻す。`dry-run` と通常の判定を1回ずつ実行し、正常を確認する。

停止用スタックを削除するだけではゲームは再開しない。停止フラグと対象リソースに加えた停止設定は残す設計。機構を撤去する場合は、予算のSNS購読先だけを `aws budgets delete-subscriber` で削除してからスタックを削除する。メール購読先は残す。

## 公式資料

- [AWS Budgetsの更新頻度と通知遅延](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)
- [Budgets向けSNSトピックポリシー](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-sns-policy.html)
- [Lambda同時実行数0による実行停止](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/rel-foundations.html)
- [CloudFrontディストリビューションの更新](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_UpdateDistribution.html)
