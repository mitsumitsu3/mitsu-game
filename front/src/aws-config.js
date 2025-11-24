// AppSync設定 (Amplify v6形式)
const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT
const region = import.meta.env.VITE_AWS_REGION
const apiKey = import.meta.env.VITE_API_KEY

// 環境変数が設定されているか確認
if (!endpoint || !apiKey) {
  console.error('Missing required environment variables:')
  if (!endpoint) console.error('- VITE_GRAPHQL_ENDPOINT is not set')
  if (!apiKey) console.error('- VITE_API_KEY is not set')
}

export const awsConfig = {
  API: {
    GraphQL: {
      endpoint: endpoint,
      region: region || 'ap-northeast-1',
      defaultAuthMode: 'apiKey',
      apiKey: apiKey
    }
  }
}

// ResourcesConfigで直接エクスポート（Amplify v6推奨形式）
export const amplifyConfig = {
  API: {
    GraphQL: {
      endpoint: endpoint,
      region: region || 'ap-northeast-1',
      defaultAuthMode: 'apiKey',
      apiKey: apiKey
    }
  }
}
