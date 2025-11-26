# Backend - AppSync + Lambda + DynamoDB

マルチプレイヤー対応のためのバックエンドです。

## アーキテクチャ

```
┌─────────────────┐
│   Frontend      │
│   (React)       │
└────────┬────────┘
         │ GraphQL (Subscription)
         ↓
┌─────────────────┐
│   AppSync       │ ← API Key認証
│   (GraphQL)     │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│   Lambda        │ ← Resolver関数
│   (Node.js)     │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│   DynamoDB      │ ← 3つのテーブル
│  (Rooms/Players │    - Rooms
│   /Answers)     │    - Players
└─────────────────┘    - Answers
```

## デプロイ手順

### 1. 前提条件

- AWS CLI設定済み
- Node.js 18以上

### 2. バックエンドをデプロイ

```bash
cd backend
./deploy-backend.sh
```

このスクリプトが自動的に：
1. Lambda関数の依存関係をインストール
2. Lambda関数をZIP化してS3にアップロード
3. GraphQLスキーマをS3にアップロード
4. CloudFormationスタックを作成
5. 環境変数ファイルを生成

⏱️ 初回は5-10分程度かかります。

### 3. 出力の確認

デプロイ完了後、以下が表示されます：

- **GraphQL Endpoint**: AppSync APIのエンドポイント
- **API Key**: 認証用のAPIキー
- **テーブル名**: DynamoDBテーブル名

また、以下のファイルが自動生成されます：
- `.backend-config`: バックエンド設定
- `../front/.env.backend`: フロントエンド用環境変数

### 4. フロントエンドに設定を追加

```bash
cd ../front
cat .env.backend >> .env
```

または手動で`front/.env`に追加：
```bash
VITE_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.ap-northeast-1.amazonaws.com/graphql
VITE_API_KEY=da2-xxxxxxxxxxxxxxxxxxxx
VITE_AWS_REGION=ap-northeast-1
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
  joinRoom(roomCode: "ABC123", playerName: "プレイヤー名") {
    playerId
    roomId
    name
    role
  }
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
  }
}

# ルームコードから検索
query GetRoomByCode {
  getRoomByCode(roomCode: "ABC123") {
    roomId
    roomCode
  }
}
```

### Subscription（リアルタイム同期）

```graphql
# ルーム状態の変更を監視
subscription OnRoomUpdate {
  onRoomUpdate(roomId: "xxx") {
    roomId
    state
    topic
  }
}

# プレイヤーの参加・退出を監視
subscription OnPlayerChanged {
  onPlayerChanged(roomId: "xxx") {
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
subscription OnJudged {
  onJudged(roomId: "xxx") {
    roomId
    isMatch
    judgedAt
  }
}
```

## データモデル

### Room（ルーム）
- `roomId`: ルームの一意ID
- `roomCode`: 6文字の参加コード（例: ABC123）
- `hostId`: ホストのプレイヤーID
- `state`: ゲーム状態（WAITING/ANSWERING/JUDGING）
- `topic`: 現在のお題
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
- `answerType`: 回答タイプ（TEXT/DRAWING）
- `textAnswer`: テキスト回答
- `drawingData`: お絵描きデータ（Base64）

## トラブルシューティング

### デプロイエラー

**エラー: `Bucket does not exist`**

S3バケット名が他のAWSアカウントで使用されている可能性があります：

```bash
export S3_BUCKET="mitsu-game-deploy-unique-name-12345"
./deploy-backend.sh
```

**エラー: `Role already exists`**

既存のスタックを削除してから再デプロイ：

```bash
aws cloudformation delete-stack --stack-name mitsu-game-backend-stack
# 削除完了を待ってから
./deploy-backend.sh
```

### Lambda関数の更新

コードを修正した後：

```bash
./deploy-backend.sh
```

CloudFormationが変更を検出して自動的に更新します。

### AppSyncコンソールでテスト

1. [AppSyncコンソール](https://console.aws.amazon.com/appsync)を開く
2. `mitsu-game-api` を選択
3. 「Queries」タブでGraphQLクエリをテスト

## スタックの削除

```bash
# スタック名を確認
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE

# スタックを削除
aws cloudformation delete-stack --stack-name mitsu-game-backend-stack

# DynamoDBテーブルも自動削除されます
```

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

詳細は親ディレクトリの`README.md`を参照してください。
