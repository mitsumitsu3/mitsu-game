import { useState, useEffect } from 'react'
import GameSelect from './GameSelect'
import MatchingGameApp from './games/matching-game/MatchingGameApp'
import './App.css'

function App() {
  const [selectedGame, setSelectedGame] = useState(null)

  // URLパスとクエリパラメータからゲームを判定
  useEffect(() => {
    const path = window.location.pathname

    // /matching-game または /matching-game?room=XXXX の場合
    if (path === '/matching-game' || path === '/matching-game/') {
      setSelectedGame('matching-game')
    }
    // 旧形式: /?room=XXXX にも対応（後方互換性）
    else {
      const urlParams = new URLSearchParams(window.location.search)
      const roomCodeFromUrl = urlParams.get('room')
      if (roomCodeFromUrl) {
        // 新しいURL形式にリダイレクト
        window.history.replaceState({}, '', `/matching-game?room=${roomCodeFromUrl}`)
        setSelectedGame('matching-game')
      }
    }
  }, [])

  const handleSelectGame = (gameId) => {
    setSelectedGame(gameId)
    // URLパスを更新
    if (gameId === 'matching-game') {
      window.history.pushState({}, '', '/matching-game')
    }
  }

  const handleBackToGameSelect = () => {
    setSelectedGame(null)
    // ルートパスに戻る
    window.history.pushState({}, '', '/')
  }

  // ブラウザの戻る/進むボタンに対応
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname
      if (path === '/matching-game' || path === '/matching-game/') {
        setSelectedGame('matching-game')
      } else {
        setSelectedGame(null)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // ゲーム選択画面
  if (!selectedGame) {
    return <GameSelect onSelectGame={handleSelectGame} />
  }

  // 一致させゲーム
  if (selectedGame === 'matching-game') {
    return <MatchingGameApp onBack={handleBackToGameSelect} />
  }

  // その他のゲーム（将来用）
  return <GameSelect onSelectGame={handleSelectGame} />
}

export default App
