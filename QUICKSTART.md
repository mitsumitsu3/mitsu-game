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

### ステップ2: インフラをデプロイ

```bash
cd infrastructure
./deploy-infra.sh
```

⏱️ 5-10分程度かかります。完了すると以下が表示されます：
- S3バケット名
- CloudFront Distribution ID
- WebサイトURL

### ステップ3: フロントエンドをデプロイ

```bash
# infrastructureディレクトリで実行
./deploy-frontend.sh
```

⏱️ 2-3分程度かかります。

### ステップ4: アクセス

表示されたURLにブラウザでアクセスしてください！

```
例: https://d1234567890abc.cloudfront.net
```

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
   # front/.env ファイルを作成
   echo "VITE_OPENAI_API_KEY=your-openai-api-key" > .env
   ```

4. **開発サーバーを起動**
   ```bash
   npm run dev
   ```

5. **ブラウザでアクセス**
   ```
   http://localhost:5173
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

# スタックを削除
aws cloudformation delete-stack --stack-name "$STACK_NAME"
```

## 📚 さらに詳しく知りたい

- 詳細なデプロイ手順: `infrastructure/README.md`
- プロジェクト全体の説明: `README.md`
- 開発者向け情報: `CLAUDE.md`
