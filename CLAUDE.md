# CLAUDE.md

Claude Code向けのプロジェクトガイドです。

## プロジェクト概要

「認識合わせゲーム」- リアルタイムマルチプレイヤー対応のブラウザゲーム。お題に対して全員が同じ回答を目指し、ニコニコ動画風のコメントが流れる演出が特徴。

## プロジェクト構造

```
.
├── front/                 # フロントエンド (React + Vite)
│   ├── src/
│   │   ├── App.jsx              # ルーティング（Lobby/Game切り替え）
│   │   ├── MultiplayerLobby.jsx # ロビー画面（ルーム作成・参加）
│   │   ├── MultiplayerGame.jsx  # メインゲーム画面
│   │   ├── NicoComments.jsx     # ニコニコ風コメント表示コンポーネント
│   │   └── graphql/             # GraphQLクエリ・ミューテーション
│   │       ├── queries.js
│   │       └── mutations.js
│   └── .env                     # 環境変数（GraphQL endpoint, API key）
├── backend/               # バックエンド (AWS Lambda + AppSync)
│   ├── lambda/
│   │   └── index.js            # 全GraphQLリゾルバーを含むLambda関数
│   ├── cloudformation.yaml     # AppSync, DynamoDB, Lambda定義
│   └── deploy-backend.sh       # バックエンドデプロイスクリプト
├── infrastructure/        # フロントエンド用インフラ
│   ├── cloudformation.yaml     # S3 + CloudFront
│   ├── deploy-infra.sh         # インフラ構築
│   └── deploy-frontend.sh      # フロントエンドデプロイ
└── README.md
```

## 開発コマンド

### フロントエンド

```bash
cd front
npm install
npm run dev      # 開発サーバー起動 (http://localhost:5173)
npm run build    # 本番ビルド
```

### バックエンドデプロイ

```bash
cd backend
OPENAI_API_KEY='your-key' ./deploy-backend.sh
```

**重要**: CloudFormationでLambdaコードが更新されない場合は直接更新：

```bash
cd backend/lambda
rm -f ../lambda-function.zip
zip -r ../lambda-function.zip . -x "*.git*" "*.DS_Store"
aws s3 cp ../lambda-function.zip s3://mitsu-game-deploy-ap-northeast-1/lambda-function.zip
aws lambda update-function-code \
  --function-name mitsu-game-resolver \
  --s3-bucket mitsu-game-deploy-ap-northeast-1 \
  --s3-key lambda-function.zip \
  --region ap-northeast-1
```

### フロントエンドデプロイ

```bash
cd infrastructure
./deploy-frontend.sh
```

## アーキテクチャ

### ゲームフロー

1. **WAITING**: ロビーでプレイヤー待機
2. **ANSWERING**: お題に対して全員が回答入力
3. **JUDGING**: 回答表示 + ニコニコ風コメント + ホストが判定

### 状態管理

- `room.state`: WAITING / ANSWERING / JUDGING
- `room.topic`: 現在のお題
- `room.answers`: プレイヤーの回答配列
- `room.comments`: GPT生成のニコニコ風コメント
- `room.judgedAt`: 判定完了時刻（コメント生成完了の目印）

### バックエンド (Lambda)

`backend/lambda/index.js` に全機能が集約：

- `createRoom`: ルーム作成
- `joinRoom`: ルーム参加
- `startGame`: ゲーム開始（お題10個を一括生成）
- `submitAnswer`: 回答提出
- `startJudging`: 判定画面遷移 + コメント生成
- `judgeAnswers`: 一致/不一致判定
- `nextRound`: 次のラウンドへ

### OpenAI API連携

- **お題生成**: `generateTopics()` - GPT-4o-miniで10個のお題を生成
- **コメント生成**: `generateComments()` - 回答を見てニコニコ風コメント30個を生成
  - 全員一致時はお祝いコメントを多めに生成

### DynamoDBテーブル

- `mitsu-game-rooms`: ルーム情報
- `mitsu-game-players`: プレイヤー情報
- `mitsu-game-answers`: 回答情報

## 環境変数

### フロントエンド (`front/.env`)
```
VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.ap-northeast-1.amazonaws.com/graphql
VITE_API_KEY=da2-xxxxx
```

### バックエンド (Lambda環境変数)
- `OPENAI_API_KEY`: OpenAI APIキー

## 注意点

- お絵描き機能は削除済み（テキスト回答のみ）
- マルチプレイヤーはポーリングベース（3秒間隔）
- コメント生成は`startJudging`内で同期実行（完了を待つ）
