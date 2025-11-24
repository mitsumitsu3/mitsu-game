import { useState, useEffect } from 'react'
import ModeSelection from './ModeSelection'
import SinglePlayerGame from './SinglePlayerGame'
import MultiplayerLobby from './MultiplayerLobby'
import MultiplayerGame from './MultiplayerGame'
import { CREATE_ROOM, JOIN_ROOM } from './graphql/mutations'
import './App.css'

const STORAGE_KEY = 'mitsu_game_session'

function App() {
  const [screen, setScreen] = useState('mode-selection') // mode-selection, single, multi-lobby, multi-game
  const [multiplayerData, setMultiplayerData] = useState(null)

  // ページ読み込み時にセッションを復元
  useEffect(() => {
    const savedSession = localStorage.getItem(STORAGE_KEY)
    if (savedSession) {
      try {
        const session = JSON.parse(savedSession)
        console.log('Restoring session:', session)
        setMultiplayerData(session)
        setScreen('multi-game')
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

  // シングルプレイモードを選択
  const handleSelectSingleMode = () => {
    setScreen('single')
  }

  // マルチプレイヤーモードを選択
  const handleSelectMultiMode = () => {
    setScreen('multi-lobby')
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
      setScreen('multi-game')
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
      setScreen('multi-game')
    } catch (error) {
      console.error('Failed to join room:', error)
      const errorMessage = error.errors?.[0]?.message || error.message || 'Unknown error'
      throw new Error('ルームへの参加に失敗しました: ' + errorMessage)
    }
  }

  // モード選択に戻る
  const handleBackToModeSelection = () => {
    setScreen('mode-selection')
    setMultiplayerData(null)
  }

  // マルチプレイヤーロビーに戻る
  const handleBackToLobby = () => {
    setScreen('multi-lobby')
    setMultiplayerData(null)
  }

  // マルチプレイヤーゲームから退出
  const handleLeaveGame = () => {
    saveSession(null) // セッションを削除
    setScreen('multi-lobby')
    setMultiplayerData(null)
  }

  return (
    <>
      {screen === 'mode-selection' && (
        <ModeSelection
          onSelectMode={(mode) =>
            mode === 'single' ? handleSelectSingleMode() : handleSelectMultiMode()
          }
        />
      )}

      {screen === 'single' && (
        <SinglePlayerGame onBack={handleBackToModeSelection} />
      )}

      {screen === 'multi-lobby' && (
        <MultiplayerLobby
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onBack={handleBackToModeSelection}
        />
      )}

      {screen === 'multi-game' && multiplayerData && (
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
