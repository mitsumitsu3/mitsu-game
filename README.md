# 認識合わせゲーム

リアルタイムマルチプレイヤー対応の認識合わせゲームです。お題に対して全員が同じ回答を目指し、ニコニコ動画風のコメントが流れる演出が特徴です。

## プロジェクト構成

```
.
├── front/                 # フロントエンド (React + Vite)
│   ├── src/
│   │   ├── App.jsx              # メインアプリケーション
│   │   ├── MultiplayerLobby.jsx # ロビー画面（ルーム作成・参加）
│   │   ├── MultiplayerGame.jsx  # ゲーム画面
│   │   ├── NicoComments.jsx     # ニコニコ風コメント表示
│   │   └── graphql/             # GraphQLクエリ・ミューテーション
│   └── package.json
├── backend/               # バックエンド (AWS Lambda + AppSync)
│   ├── lambda-go/             # Lambda関数（Go言語）
│   │   ├── main.go            # エントリポイント、ルーティング
│   │   ├── models.go          # データ構造体
│   │   ├── room.go            # ルーム管理機能
│   │   ├── game.go            # ゲーム進行管理
│   │   ├── query.go           # データ取得機能
│   │   ├── openai.go          # OpenAI API連携
│   │   └── appsync.go         # AppSync Subscription Publish
│   ├── schema/
│   │   └── schema.graphql     # GraphQLスキーマ
│   ├── cloudformation.yaml    # バックエンド用CloudFormation
│   └── deploy-backend.sh      # バックエンドデプロイスクリプト
├── infrastructure/        # フロントエンド用インフラ
│   ├── cloudformation.yaml    # S3 + CloudFront
│   ├── deploy-infra.sh        # インフラデプロイスクリプト
│   └── deploy-frontend.sh     # フロントエンドデプロイスクリプト
└── README.md
```

## 技術スタック

### フロントエンド
- React + Vite
- AWS Amplify (GraphQL Client)
- AppSync Subscriptions (WebSocket)
- Cognito Identity Pool（ゲストアクセス、ユーザー登録不要）

### バックエンド
- AWS Lambda (Go言語)
- AWS AppSync (GraphQL API + Subscriptions)
- Amazon DynamoDB
- OpenAI API (GPT-4o-mini)

### インフラ
- AWS S3 + CloudFront (フロントエンドホスティング)
- AWS CloudFormation

## ローカル開発

### 前提条件
- Node.js 18以上
- Go 1.21以上
- AWS CLI (設定済み)

### フロントエンド開発

```bash
cd front
npm install
npm run dev
```

ブラウザで http://localhost:5173 にアクセス

## デプロイ

### バックエンドのデプロイ

```bash
cd backend

# OpenAI APIキーを環境変数に設定してデプロイ
OPENAI_API_KEY='your-openai-api-key' ./deploy-backend.sh
```

**Lambda関数の手動更新**（CloudFormationで更新されない場合）:

```bash
cd backend/lambda-go

# ビルド（arm64アーキテクチャ）
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o bootstrap .

# ZIPファイルを作成してS3にアップロード
rm -f ../lambda-go.zip
zip -j ../lambda-go.zip bootstrap
aws s3 cp ../lambda-go.zip s3://mitsu-game-deploy-ap-northeast-1/lambda-go.zip

# Lambda関数を直接更新
aws lambda update-function-code \
  --function-name mitsu-game-resolver \
  --s3-bucket mitsu-game-deploy-ap-northeast-1 \
  --s3-key lambda-go.zip \
  --region ap-northeast-1
```

### フロントエンドのデプロイ

```bash
cd infrastructure

# 初回のみ: インフラ構築
./deploy-infra.sh

# フロントエンドのビルド＆デプロイ
./deploy-frontend.sh
```

## ゲームの流れ

1. **ロビー画面**
   - ホストが「ルームを作成」でルームを作成
   - 他のプレイヤーはルームコードを入力して参加

2. **待機画面**
   - 全員が揃ったらホストが「ゲーム開始」
   - ホストはプレイヤーをキック可能

3. **回答画面**
   - お題が表示され、各プレイヤーがテキストで回答
   - 全員の回答が揃ったらホストが「判定画面へ」

4. **判定画面**
   - 全員の回答が表示される
   - ニコニコ動画風のコメントが流れる（GPTが生成）
   - ホストが「一致」または「不一致」を判定
   - 次のラウンドへ

## 環境変数

### フロントエンド (`front/.env`)
```
VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.ap-northeast-1.amazonaws.com/graphql
VITE_IDENTITY_POOL_ID=ap-northeast-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_AWS_REGION=ap-northeast-1
```

### バックエンド (Lambda環境変数)
- `OPENAI_API_KEY`: OpenAI APIキー
- `APPSYNC_ENDPOINT`: AppSync GraphQL Endpoint（Subscription用）

## 主要な機能

- リアルタイムマルチプレイヤー（AppSync Subscriptions + ポーリングフォールバック）
- ChatGPTによるお題自動生成
- ニコニコ動画風コメント表示（GPTが回答を見てコメント生成）
- 全員一致時のお祝い演出
- プレイヤーキック機能（ホストのみ）
