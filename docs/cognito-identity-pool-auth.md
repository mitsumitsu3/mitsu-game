# Cognito Identity Pool 認証の仕組み

このドキュメントでは、認識合わせゲームで使用しているCognito Identity Pool + IAM認証の仕組みを説明します。

## 概要

- **ユーザー登録不要**でゲームにアクセスできる
- **有効期限の心配なし**（API Keyと違い、自動更新される）
- セキュリティを維持しながらシンプルなアクセスを実現

---

## API Key vs Cognito Identity Pool

| 項目 | API Key | Cognito Identity Pool |
|------|---------|----------------------|
| **有効期限** | 最大365日（要更新） | **なし** |
| **認証方式** | 固定文字列 | 自動で一時認証情報を発行 |
| **セキュリティ** | キーが漏れると危険 | 一時的なトークンで安全 |
| **ユーザー操作** | 不要 | 不要 |

---

## 全体の流れ

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ブラウザ（フロントエンド）                        │
│                                                                          │
│  1. Amplify.configure() で Identity Pool ID を設定                       │
│                              │                                           │
│  2. client.graphql() を呼ぶ  │                                           │
│                              ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Amplify SDK が自動で以下を実行：                                   │   │
│  │                                                                   │   │
│  │  a) Cognito Identity Pool に「ゲストとして認証して」とリクエスト    │   │
│  │                              │                                    │   │
│  │  b) 一時的なAWS認証情報を受け取る                                  │   │
│  │     - AccessKeyId（一時的）                                       │   │
│  │     - SecretAccessKey（一時的）                                   │   │
│  │     - SessionToken（一時的、数時間で期限切れ→自動更新）           │   │
│  │                              │                                    │   │
│  │  c) これらの認証情報でリクエストに署名                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                           │
└──────────────────────────────│───────────────────────────────────────────┘
                               │
                               ▼ IAM署名付きリクエスト
┌─────────────────────────────────────────────────────────────────────────┐
│                              AWS                                         │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Cognito Identity Pool                                            │   │
│  │  - AllowUnauthenticatedIdentities: true                          │   │
│  │  - 未認証ユーザーに CognitoUnauthRole を割り当て                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ CognitoUnauthRole (IAMロール)                                    │   │
│  │  - appsync:GraphQL を許可                                        │   │
│  │  - このAppSync APIのみアクセス可                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                           │
│                              ▼ 署名が正しければアクセス許可              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ AppSync (AuthenticationType: AWS_IAM)                            │   │
│  │                              │                                    │   │
│  │                              ▼                                    │   │
│  │ Lambda関数 → DynamoDB                                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## AWS側の設定（CloudFormation）

### 1. Cognito Identity Pool

`backend/cloudformation.yaml` の107-111行目:

```yaml
CognitoIdentityPool:
  Type: AWS::Cognito::IdentityPool
  Properties:
    IdentityPoolName: mitsu-game-identity-pool
    AllowUnauthenticatedIdentities: true  # ← ユーザー登録なしでアクセスを許可
```

**ポイント**: `AllowUnauthenticatedIdentities: true` でゲストアクセスが可能に。

### 2. IAMロール（未認証ユーザー用）

`backend/cloudformation.yaml` の114-140行目:

```yaml
CognitoUnauthRole:
  Type: AWS::IAM::Role
  Properties:
    RoleName: mitsu-game-cognito-unauth-role

    # このロールを使える条件
    AssumeRolePolicyDocument:
      Version: '2012-10-17'
      Statement:
        - Effect: Allow
          Principal:
            Federated: cognito-identity.amazonaws.com
          Action: 'sts:AssumeRoleWithWebIdentity'
          Condition:
            StringEquals:
              'cognito-identity.amazonaws.com:aud': !Ref CognitoIdentityPool
            ForAnyValue:StringLike:
              'cognito-identity.amazonaws.com:amr': unauthenticated  # ← 未認証ユーザー

    # このロールで許可する操作
    Policies:
      - PolicyName: CognitoUnauthPolicy
        PolicyDocument:
          Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action:
                - 'appsync:GraphQL'  # ← AppSyncのGraphQLだけ許可
              Resource:
                - !Sub 'arn:aws:appsync:${AWS::Region}:${AWS::AccountId}:apis/${AppSyncApi.ApiId}/*'
```

**ポイント**: 未認証ユーザーが**AppSyncだけ**呼べるように制限。

### 3. ロールの紐付け

`backend/cloudformation.yaml` の143-148行目:

```yaml
CognitoIdentityPoolRoleAttachment:
  Type: AWS::Cognito::IdentityPoolRoleAttachment
  Properties:
    IdentityPoolId: !Ref CognitoIdentityPool
    Roles:
      unauthenticated: !GetAtt CognitoUnauthRole.Arn  # ← 未認証時はこのロールを使用
```

### 4. AppSync API

`backend/cloudformation.yaml` の155-159行目:

```yaml
AppSyncApi:
  Type: AWS::AppSync::GraphQLApi
  Properties:
    Name: mitsu-game-api
    AuthenticationType: AWS_IAM  # ← IAM認証を使用
```

---

## フロントエンド側の設定

### 1. Amplify設定

`front/src/aws-config.js`:

```javascript
export const amplifyConfig = {
  Auth: {
    Cognito: {
      identityPoolId: 'ap-northeast-1:xxxx-xxxx-xxxx',  // AWSのIdentity Pool ID
      allowGuestAccess: true  // ゲストアクセスを有効化
    }
  },
  API: {
    GraphQL: {
      endpoint: 'https://xxx.appsync-api.ap-northeast-1.amazonaws.com/graphql',
      region: 'ap-northeast-1',
      defaultAuthMode: 'iam'  // IAM認証を使用
    }
  }
}
```

### 2. アプリ起動時の設定

`front/src/main.jsx`:

```javascript
import { Amplify } from 'aws-amplify'
import { amplifyConfig } from './aws-config'

// アプリ起動時にAmplifyを設定
Amplify.configure(amplifyConfig)
```

### 3. GraphQL呼び出し

`front/src/App.jsx` など:

```javascript
import { generateClient } from 'aws-amplify/api'

const client = generateClient()

// この呼び出し時にAmplifyが自動で：
// 1. Cognito Identity Poolから一時認証情報を取得
// 2. リクエストにIAM署名を付与
// 3. AppSyncにリクエストを送信
const result = await client.graphql({
  query: CREATE_ROOM,
  variables: { hostName }
})
```

---

## 環境変数

`front/.env`:

```
VITE_GRAPHQL_ENDPOINT=https://xxx.appsync-api.ap-northeast-1.amazonaws.com/graphql
VITE_IDENTITY_POOL_ID=ap-northeast-1:xxxx-xxxx-xxxx
VITE_AWS_REGION=ap-northeast-1
```

---

## ポイントまとめ

1. **ユーザーは何もしない** - ログイン画面もパスワード入力もなし
2. **Amplify SDKが自動処理** - 一時認証情報の取得・署名・更新を全部やってくれる
3. **セキュリティは維持** - IAMロールで「このAPIだけ」に制限されている
4. **期限切れの心配なし** - 一時認証情報は自動更新される

---

## 関連ファイル

- `backend/cloudformation.yaml` - AWS リソース定義
- `front/src/aws-config.js` - Amplify設定
- `front/src/main.jsx` - Amplify初期化
- `front/.env` - 環境変数
