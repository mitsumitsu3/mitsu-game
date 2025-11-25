import { useState, useEffect } from 'react'
import MultiplayerLobby from './MultiplayerLobby'
import MultiplayerGame from './MultiplayerGame'
import { CREATE_ROOM, JOIN_ROOM } from './graphql/mutations'
import './App.css'

const STORAGE_KEY = 'mitsu_game_session'

function App() {
  const [screen, setScreen] = useState('lobby') // lobby, game
  const [multiplayerData, setMultiplayerData] = useState(null)
  const [isHostMode, setIsHostMode] = useState(false)

  // URLからルームコードを取得
  const [initialRoomCode, setInitialRoomCode] = useState('')

  // ページ読み込み時にセッションを復元 & ホストモード判定 & ルームコード取得
  useEffect(() => {
    // #host がURLにあればホストモードを有効化
    setIsHostMode(window.location.hash === '#host')

    // URLのクエリパラメータからルームコードを取得
    const urlParams = new URLSearchParams(window.location.search)
    const roomCodeFromUrl = urlParams.get('room')
    if (roomCodeFromUrl) {
      setInitialRoomCode(roomCodeFromUrl.toUpperCase())
    }

    const savedSession = localStorage.getItem(STORAGE_KEY)
    if (savedSession) {
      try {
        const session = JSON.parse(savedSession)
        console.log('Restoring session:', session)
        setMultiplayerData(session)
        setScreen('game')
      } catch (err) {
        console.error('Failed to restore session:', err)
        localStorage.removeItem(STORAGE_KEY)
      }
    }
  }, [])

  // セッション情報をlocalStorageに保存
  const saveSession = (data) => {
    if (data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  // GraphQL APIを直接呼び出すヘルパー関数
  const callGraphQL = async (query, variables = {}) => {
    const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT
    const apiKey = import.meta.env.VITE_API_KEY

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    })

    const result = await response.json()

    if (result.errors) {
      throw { errors: result.errors, data: result.data }
    }

    return result
  }

  // ルームを作成
  const handleCreateRoom = async (hostName) => {
    try {
      console.log('Creating room with hostName:', hostName)
      console.log('GraphQL endpoint:', import.meta.env.VITE_GRAPHQL_ENDPOINT)
      console.log('API Key:', import.meta.env.VITE_API_KEY ? 'Set' : 'Not set')

      const result = await callGraphQL(CREATE_ROOM, { hostName })

      console.log('Room created successfully:', result)
      const room = result.data.createRoom
      const sessionData = {
        roomId: room.roomId,
        playerId: room.hostId,
        playerName: hostName,
        isHost: true
      }
      setMultiplayerData(sessionData)
      saveSession(sessionData)
      setScreen('game')
    } catch (error) {
      console.error('Failed to create room:', error)

      // エラーの詳細を展開して表示
      if (error.errors && error.errors.length > 0) {
        console.error('GraphQL Errors:')
        error.errors.forEach((err, index) => {
          console.error(`Error ${index + 1}:`, {
            message: err.message,
            errorType: err.errorType,
            path: err.path,
            locations: err.locations,
            errorInfo: err.errorInfo
          })
        })
      }

      console.error('Full error object:', JSON.stringify(error, null, 2))

      const errorMessage = error.errors?.[0]?.message || error.message || 'Unknown error'
      throw new Error('ルームの作成に失敗しました: ' + errorMessage)
    }
  }

  // ルームに参加
  const handleJoinRoom = async (roomCode, playerName) => {
    try {
      const result = await callGraphQL(JOIN_ROOM, { roomCode, playerName })

      const player = result.data.joinRoom
      const sessionData = {
        roomId: player.roomId,
        playerId: player.playerId,
        playerName: playerName,
        isHost: false
      }
      setMultiplayerData(sessionData)
      saveSession(sessionData)
      setScreen('game')
    } catch (error) {
      console.error('Failed to join room:', error)
      const errorMessage = error.errors?.[0]?.message || error.message || 'Unknown error'
      throw new Error('ルームへの参加に失敗しました: ' + errorMessage)
    }
  }

  // ロビーに戻る
  const handleBackToLobby = () => {
    setScreen('lobby')
    setMultiplayerData(null)
  }

  // ゲームから退出
  const handleLeaveGame = () => {
    saveSession(null) // セッションを削除
    setScreen('lobby')
    setMultiplayerData(null)
  }

  return (
    <>
      {screen === 'lobby' && (
        <MultiplayerLobby
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          isHostMode={isHostMode}
          initialRoomCode={initialRoomCode}
        />
      )}

      {screen === 'game' && multiplayerData && (
        <MultiplayerGame
          roomId={multiplayerData.roomId}
          playerId={multiplayerData.playerId}
          playerName={multiplayerData.playerName}
          isHost={multiplayerData.isHost}
          onLeave={handleLeaveGame}
        />
      )}
    </>
  )
}

export default App
