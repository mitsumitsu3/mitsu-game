# 認識合わせゲーム

ChatGPT APIを使った認識合わせゲームのWebアプリケーションです。ラウンジ風のインターフェースで、テキストまたはお絵描きで回答できます。

## プロジェクト構成

```
.
├── front/              # フロントエンドアプリケーション
│   ├── src/           # Reactソースコード
│   ├── package.json   # 依存関係
│   └── vite.config.js # Vite設定
├── infrastructure/     # AWS インフラストラクチャ
│   ├── cloudformation.yaml      # CloudFormationテンプレート
│   ├── deploy-infra.sh         # インフラデプロイスクリプト
│   └── deploy-frontend.sh      # フロントエンドデプロイスクリプト
└── README.md          # このファイル
```

## ローカル開発

### 前提条件

- Node.js 18以上
- OpenAI APIキー

### セットアップ

1. リポジトリをクローン

2. フロントエンドディレクトリに移動
```bash
cd front
```

3. 依存関係をインストール
```bash
npm install
```

4. 環境変数を設定
```bash
# front/.env ファイルを作成
VITE_OPENAI_API_KEY=your-api-key-here
```

5. 開発サーバーを起動
```bash
npm run dev
```

ブラウザで http://localhost:5173 にアクセスしてください。

## AWSへのデプロイ

### 前提条件

#### 1. AWS CLIのインストール

```bash
# macOSの場合
brew install awscli

# バージョン確認
aws --version
```

#### 2. AWS認証情報の設定

```bash
aws configure
```

入力内容：
- **AWS Access Key ID**: IAMユーザーのアクセスキー
- **AWS Secret Access Key**: シークレットキー
- **Default region name**: `ap-northeast-1` (推奨)
- **Default output format**: `json`

#### 3. 認証確認

```bash
aws sts get-caller-identity
```

正常に設定されていれば、アカウント情報が表示されます。

#### 4. 必要なIAM権限

- CloudFormationFullAccess
- AmazonS3FullAccess
- CloudFrontFullAccess
- IAMReadOnlyAccess

詳細な手順は `infrastructure/README.md` を参照してください。

### アーキテクチャ

- **S3**: 静的ファイルのホスティング
- **CloudFront**: CDNによるコンテンツ配信
- **OAI**: S3へのセキュアなアクセス

### デプロイ手順

#### 1. インフラストラクチャのデプロイ

```bash
cd infrastructure
./deploy-infra.sh
```

このスクリプトは以下を実行します：
- CloudFormationスタックの作成
- S3バケットの作成
- CloudFrontディストリビューションの作成
- デプロイ設定ファイル `.deploy-config` の生成

#### 2. フロントエンドのデプロイ

```bash
# infrastructure ディレクトリで実行
./deploy-frontend.sh
```

このスクリプトは以下を実行します：
- フロントエンドのビルド
- S3へのファイルアップロード
- CloudFrontキャッシュの無効化

デプロイ完了後、表示されるURLにアクセスしてください。

### 環境変数の設定

デプロイ前に、`front/.env` に本番用のOpenAI APIキーを設定してください。

```bash
VITE_OPENAI_API_KEY=your-production-api-key
```

⚠️ **注意**: APIキーはブラウザに露出されるため、OpenAIのAPI使用量制限やレート制限を適切に設定してください。

### カスタム設定

環境変数でデプロイ設定をカスタマイズできます：

```bash
# スタック名を変更
export STACK_NAME="my-custom-stack"

# プロジェクト名を変更
export PROJECT_NAME="my-game"

# AWSリージョンを変更
export AWS_REGION="us-east-1"

./deploy-infra.sh
```

## スタックの削除

CloudFormationスタックを削除する場合：

```bash
aws cloudformation delete-stack --stack-name mitsu-game-stack --region ap-northeast-1
```

⚠️ **注意**: S3バケット内にファイルがある場合、削除前に手動でバケットを空にする必要があります。

```bash
# バケット名は .deploy-config から確認できます
aws s3 rm s3://your-bucket-name/ --recursive
```

## ゲームの遊び方

1. **セットアップ画面**
   - プレイヤー数を設定
   - 「お題を生成」ボタンをクリック

2. **回答画面**
   - 各プレイヤーが「テキスト」または「お絵描き」を選択
   - 回答を入力・描画
   - 全員の回答が揃ったら「回答を提出」

3. **判定画面**
   - ホストが回答の一致を判定
   - 「次へ」で次のラウンドへ
   - 「終了」でゲーム終了

## 技術スタック

### フロントエンド
- React
- Vite
- HTML5 Canvas (お絵描き機能)
- OpenAI API (GPT-3.5-turbo)

### インフラストラクチャ
- AWS S3
- AWS CloudFront
- AWS CloudFormation

## ライセンス

このプロジェクトは個人用・学習用途です。

## 今後の予定

- WebSocketによるマルチプレイヤー対応
- 自動回答一致判定機能
- スコアリングシステム
