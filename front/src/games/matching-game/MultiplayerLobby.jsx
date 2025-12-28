import { useState, useEffect } from 'react'
import './MultiplayerLobby.css'

function MultiplayerLobby({ onCreateRoom, onJoinRoom, isHostMode, initialRoomCode = '' }) {
  const [mode, setMode] = useState(null) // 'create' or 'join'
  const [playerName, setPlayerName] = useState('')
  const [roomCode, setRoomCode] = useState(initialRoomCode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // initialRoomCodeが変わったときにroomCodeを更新
  useEffect(() => {
    if (initialRoomCode) {
      setRoomCode(initialRoomCode)
    }
  }, [initialRoomCode])

  const handleCreateRoom = async (e) => {
    e.preventDefault()
    if (!playerName.trim()) {
      setError('名前を入力してください')
      return
    }

    setLoading(true)
    setError('')
    try {
      await onCreateRoom(playerName)
    } catch (err) {
      setError(err.message || 'ルームの作成に失敗しました')
      setLoading(false)
    }
  }

  const handleJoinRoom = async (e) => {
    e.preventDefault()
    if (!playerName.trim()) {
      setError('名前を入力してください')
      return
    }
    if (!roomCode.trim()) {
      setError('ルームコードを入力してください')
      return
    }

    setLoading(true)
    setError('')
    try {
      await onJoinRoom(roomCode.toUpperCase(), playerName)
    } catch (err) {
      setError(err.message || 'ルームへの参加に失敗しました')
      setLoading(false)
    }
  }

  // ルームコードがURLで指定されている場合は参加画面へ（ゲストモード）
  // それ以外はホストモード（作成/参加を選択可能）
  const isGuestMode = initialRoomCode && initialRoomCode.length > 0

  if (!mode && isGuestMode) {
    return (
      <div className="multiplayer-lobby">
        <h2>ルームに参加</h2>
        <form onSubmit={handleJoinRoom} className="lobby-form">
          <div className="form-group">
            <label>ルームコード</label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="6文字のコード"
              maxLength={6}
              disabled={loading}
              className="room-code-input"
            />
          </div>

          <div className="form-group">
            <label>あなたの名前</label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="プレイヤー名を入力"
              maxLength={20}
              disabled={loading}
            />
          </div>

          {error && <div className="error">{error}</div>}

          <div className="form-buttons">
            <button
              type="submit"
              className="primary-button"
              disabled={loading || !playerName.trim() || !roomCode.trim()}
            >
              {loading ? '参加中...' : 'ルームに参加'}
            </button>
          </div>
        </form>
      </div>
    )
  }

  // ホストモード（ルームコードがURLにない場合）
  if (!mode && !isGuestMode) {
    return (
      <div className="multiplayer-lobby">
        <h2>一致させゲーム</h2>
        <div className="lobby-buttons">
          <button
            className="lobby-button create-button"
            onClick={() => setMode('create')}
          >
            <div className="button-icon">➕</div>
            <h3>ルームを作成</h3>
            <p>ホストとしてゲームを開始</p>
          </button>

          <button
            className="lobby-button join-button"
            onClick={() => setMode('join')}
          >
            <div className="button-icon">🔗</div>
            <h3>ルームに参加</h3>
            <p>コードを入力して参加</p>
          </button>
        </div>

      </div>
    )
  }

  if (mode === 'create') {
    return (
      <div className="multiplayer-lobby">
        <h2>ルームを作成</h2>
        <form onSubmit={handleCreateRoom} className="lobby-form">
          <div className="form-group">
            <label>あなたの名前</label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="ホスト名を入力"
              maxLength={20}
              disabled={loading}
            />
          </div>

          {error && <div className="error">{error}</div>}

          <div className="form-buttons">
            <button
              type="submit"
              className="primary-button"
              disabled={loading || !playerName.trim()}
            >
              {loading ? 'ルーム作成中...' : 'ルームを作成'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setMode(null)}
              disabled={loading}
            >
              キャンセル
            </button>
          </div>
        </form>
      </div>
    )
  }

  if (mode === 'join') {
    return (
      <div className="multiplayer-lobby">
        <h2>ルームに参加</h2>
        <form onSubmit={handleJoinRoom} className="lobby-form">
          <div className="form-group">
            <label>ルームコード</label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="6文字のコード"
              maxLength={6}
              disabled={loading}
              className="room-code-input"
            />
          </div>

          <div className="form-group">
            <label>あなたの名前</label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="プレイヤー名を入力"
              maxLength={20}
              disabled={loading}
            />
          </div>

          {error && <div className="error">{error}</div>}

          <div className="form-buttons">
            <button
              type="submit"
              className="primary-button"
              disabled={loading || !playerName.trim() || !roomCode.trim()}
            >
              {loading ? '参加中...' : 'ルームに参加'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setMode(null)}
              disabled={loading}
            >
              キャンセル
            </button>
          </div>
        </form>
      </div>
    )
  }
}

export default MultiplayerLobby
