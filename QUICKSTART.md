# クイックスタートガイド

## 🚀 AWSへのデプロイ（初めての方向け）

### ステップ1: AWS CLIのセットアップ

1. **AWS CLIをインストール**
   ```bash
   brew install awscli
   ```

2. **AWSコンソールでアクセスキーを作成**
   - https://console.aws.amazon.com/ にログイン
   - IAM → ユーザー → 「ユーザーを追加」
   - アクセスキーを作成してダウンロード

3. **AWS CLIに認証情報を設定**
   ```bash
   aws configure
   ```
   入力内容：
   - AWS Access Key ID: `（ダウンロードしたアクセスキーID）`
   - AWS Secret Access Key: `（ダウンロードしたシークレットキー）`
   - Default region name: `ap-northeast-1`
   - Default output format: `json`

4. **設定確認**
   ```bash
   aws sts get-caller-identity
   ```
   アカウント情報が表示されればOK！

### ステップ2: バックエンドをデプロイ

```bash
cd backend
OPENAI_API_KEY='your-openai-api-key' ./deploy-backend.sh
```

⏱️ 5-10分程度かかります。完了すると以下が表示されます：
- GraphQL Endpoint
- Identity Pool ID

### ステップ3: インフラをデプロイ

```bash
cd infrastructure
./deploy-infra.sh
```

⏱️ 5-10分程度かかります。完了すると以下が表示されます：
- S3バケット名
- CloudFront Distribution ID
- WebサイトURL

### ステップ4: フロントエンドをデプロイ

```bash
# infrastructureディレクトリで実行
./deploy-frontend.sh
```

⏱️ 2-3分程度かかります。

### ステップ5: アクセス

表示されたURLにブラウザでアクセスしてください！

## 🎮 ローカルで開発する場合

1. **フロントエンドディレクトリに移動**
   ```bash
   cd front
   ```

2. **依存関係をインストール**
   ```bash
   npm install
   ```

3. **環境変数を設定**
   ```bash
   # front/.env ファイルを作成（バックエンドデプロイ後に自動生成されている場合あり）
   VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.ap-northeast-1.amazonaws.com/graphql
   VITE_IDENTITY_POOL_ID=ap-northeast-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   VITE_AWS_REGION=ap-northeast-1
   ```

4. **開発サーバーを起動**
   ```bash
   npm run dev
   ```

5. **ブラウザでアクセス**
   ```
   http://localhost:5173
   ```

## 🔧 Lambda関数の更新

コードを変更した後：

```bash
cd backend/lambda-go

# ビルド（arm64必須）
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o bootstrap .

# デプロイ
rm -f ../lambda-go.zip
zip -j ../lambda-go.zip bootstrap
aws s3 cp ../lambda-go.zip s3://mitsu-game-deploy-ap-northeast-1/lambda-go.zip
aws lambda update-function-code \
  --function-name mitsu-game-resolver \
  --s3-bucket mitsu-game-deploy-ap-northeast-1 \
  --s3-key lambda-go.zip \
  --region ap-northeast-1
```

## ⚠️ よくあるエラー

### エラー: `Unable to locate credentials`

**原因**: AWS認証情報が設定されていません

**解決方法**:
```bash
aws configure
```

### エラー: `Access Denied`

**原因**: IAMユーザーに必要な権限がありません

**解決方法**: AWSコンソールでIAMユーザーに以下の権限を付与：
- CloudFormationFullAccess
- AmazonS3FullAccess
- CloudFrontFullAccess
- AWSLambda_FullAccess
- AmazonDynamoDBFullAccess
- AWSAppSyncAdministrator

### エラー: `exit status 126`

**原因**: Lambda関数のビルドアーキテクチャが間違っています

**解決方法**: `GOARCH=arm64`でビルドしてください
```bash
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o bootstrap .
```

### エラー: `Stack already exists`

**原因**: 同じ名前のスタックが既に存在します

**解決方法**: 別のスタック名を使用
```bash
export STACK_NAME="my-unique-stack-name"
./deploy-infra.sh
```

## 🗑️ 削除方法

### CloudFormationスタックを削除

```bash
# まずS3バケットを空にする
source infrastructure/.deploy-config
aws s3 rm "s3://$BUCKET_NAME/" --recursive

# フロントエンドスタックを削除
aws cloudformation delete-stack --stack-name mitsu-game-stack

# バックエンドスタックを削除
aws cloudformation delete-stack --stack-name mitsu-game-backend-stack
```

## 📚 さらに詳しく知りたい

- 詳細なデプロイ手順: `infrastructure/README.md`
- バックエンド詳細: `backend/README.md`
- プロジェクト全体の説明: `README.md`
- 開発者向け情報: `CLAUDE.md`
