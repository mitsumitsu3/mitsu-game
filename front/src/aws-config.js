// AppSync設定 (Amplify v6形式 - Cognito Identity Pool認証)
// ユーザー登録不要で、未認証（ゲスト）アクセスが可能
const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT
const region = import.meta.env.VITE_AWS_REGION || 'ap-northeast-1'
const identityPoolId = import.meta.env.VITE_IDENTITY_POOL_ID

// 環境変数が設定されているか確認
if (!endpoint || !identityPoolId) {
  console.error('Missing required environment variables:')
  if (!endpoint) console.error('- VITE_GRAPHQL_ENDPOINT is not set')
  if (!identityPoolId) console.error('- VITE_IDENTITY_POOL_ID is not set')
}

// AppSyncのリアルタイムエンドポイントを生成
// https://xxxxx.appsync-api.region.amazonaws.com/graphql
// -> wss://xxxxx.appsync-realtime-api.region.amazonaws.com/graphql
const getRealtimeEndpoint = (graphqlEndpoint) => {
  if (!graphqlEndpoint) return undefined
  return graphqlEndpoint
    .replace('appsync-api', 'appsync-realtime-api')
    .replace('https://', 'wss://')
}

// AppSyncのリアルタイムエンドポイント
const realtimeEndpoint = endpoint
  ? endpoint.replace('appsync-api', 'appsync-realtime-api').replace('https://', 'wss://')
  : undefined

// Amplify v6設定（IAM認証 + Cognito Identity Pool）
export const amplifyConfig = {
  Auth: {
    Cognito: {
      identityPoolId: identityPoolId,
      allowGuestAccess: true  // 未認証（ゲスト）アクセスを許可
    }
  },
  API: {
    GraphQL: {
      endpoint: endpoint,
      realtime: {
        url: realtimeEndpoint
      },
      region: region,
      defaultAuthMode: 'identityPool'  // Identity Pool認証を使用
    }
  }
}

// Amplify v6ではリアルタイムエンドポイントは自動検出されるはずだが、念のためログ出力
console.log('GraphQL endpoint:', endpoint)
console.log('Realtime endpoint (auto-derived):', getRealtimeEndpoint(endpoint))

// 後方互換性のためにawsConfigもエクスポート
export const awsConfig = amplifyConfig
