# Infrastructure

認識合わせゲームのAWSインフラストラクチャ定義とデプロイスクリプトです。

## ファイル構成

- `cloudformation.yaml` - CloudFormationテンプレート（S3 + CloudFront）
- `deploy-infra.sh` - インフラストラクチャデプロイスクリプト
- `deploy-frontend.sh` - フロントエンドデプロイスクリプト
- `.deploy-config` - デプロイ設定（自動生成、Gitには含まれません）

## アーキテクチャ

### リソース構成

```
┌─────────────────┐
│   CloudFront    │  ← HTTPSでコンテンツ配信
│  Distribution   │
└────────┬────────┘
         │ OAI (Origin Access Identity)
         ↓
┌─────────────────┐
│   S3 Bucket     │  ← 静的ファイルホスティング
│  (Private)      │
└─────────────────┘
```

### セキュリティ

- S3バケットは完全にプライベート（パブリックアクセスブロック）
- CloudFrontのOAI経由でのみS3にアクセス可能
- CloudFrontは自動的にHTTPSにリダイレクト
- バージョニング有効化

### キャッシュ戦略

- **index.html**: キャッシュなし（`max-age=0, must-revalidate`）
- **その他のアセット**: 1年間キャッシュ（`max-age=31536000, immutable`）
- SPAのため、403/404エラーは全てindex.htmlにリダイレクト

## 事前準備

### AWS CLIのインストール

まだインストールしていない場合：

```bash
# macOSの場合
brew install awscli

# または公式インストーラーを使用
# https://aws.amazon.com/cli/
```

バージョン確認：
```bash
aws --version
```

### AWS認証情報の設定

AWSアカウントにログインするための認証情報を設定します：

```bash
aws configure
```

以下の情報を入力：
- **AWS Access Key ID**: AWSコンソールのIAMで作成したアクセスキー
- **AWS Secret Access Key**: 対応するシークレットキー
- **Default region name**: `ap-northeast-1` (東京リージョン) を推奨
- **Default output format**: `json` を推奨

#### IAMユーザーとアクセスキーの作成方法

1. [AWSコンソール](https://console.aws.amazon.com/) にログイン
2. IAM → ユーザー → 「ユーザーを追加」
3. ユーザー名を入力（例：`mitsu-game-deployer`）
4. 「アクセスキー - プログラムによるアクセス」を選択
5. 必要な権限を付与（次のセクション参照）
6. アクセスキーとシークレットキーをダウンロード・保存

#### 必要なIAM権限

デプロイに必要な権限：
- `CloudFormationFullAccess`
- `AmazonS3FullAccess`
- `CloudFrontFullAccess`
- `IAMReadOnlyAccess` (OAI作成のため)

**セキュリティのベストプラクティス**: 本番環境では最小権限の原則に従い、カスタムポリシーを作成することを推奨します。

### 認証確認

設定が正しく完了したか確認：

```bash
# 現在の認証情報を確認
aws sts get-caller-identity
```

正常に設定されていれば、アカウントIDやユーザー情報が表示されます。

## デプロイ手順

### 1. インフラストラクチャのデプロイ

初回または設定変更時に実行：

```bash
./deploy-infra.sh
```

#### カスタム設定

環境変数でデプロイ設定を変更できます：

```bash
# スタック名（デフォルト: mitsu-game-stack）
export STACK_NAME="my-stack"

# プロジェクト名（デフォルト: mitsu-game）
export PROJECT_NAME="my-project"

# AWSリージョン（デフォルト: ap-northeast-1）
export AWS_REGION="us-east-1"

./deploy-infra.sh
```

#### 出力

スクリプト実行後、以下が出力されます：
- S3バケット名
- CloudFront Distribution ID
- CloudFrontドメイン名
- WebサイトURL

また、`.deploy-config` ファイルが生成されます。

### 2. フロントエンドのデプロイ

フロントエンドのコード変更時に実行：

```bash
./deploy-frontend.sh
```

このスクリプトは：
1. フロントエンドをビルド
2. S3にファイルをアップロード
3. CloudFrontキャッシュを無効化

#### キャッシュ無効化完了を待つ

```bash
WAIT_FOR_INVALIDATION=true ./deploy-frontend.sh
```

## CloudFormationテンプレート詳細

### パラメータ

| パラメータ名 | デフォルト値 | 説明 |
|------------|------------|------|
| ProjectName | mitsu-game | リソース名のプレフィックス |

### リソース

| リソース | タイプ | 説明 |
|---------|--------|------|
| WebsiteBucket | AWS::S3::Bucket | 静的ファイル用S3バケット |
| CloudFrontOAI | AWS::CloudFront::CloudFrontOriginAccessIdentity | CloudFront OAI |
| WebsiteBucketPolicy | AWS::S3::BucketPolicy | S3バケットポリシー |
| CloudFrontDistribution | AWS::CloudFront::Distribution | CloudFrontディストリビューション |

### 出力（Outputs）

| 出力名 | 説明 | Export名 |
|-------|------|---------|
| WebsiteBucketName | S3バケット名 | `{StackName}-BucketName` |
| CloudFrontDistributionId | CloudFront Distribution ID | `{StackName}-DistributionId` |
| CloudFrontDomainName | CloudFrontドメイン名 | `{StackName}-DomainName` |
| WebsiteURL | WebサイトURL | `{StackName}-URL` |

## トラブルシューティング

### デプロイが失敗する

**原因1**: AWS認証情報が正しく設定されていない

```bash
# AWS認証情報を確認
aws sts get-caller-identity
```

**原因2**: S3バケット名が既に使用されている

CloudFormationテンプレートはAWSアカウントIDを含むバケット名を生成するため、通常は衝突しませんが、エラーが出た場合は `ProjectName` パラメータを変更してください。

### CloudFrontの変更が反映されない

キャッシュが原因の可能性があります：

```bash
# キャッシュを手動で無効化
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"
```

### スタックの削除ができない

S3バケットにファイルがある場合、先にバケットを空にする必要があります：

```bash
# .deploy-configから BUCKET_NAME を確認
source .deploy-config

# バケットを空にする
aws s3 rm "s3://$BUCKET_NAME/" --recursive

# スタックを削除
aws cloudformation delete-stack --stack-name "$STACK_NAME"
```

## コスト見積もり

### CloudFront
- 最初の 10 TB/月: 約 $0.114/GB
- リクエスト: 約 $0.0075/10,000 リクエスト

### S3
- ストレージ: 約 $0.025/GB/月
- リクエスト: GET約 $0.0004/1,000 リクエスト

**参考**: 小規模な利用（月間10GB転送、10万リクエスト）の場合、月額$2-3程度です。

## さらなる改善案

### カスタムドメイン対応

Route 53とACMを使用してカスタムドメインを設定できます。CloudFormationテンプレートに以下を追加：

- `AWS::CertificateManager::Certificate`
- `AWS::Route53::RecordSet`
- CloudFrontに `Aliases` と `ViewerCertificate` を設定

### WAF統合

CloudFront + WAFでセキュリティを強化：

```yaml
WebACL:
  Type: AWS::WAFv2::WebACL
  Properties:
    DefaultAction:
      Allow: {}
    Rules: ...
```

### ログ記録

CloudFrontアクセスログをS3に保存：

```yaml
Logging:
  Bucket: !GetAtt LogBucket.DomainName
  Prefix: cloudfront-logs/
```

## 参考リンク

- [CloudFormation S3 リファレンス](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket.html)
- [CloudFormation CloudFront リファレンス](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-cloudfront-distribution.html)
- [CloudFront セキュリティベストプラクティス](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/security-best-practices.html)
