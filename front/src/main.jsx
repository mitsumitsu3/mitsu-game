import React from 'react'
import ReactDOM from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import App from './App.jsx'
import { amplifyConfig } from './aws-config'
import './index.css'

// Amplify設定（v6形式 - Cognito Identity Pool認証）
Amplify.configure(amplifyConfig, { ssr: false })

console.log('Amplify configured with:', {
  endpoint: amplifyConfig.API?.GraphQL?.endpoint,
  region: amplifyConfig.API?.GraphQL?.region,
  authMode: amplifyConfig.API?.GraphQL?.defaultAuthMode,
  identityPoolId: amplifyConfig.Auth?.Cognito?.identityPoolId
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
