# Backend - AppSync + Lambda (Go) + DynamoDB

マルチプレイヤー対応のバックエンドです。

## アーキテクチャ

```
┌─────────────────┐
│   Frontend      │
│   (React)       │
└────────┬────────┘
         │ GraphQL (Query/Mutation/Subscription)
         ↓
┌─────────────────┐
│   AppSync       │ ← Cognito Identity Pool (IAM認証)
│   (GraphQL)     │    ※ユーザー登録不要のゲストアクセス
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│     Lambda      │
│      (Go)       │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│    DynamoDB     │ ← mitsu-game-rooms
│                 │    mitsu-game-players
│                 │    mitsu-game-answers
└─────────────────┘
```

## ファイル構成

```
backend/
├── lambda-go/           # Lambda関数（Go言語）
│   ├── main.go          # エントリポイント、ルーティング
│   ├── models.go        # データ構造体
│   ├── room.go          # ルーム管理（作成・参加・退出・キック）
│   ├── game.go          # ゲーム進行（開始・回答・判定）
│   ├── query.go         # データ取得
│   ├── openai.go        # OpenAI API連携
│   ├── appsync.go       # AppSync Subscription Publish
│   ├── go.mod
│   └── go.sum
├── schema/
│   └── schema.graphql   # GraphQLスキーマ定義
├── cloudformation.yaml  # CloudFormationテンプレート
└── deploy-backend.sh    # デプロイスクリプト
```

## デプロイ手順

### 1. 前提条件

- AWS CLI設定済み
- Go 1.21以上

### 2. バックエンドをデプロイ

```bash
cd backend
OPENAI_API_KEY='your-key' ./deploy-backend.sh
```

### 3. Lambda関数の手動更新

CloudFormationで更新されない場合：

```bash
cd backend/lambda-go

# ビルド（arm64アーキテクチャ）
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

## GraphQL API

### 主要な Mutation

```graphql
# ルーム作成（ホスト）
mutation CreateRoom {
  createRoom(hostName: "ホスト名") {
    roomId
    roomCode
    hostId
    state
  }
}

# ルーム参加（プレイヤー）
mutation JoinRoom {
  joinRoom(roomCode: "123456", playerName: "プレイヤー名") {
    playerId
    roomId
    name
    role
  }
}

# プレイヤーをキック（ホストのみ）
mutation KickPlayer {
  kickPlayer(roomId: "xxx", playerId: "host-id", kickedPlayerId: "target-id")
}

# 回答提出
mutation SubmitAnswer {
  submitAnswer(
    roomId: "xxx"
    playerId: "yyy"
    answerType: TEXT
    textAnswer: "リンゴ"
  ) {
    answerId
    playerName
    textAnswer
  }
}

# 判定画面へ（ホストのみ）
mutation StartJudging {
  startJudging(roomId: "xxx") {
    roomId
    state
  }
}

# コメント生成（非同期）
mutation GenerateJudgingComments {
  generateJudgingComments(roomId: "xxx") {
    roomId
    judgedAt
  }
}

# 判定（ホストのみ）
mutation JudgeAnswers {
  judgeAnswers(roomId: "xxx", isMatch: true) {
    roomId
    isMatch
    judgedAt
  }
}

# 次のラウンド（ホストのみ）
mutation NextRound {
  nextRound(roomId: "xxx") {
    roomId
    state
    topic
  }
}
```

### 主要な Query

```graphql
# ルーム取得
query GetRoom {
  getRoom(roomId: "xxx") {
    roomId
    roomCode
    state
    topic
    players {
      playerId
      name
      role
    }
    answers {
      answerId
      playerName
      answerType
      textAnswer
    }
    comments
    judgedAt
  }
}

# ルームコードから検索
query GetRoomByCode {
  getRoomByCode(roomCode: "123456") {
    roomId
    roomCode
  }
}
```

### Subscription（リアルタイム同期）

```graphql
# ルーム状態の変更を監視
subscription OnRoomUpdated {
  onRoomUpdated(roomId: "xxx") {
    roomId
    state
    topic
    players {
      playerId
      name
      role
    }
    answers {
      answerId
      playerName
      textAnswer
    }
    comments
    judgedAt
  }
}

# プレイヤーの参加を監視
subscription OnPlayerJoined {
  onPlayerJoined(roomId: "xxx") {
    playerId
    name
    role
  }
}

# 回答の提出を監視
subscription OnAnswerSubmitted {
  onAnswerSubmitted(roomId: "xxx") {
    answerId
    playerName
    answerType
    textAnswer
  }
}

# 判定結果を監視
subscription OnJudgeResult {
  onJudgeResult(roomId: "xxx") {
    roomId
    isMatch
    judgedAt
  }
}
```

## Subscription の仕組み

LambdaリゾルバーはAppSync Subscriptionを直接トリガーできないため、以下のパターンを使用：

1. Lambda が DynamoDB を更新
2. Lambda が AppSync の Publish Mutation を HTTP で呼び出し（SigV4署名）
3. Publish Mutation が `@aws_subscribe` でSubscriptionをトリガー

```
Lambda → HTTP(SigV4) → AppSync → publishRoomUpdated → @aws_subscribe → onRoomUpdated
```

`appsync.go` にPublish処理が実装されています。

## データモデル

### Room（ルーム）
- `roomId`: ルームの一意ID
- `roomCode`: 6桁の参加コード（例: 123456）
- `hostId`: ホストのプレイヤーID
- `state`: ゲーム状態（WAITING/ANSWERING/JUDGING）
- `topic`: 現在のお題
- `topicsPool`: 生成済みお題プール
- `usedTopics`: 使用済みお題
- `comments`: GPT生成コメント
- `judgedAt`: コメント生成完了時刻
- `ttl`: 24時間後に自動削除

### Player（プレイヤー）
- `playerId`: プレイヤーの一意ID
- `roomId`: 所属ルームID
- `name`: プレイヤー名
- `role`: 役割（HOST/PLAYER）
- `connected`: 接続状態

### Answer（回答）
- `answerId`: 回答の一意ID
- `roomId`: 所属ルームID
- `playerId`: 回答したプレイヤーID
- `answerType`: 回答タイプ（TEXT）
- `textAnswer`: テキスト回答

## トラブルシューティング

### Lambda関数が動かない

**エラー: `exit status 126`**

ビルドアーキテクチャが間違っています。`GOARCH=arm64`でビルドしてください。

```bash
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o bootstrap .
```

### Subscriptionが動かない

1. AppSyncコンソールでリゾルバーが設定されているか確認
2. Lambda環境変数に`APPSYNC_ENDPOINT`が設定されているか確認
3. Lambdaに`appsync:GraphQL`権限があるか確認

### AppSyncコンソールでテスト

1. [AppSyncコンソール](https://console.aws.amazon.com/appsync)を開く
2. `mitsu-game-api` を選択
3. 「Queries」タブでGraphQLクエリをテスト

## コスト見積もり

### DynamoDB（オンデマンド）
- 読み取り: $0.25/100万リクエスト
- 書き込み: $1.25/100万リクエスト
- ストレージ: $0.25/GB/月

### AppSync
- クエリ/ミューテーション: $4.00/100万リクエスト
- リアルタイム更新: $2.00/100万分

### Lambda
- 無料枠: 月100万リクエスト、400,000 GB-秒
- 超過分: $0.20/100万リクエスト

**参考**: 小規模な利用（1日10ゲーム、各ゲーム10ラウンド）の場合、月額$1未満です。
