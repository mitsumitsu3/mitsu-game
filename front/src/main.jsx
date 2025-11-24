import React from 'react'
import ReactDOM from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import App from './App.jsx'
import { amplifyConfig } from './aws-config'
import './index.css'

// Amplify設定（v6形式）
Amplify.configure(amplifyConfig, { ssr: false })

console.log('Amplify configured with:', {
  endpoint: amplifyConfig.API.GraphQL.endpoint,
  region: amplifyConfig.API.GraphQL.region,
  authMode: amplifyConfig.API.GraphQL.defaultAuthMode
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
