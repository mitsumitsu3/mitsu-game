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
│   ├── lambda/
│   │   └── index.js            # Lambda関数（GraphQLリゾルバー）
│   ├── cloudformation.yaml     # バックエンド用CloudFormation
│   └── deploy-backend.sh       # バックエンドデプロイスクリプト
├── infrastructure/        # フロントエンド用インフラ
│   ├── cloudformation.yaml     # S3 + CloudFront
│   ├── deploy-infra.sh         # インフラデプロイスクリプト
│   └── deploy-frontend.sh      # フロントエンドデプロイスクリプト
└── README.md
```

## 技術スタック

### フロントエンド
- React + Vite
- AWS AppSync (GraphQL)

### バックエンド
- AWS Lambda (Node.js)
- AWS AppSync (GraphQL API)
- Amazon DynamoDB
- OpenAI API (GPT-4o-mini)

### インフラ
- AWS S3 + CloudFront (フロントエンドホスティング)
- AWS CloudFormation

## ローカル開発

### 前提条件
- Node.js 18以上
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

**重要**: CloudFormationでスタックを更新した後、Lambda関数のコードが更新されない場合は、以下のコマンドで直接更新してください：

```bash
cd backend/lambda

# ZIPファイルを作成してS3にアップロード
rm -f ../lambda-function.zip
zip -r ../lambda-function.zip . -x "*.git*" "*.DS_Store"
aws s3 cp ../lambda-function.zip s3://mitsu-game-deploy-ap-northeast-1/lambda-function.zip

# Lambda関数を直接更新
aws lambda update-function-code \
  --function-name mitsu-game-resolver \
  --s3-bucket mitsu-game-deploy-ap-northeast-1 \
  --s3-key lambda-function.zip \
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

デプロイ後のURL: https://d2uoh1cjwk5po6.cloudfront.net

## ゲームの流れ

1. **ロビー画面**
   - ホストが「ルームを作成」でルームを作成
   - 他のプレイヤーはルームコードを入力して参加

2. **待機画面**
   - 全員が揃ったらホストが「ゲーム開始」

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
VITE_API_KEY=da2-xxxxx
```

### バックエンド
- `OPENAI_API_KEY`: OpenAI APIキー（デプロイ時に環境変数で指定）

## 主要な機能

- リアルタイムマルチプレイヤー（ポーリングベース）
- ChatGPTによるお題自動生成
- ニコニコ動画風コメント表示（GPTが回答を見てコメント生成）
- 全員一致時のお祝い演出
