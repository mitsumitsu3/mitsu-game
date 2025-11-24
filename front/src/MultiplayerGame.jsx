import { useState, useEffect, useRef } from 'react'
import DrawingCanvas from './DrawingCanvas'
import NicoComments from './NicoComments'
import { GET_ROOM } from './graphql/queries'
import { SUBMIT_ANSWER, START_JUDGING, GENERATE_JUDGING_COMMENTS, JUDGE_ANSWERS, START_GAME, NEXT_ROUND, END_GAME, LEAVE_ROOM } from './graphql/mutations'
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
        {/* メインコンテンツエリア */}
        <div className={`game-content ${
          room.state === 'ANSWERING' ? 'blue-bg' : 'yellow-radial'
        }`} style={{ position: 'relative' }}>
          {/* ニコニココメント表示（次のラウンドに進んでも流し続ける） */}
          {room.comments && room.comments.length > 0 && room.judgedAt && (
            <NicoComments comments={room.comments} judgedAt={room.judgedAt} />
          )}

          {error && <div className="error">{error}</div>}

          {/* 待機画面 */}
          {room.state === 'WAITING' && (
            <div className="waiting-screen">
              <div className="game-title">一緒するまで<br />終われまラン!!</div>
              <div className="game-subtitle">全員の答えが10回一致するまでヤメちゃダメ</div>

              {isHost ? (
                <>
                  <button
                    onClick={startGame}
                    disabled={loading || room.players?.length < 2}
                    className="black-button"
                  >
                    {loading ? 'お題を生成中...' : 'ゲーム開始'}
                  </button>
                  {room.players?.length < 2 && (
                    <p className="warning">※ 2人以上必要です</p>
                  )}
                </>
              ) : (
                <p style={{ color: '#333', fontSize: '1.2rem' }}>
                  ホストがゲームを開始するまでお待ちください
                </p>
              )}
            </div>
          )}

          {/* 回答入力画面 */}
          {room.state === 'ANSWERING' && (
            <div className="answering-screen">
              {!mySubmittedAnswer ? (
                <>
                  <div className="top-buttons">
                    <button
                      onClick={() => setMyAnswer({ ...myAnswer, text: '', drawing: null })}
                      className="white-outline-button"
                    >
                      書き直す
                    </button>
                    <button
                      onClick={submitAnswer}
                      disabled={loading || (myAnswer.type === 'text' ? !myAnswer.text.trim() : !myAnswer.drawing)}
                      className="white-outline-button"
                    >
                      {loading ? '提出中...' : '回答を送付'}
                    </button>
                  </div>

                  {/* お題を表示 */}
                  <div style={{
                    color: 'white',
                    fontSize: '1.5rem',
                    fontWeight: 'bold',
                    marginBottom: '1.5rem',
                    textAlign: 'center'
                  }}>
                    {room.topic}
                  </div>

                  <div className="answer-display-area">
                    {myAnswer.type === 'text' ? (
                      <div className="answer-display-text">{myAnswer.text || '(入力してください)'}</div>
                    ) : (
                      <DrawingCanvas
                        onDrawingComplete={(data) => setMyAnswer({ ...myAnswer, drawing: data })}
                        initialData={myAnswer.drawing}
                      />
                    )}
                  </div>

                  <div className="answer-input-bottom">
                    <div style={{ marginBottom: '1rem' }}>
                      <button
                        style={{
                          backgroundColor: myAnswer.type === 'text' ? 'white' : 'transparent',
                          color: myAnswer.type === 'text' ? '#0d47a1' : 'white',
                          border: '2px solid white',
                          padding: '0.5rem 2rem',
                          marginRight: '1rem',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontWeight: 'bold'
                        }}
                        onClick={() => setMyAnswer({ type: 'text', text: '', drawing: null })}
                      >
                        テキスト
                      </button>
                      <button
                        style={{
                          backgroundColor: myAnswer.type === 'drawing' ? 'white' : 'transparent',
                          color: myAnswer.type === 'drawing' ? '#0d47a1' : 'white',
                          border: '2px solid white',
                          padding: '0.5rem 2rem',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontWeight: 'bold'
                        }}
                        onClick={() => setMyAnswer({ type: 'drawing', text: '', drawing: null })}
                      >
                        お絵描き
                      </button>
                    </div>
                    {myAnswer.type === 'text' && (
                      <input
                        type="text"
                        value={myAnswer.text}
                        onChange={(e) => setMyAnswer({ ...myAnswer, text: e.target.value })}
                        placeholder="キーボードで入力"
                        style={{
                          backgroundColor: 'transparent',
                          border: 'none',
                          borderBottom: '2px solid white',
                          color: 'white',
                          fontSize: '1.2rem',
                          padding: '0.5rem',
                          textAlign: 'center',
                          width: '300px',
                          outline: 'none'
                        }}
                      />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="submitted-message">
                    <p>✓ 回答を提出しました</p>
                    <p>他のプレイヤーの回答を待っています... ({room.answers?.length}/{room.players?.length})</p>
                  </div>
                  {isHost && allAnswered && (
                    <button
                      onClick={async () => {
                        setLoading(true)
                        try {
                          // 判定画面に遷移（コメント生成は裏で非同期実行される）
                          await callGraphQL(START_JUDGING, { roomId })
                          await fetchRoom()
                        } catch (err) {
                          console.error('Failed to start judging:', err)
                          setError('判定画面への移動に失敗しました')
                        } finally {
                          setLoading(false)
                        }
                      }}
                      disabled={loading}
                      className="black-button"
                      style={{ marginTop: '2rem' }}
                    >
                      {loading ? '移動中...' : '判定画面へ'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* 判定画面 */}
          {room.state === 'JUDGING' && (
            <div className="judging-screen">
              {/* コメント生成状態の表示（ホストのみ） */}
              {isHost && (
                <div style={{
                  position: 'absolute',
                  top: '20px',
                  right: '20px',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  backgroundColor: room.judgedAt ? '#4caf50' : '#ff9800',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                  zIndex: 100
                }}>
                  {!room.judgedAt ? (
                    <>
                      <div style={{
                        width: '16px',
                        height: '16px',
                        border: '3px solid white',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                      }} />
                      <span>コメント生成中...</span>
                      <style>{`
                        @keyframes spin {
                          to { transform: rotate(360deg); }
                        }
                      `}</style>
                    </>
                  ) : (
                    <>
                      <span>✓</span>
                      <span>コメント生成完了</span>
                    </>
                  )}
                </div>
              )}

              {!room.lastJudgeResult && room.lastJudgeResult !== false && (
                <div className="judge-instruction">
                  全員一致か、不一致を選択して次の問題へ
                </div>
              )}

              {(() => {
                const shouldShowButtons = isHost && !room.lastJudgeResult && room.lastJudgeResult !== false
                return shouldShowButtons ? (
                  <div className="judge-buttons">
                    <button
                      onClick={() => judgeAnswers(true)}
                      className="black-button"
                    >
                      全員一致
                    </button>
                    <button
                      onClick={() => judgeAnswers(false)}
                      className="black-button"
                    >
                      全員不一致
                    </button>
                  </div>
                ) : null
              })()}

              <div className="topic-display">
                {room.topic}
              </div>

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
                        className="black-button"
                      >
                        {loading ? '次のお題を生成中...' : '次へ'}
                      </button>
                      <button
                        onClick={endGame}
                        className="black-button"
                      >
                        終了
                      </button>
                    </div>
                  )}
                  {!isHost && (
                    <p style={{ color: '#333', fontSize: '1.1rem', marginTop: '1rem' }}>
                      ホストが次のラウンドを開始するまでお待ちください
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* フッター（旧ヘッダー） */}
        <div className="game-footer">
          <div className="room-info">
            <h2>ルームコード: <span className="room-code">{room.roomCode}</span></h2>
            <p>あなた: {playerName} {isHost && '(ホスト)'}</p>
          </div>
          <button className="leave-button" onClick={handleLeave}>
            退出
          </button>
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
