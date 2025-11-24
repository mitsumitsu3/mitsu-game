import { useState, useEffect, useRef } from 'react'
import DrawingCanvas from './DrawingCanvas'
import NicoComments from './NicoComments'
import { GET_ROOM } from './graphql/queries'
import { SUBMIT_ANSWER, START_JUDGING, JUDGE_ANSWERS, START_GAME, NEXT_ROUND, END_GAME, LEAVE_ROOM } from './graphql/mutations'
import './MultiplayerGame.css'

const POLLING_INTERVAL = 3000 // 3秒ごとにポーリング

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

function MultiplayerGame({ roomId, playerId, playerName, isHost, onLeave }) {
  const [room, setRoom] = useState(null)
  const [myAnswer, setMyAnswer] = useState({ type: 'text', text: '', drawing: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showResultOverlay, setShowResultOverlay] = useState(false)
  const pollingIntervalRef = useRef(null)
  const lastJudgedAtRef = useRef(null)

  // ルーム情報を取得
  const fetchRoom = async () => {
    try {
      const result = await callGraphQL(GET_ROOM, { roomId })
      if (!result.data.getRoom) {
        // ルームが存在しない場合
        console.error('Room not found, clearing session')
        localStorage.removeItem('mitsu_game_session')
        setError('ルームが存在しません。ホーム画面に戻ります。')
        setTimeout(() => {
          onLeave()
        }, 2000)
        return
      }
      setRoom(result.data.getRoom)
    } catch (err) {
      console.error('Failed to fetch room:', err)
      if (err.errors) {
        console.error('GraphQL Errors:', err.errors)
        err.errors.forEach((error, index) => {
          console.error(`Error ${index + 1}:`, error.message)
        })
      }
      setError('ルーム情報の取得に失敗しました')
    }
  }

  // 初回読み込み
  useEffect(() => {
    fetchRoom()
  }, [roomId])

  // ポーリング開始（WebSocketの代わり）
  useEffect(() => {
    // 定期的にルーム情報を取得
    pollingIntervalRef.current = setInterval(() => {
      fetchRoom()
    }, POLLING_INTERVAL)

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [roomId])

  // 判定結果が更新されたら演出を表示
  useEffect(() => {
    console.log('Checking for judge result:', {
      judgedAt: room?.judgedAt,
      lastJudgedAt: lastJudgedAtRef.current,
      lastJudgeResult: room?.lastJudgeResult
    })
    if (room?.judgedAt && room.judgedAt !== lastJudgedAtRef.current) {
      console.log('Showing result overlay!')
      lastJudgedAtRef.current = room.judgedAt
      setShowResultOverlay(true)

      // 3秒後に演出を非表示
      setTimeout(() => {
        console.log('Hiding result overlay')
        setShowResultOverlay(false)
      }, 3000)
    }
  }, [room?.judgedAt])

  // ゲーム開始（バックエンドで10個のお題を生成）
  const startGame = async () => {
    setLoading(true)
    setError('')

    try {
      // バックエンドでお題を生成してゲーム開始
      await callGraphQL(START_GAME, { roomId })

      // 最新のルーム情報を取得
      await fetchRoom()

    } catch (err) {
      setError(`エラーが発生しました: ${err.message}`)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const submitAnswer = async () => {
    setLoading(true)
    setError('')

    try {
      await callGraphQL(SUBMIT_ANSWER, {
        roomId,
        playerId,
        answerType: myAnswer.type === 'text' ? 'TEXT' : 'DRAWING',
        textAnswer: myAnswer.type === 'text' ? myAnswer.text : null,
        drawingData: myAnswer.type === 'drawing' ? myAnswer.drawing : null
      })

      // 回答をリセット
      setMyAnswer({ type: 'text', text: '', drawing: null })
      // すぐに最新情報を取得
      await fetchRoom()
    } catch (err) {
      setError('回答の提出に失敗しました')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const judgeAnswers = async (isMatch) => {
    setLoading(true)
    try {
      console.log('Judging answers:', { roomId, isMatch })
      const result = await callGraphQL(JUDGE_ANSWERS, { roomId, isMatch })
      console.log('Judge result:', result)
      console.log('Judge result data:', result.data.judgeAnswers)

      // ルーム情報を再取得
      const roomResult = await callGraphQL(GET_ROOM, { roomId })
      console.log('Fresh room data:', roomResult.data.getRoom)
      setRoom(roomResult.data.getRoom)
    } catch (err) {
      console.error('Failed to judge:', err)
      setError('判定に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const nextRound = async () => {
    setMyAnswer({ type: 'text', text: '', drawing: null })

    try {
      // バックエンドで次のお題を取得してラウンド開始
      await callGraphQL(NEXT_ROUND, { roomId })
      await fetchRoom()
    } catch (err) {
      console.error('Failed to start next round:', err)
    }
  }

  const endGame = async () => {
    try {
      await callGraphQL(END_GAME, { roomId })
      await fetchRoom()
    } catch (err) {
      console.error('Failed to end game:', err)
    }
  }

  const handleLeave = async () => {
    try {
      await callGraphQL(LEAVE_ROOM, { roomId, playerId })
      onLeave()
    } catch (err) {
      console.error('Failed to leave room:', err)
      onLeave()
    }
  }

  if (!room) {
    return <div className="loading">ルーム情報を読み込み中...</div>
  }

  const mySubmittedAnswer = room.answers?.find(a => a.playerId === playerId)
  const allAnswered = room.players?.length > 0 &&
                     room.answers?.length === room.players?.length

  return (
    <div className="multiplayer-game">
      <div className="game-screen">
        {/* ヘッダー */}
        <div className="game-header">
          <div className="room-info">
            <h2>ルームコード: <span className="room-code">{room.roomCode}</span></h2>
            <p>あなた: {playerName} {isHost && '(ホスト)'}</p>
          </div>
          <button className="leave-button" onClick={handleLeave}>
            退出
          </button>
        </div>

        {/* メインコンテンツエリア */}
        <div className="game-content" style={{ position: 'relative' }}>
          {/* ニコニココメント表示（次のラウンドに進んでも流し続ける） */}
          {room.comments && room.comments.length > 0 && room.judgedAt && (
            <NicoComments key={room.judgedAt} comments={room.comments} />
          )}

          {/* プレイヤー情報 */}
          <div className="players-info">
            <h3>参加者 ({room.players?.length || 0}人)</h3>
            <div className="players-list">
              {room.players?.map(p => (
                <div key={p.playerId} className="player-badge">
                  {p.name} {p.role === 'HOST' && '👑'}
                  {room.answers?.some(a => a.playerId === p.playerId) && ' ✓'}
                </div>
              ))}
            </div>
          </div>

          {error && <div className="error">{error}</div>}

          {/* 待機画面 */}
          {room.state === 'WAITING' && (
            <div className="waiting-screen">
              <h2>待機中...</h2>
              {isHost ? (
                <button
                  onClick={startGame}
                  disabled={loading || room.players?.length < 2}
                  className="primary-button"
                >
                  {loading ? 'お題を生成中...' : 'ゲーム開始'}
                </button>
              ) : (
                <p>ホストがゲームを開始するまでお待ちください</p>
              )}
              {room.players?.length < 2 && (
                <p className="warning">※ 2人以上必要です</p>
              )}
            </div>
          )}

          {/* 回答入力画面 */}
          {room.state === 'ANSWERING' && (
            <div className="answering-screen">
              <h2>お題</h2>
              <div className="topic">{room.topic}</div>

              {!mySubmittedAnswer ? (
                <div className="my-answer-section">
                  <h3>あなたの回答</h3>
                  <div className="answer-header">
                    <div className="answer-type-buttons">
                      <button
                        className={`type-btn ${myAnswer.type === 'text' ? 'active' : ''}`}
                        onClick={() => setMyAnswer({ type: 'text', text: '', drawing: null })}
                      >
                        テキスト
                      </button>
                      <button
                        className={`type-btn ${myAnswer.type === 'drawing' ? 'active' : ''}`}
                        onClick={() => setMyAnswer({ type: 'drawing', text: '', drawing: null })}
                      >
                        お絵描き
                      </button>
                    </div>
                  </div>

                  {myAnswer.type === 'text' ? (
                    <input
                      type="text"
                      value={myAnswer.text}
                      onChange={(e) => setMyAnswer({ ...myAnswer, text: e.target.value })}
                      placeholder="回答を入力"
                      className="answer-input"
                    />
                  ) : (
                    <DrawingCanvas
                      onDrawingComplete={(data) => setMyAnswer({ ...myAnswer, drawing: data })}
                      initialData={myAnswer.drawing}
                    />
                  )}

                  <button
                    onClick={submitAnswer}
                    disabled={loading || (myAnswer.type === 'text' ? !myAnswer.text.trim() : !myAnswer.drawing)}
                    className="primary-button"
                  >
                    {loading ? '提出中...' : '回答を提出'}
                  </button>
                </div>
              ) : (
                <div className="submitted-message">
                  <p>✓ 回答を提出しました</p>
                  <p>他のプレイヤーの回答を待っています... ({room.answers?.length}/{room.players?.length})</p>
                </div>
              )}

              {isHost && allAnswered && (
                <button
                  onClick={async () => {
                    try {
                      await callGraphQL(START_JUDGING, { roomId })
                      await fetchRoom()
                    } catch (err) {
                      console.error('Failed to start judging:', err)
                    }
                  }}
                  className="primary-button"
                >
                  判定画面へ
                </button>
              )}
            </div>
          )}

          {/* 判定画面 */}
          {(() => {
            const isJudging = room.state === 'JUDGING'
            console.log('Judging screen check:', {
              state: room.state,
              isJudging,
              roomData: room
            })
            return isJudging
          })() && (
            <div className="judging-screen">
              <h2>お題</h2>
              <div className="topic">{room.topic}</div>

              <h2>みんなの回答</h2>
              <div className="answers-grid">
                {room.answers?.map(answer => (
                  <div key={answer.answerId} className="answer-card">
                    <div className="answer-card-header">
                      {answer.playerName}
                    </div>
                    <div className="answer-card-content">
                      {answer.answerType === 'TEXT' ? (
                        <div className="answer-text">{answer.textAnswer}</div>
                      ) : (
                        <div className="answer-drawing-preview">
                          <img src={answer.drawingData} alt={`${answer.playerName}の絵`} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {(() => {
                const shouldShowButtons = isHost && !room.lastJudgeResult && room.lastJudgeResult !== false
                console.log('Judge buttons check:', {
                  isHost,
                  lastJudgeResult: room.lastJudgeResult,
                  shouldShowButtons
                })
                return shouldShowButtons ? (
                  <div className="judge-buttons">
                    <button
                      onClick={() => {
                        console.log('Judge button clicked!')
                        judgeAnswers(true)
                      }}
                      disabled={loading}
                      className="success-button"
                    >
                      {loading ? 'コメント生成中...' : '一致している！'}
                    </button>
                    <button
                      onClick={() => {
                        console.log('Judge button clicked!')
                        judgeAnswers(false)
                      }}
                      disabled={loading}
                      className="fail-button"
                    >
                      {loading ? 'コメント生成中...' : '一致していない'}
                    </button>
                  </div>
                ) : null
              })()}

              {(room.lastJudgeResult === true || room.lastJudgeResult === false) && (
                <div>
                  <div className="judge-result">
                    {room.lastJudgeResult ? (
                      <p className="success-message">✓ 正解！全員の答えが一致しました！</p>
                    ) : (
                      <p className="fail-message">✗ 残念！答えが一致しませんでした。</p>
                    )}
                  </div>
                  {isHost && (
                    <div className="next-buttons">
                      <button
                        onClick={nextRound}
                        disabled={loading}
                        className="primary-button"
                      >
                        {loading ? '次のお題を生成中...' : '次へ'}
                      </button>
                      <button
                        onClick={endGame}
                        className="secondary-button"
                      >
                        終了
                      </button>
                    </div>
                  )}
                  {!isHost && <p>ホストが次のラウンドを開始するまでお待ちください</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 判定結果の全画面演出 */}
      {(() => {
        const shouldShow = showResultOverlay && room?.lastJudgeResult !== null && room?.lastJudgeResult !== undefined
        console.log('Overlay render check:', {
          showResultOverlay,
          lastJudgeResult: room?.lastJudgeResult,
          shouldShow
        })
        return shouldShow ? (
          <div className={`result-overlay ${room.lastJudgeResult ? 'success' : 'fail'}`}>
            <div className="result-content">
              <div className="result-icon">
                {room.lastJudgeResult ? '🎉' : '😢'}
              </div>
              <h1 className="result-title">
                {room.lastJudgeResult ? '正解！' : '不正解...'}
              </h1>
              <p className="result-message">
                {room.lastJudgeResult ? '全員の答えが一致しました！' : '答えが一致しませんでした'}
              </p>
            </div>
          </div>
        ) : null
      })()}
    </div>
  )
}

export default MultiplayerGame
