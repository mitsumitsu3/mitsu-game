import { useState, useEffect, useRef } from 'react'
import { generateClient } from 'aws-amplify/api'
import NicoComments from './NicoComments'
import { GET_ROOM, ON_ROOM_UPDATED, ON_PLAYER_JOINED, ON_ANSWER_SUBMITTED, ON_JUDGE_RESULT } from './graphql/queries'
import { SUBMIT_ANSWER, START_JUDGING, GENERATE_JUDGING_COMMENTS, JUDGE_ANSWERS, START_GAME, NEXT_ROUND, END_GAME, LEAVE_ROOM, KICK_PLAYER, DELETE_ALL_DATA } from './graphql/mutations'
import './MultiplayerGame.css'

const POLLING_INTERVAL = 30000 // 30秒ごとにポーリング（Subscriptionのフォールバック用）

// Amplify GraphQL Client（IAM認証 + Cognito Identity Pool）
const client = generateClient()

function MultiplayerGame({ roomId, playerId, playerName, isHost, onLeave }) {
  const [room, setRoom] = useState(null)
  const [myAnswer, setMyAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showResultOverlay, setShowResultOverlay] = useState(false)
  const [showHostMenu, setShowHostMenu] = useState(false)
  const pollingIntervalRef = useRef(null)
  const lastJudgedAtRef = useRef(null)
  const subscriptionsRef = useRef([])

  // ルーム情報を取得
  const fetchRoom = async () => {
    try {
      const result = await client.graphql({
        query: GET_ROOM,
        variables: { roomId }
      })
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

      // 自分がルームから追放されていないか確認
      const myPlayerExists = result.data.getRoom.players?.some(p => p.playerId === playerId)
      if (!myPlayerExists) {
        console.log('Player was kicked from room')
        localStorage.removeItem('mitsu_game_session')
        alert('ホストによりルームから追放されました。')
        onLeave()
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

  // Subscriptionのセットアップ（roomがロードされてから）
  useEffect(() => {
    if (!room?.roomCode) {
      console.log('Waiting for room data before setting up subscriptions')
      return
    }
    console.log('Setting up subscriptions for roomId:', roomId, 'roomCode:', room.roomCode)

    // Subscriptionを解除するヘルパー関数
    const unsubscribeAll = () => {
      subscriptionsRef.current.forEach(sub => {
        if (sub && sub.unsubscribe) {
          sub.unsubscribe()
        }
      })
      subscriptionsRef.current = []
    }

    // 1. ルーム更新のSubscription（ゲーム開始、判定画面遷移、次ラウンド、終了）
    try {
      const roomSub = client.graphql({
        query: ON_ROOM_UPDATED,
        variables: { roomId }
      }).subscribe({
        next: (response) => {
          console.log('onRoomUpdated RAW response:', response)
          console.log('onRoomUpdated RAW response JSON:', JSON.stringify(response, null, 2))
          const data = response.data
          console.log('onRoomUpdated data:', data)
          if (data?.onRoomUpdated) {
            console.log('onRoomUpdated room:', data.onRoomUpdated)
            // 自分がルームから追放されていないか確認
            const myPlayerExists = data.onRoomUpdated.players?.some(p => p.playerId === playerId)
            if (!myPlayerExists) {
              console.log('Player was kicked from room (via subscription)')
              localStorage.removeItem('mitsu_game_session')
              alert('ホストによりルームから追放されました。')
              onLeave()
              return
            }
            setRoom(data.onRoomUpdated)
          }
        },
        error: (err) => {
          console.error('onRoomUpdated subscription error:', err)
        }
      })
      subscriptionsRef.current.push(roomSub)
    } catch (err) {
      console.error('Failed to setup onRoomUpdated subscription:', err)
    }

    // 2. プレイヤー参加のSubscription（roomCodeでフィルタ）
    try {
      const playerSub = client.graphql({
        query: ON_PLAYER_JOINED,
        variables: { roomCode: room?.roomCode }
      }).subscribe({
        next: (response) => {
          console.log('onPlayerJoined RAW response:', response)
          console.log('onPlayerJoined RAW response JSON:', JSON.stringify(response, null, 2))
          const data = response.data
          console.log('onPlayerJoined data:', data)
          if (data?.onPlayerJoined) {
            console.log('onPlayerJoined player:', data.onPlayerJoined)
            // 新しいプレイヤーをリストに追加
            setRoom(prev => {
              if (!prev) return prev
              const playerExists = prev.players?.some(p => p.playerId === data.onPlayerJoined.playerId)
              if (playerExists) return prev
              return {
                ...prev,
                players: [...(prev.players || []), data.onPlayerJoined]
              }
            })
          }
        },
        error: (err) => {
          console.error('onPlayerJoined subscription error:', err)
        }
      })
      subscriptionsRef.current.push(playerSub)
    } catch (err) {
      console.error('Failed to setup onPlayerJoined subscription:', err)
    }

    // 3. 回答提出のSubscription
    try {
      const answerSub = client.graphql({
        query: ON_ANSWER_SUBMITTED,
        variables: { roomId }
      }).subscribe({
        next: ({ data }) => {
          console.log('onAnswerSubmitted received:', data)
          if (data?.onAnswerSubmitted) {
            // 新しい回答をリストに追加
            setRoom(prev => {
              if (!prev) return prev
              const answerExists = prev.answers?.some(a => a.answerId === data.onAnswerSubmitted.answerId)
              if (answerExists) return prev
              return {
                ...prev,
                answers: [...(prev.answers || []), data.onAnswerSubmitted]
              }
            })
          }
        },
        error: (err) => {
          console.error('onAnswerSubmitted subscription error:', err)
        }
      })
      subscriptionsRef.current.push(answerSub)
    } catch (err) {
      console.error('Failed to setup onAnswerSubmitted subscription:', err)
    }

    // 4. 判定結果のSubscription
    try {
      const judgeSub = client.graphql({
        query: ON_JUDGE_RESULT,
        variables: { roomId }
      }).subscribe({
        next: ({ data }) => {
          console.log('onJudgeResult received:', data)
          if (data?.onJudgeResult) {
            // 判定結果を反映（lastJudgeResultのみ更新、judgedAtは更新しない）
            // judgedAtはコメント生成完了時に設定されるもので、判定時には変更しない
            setRoom(prev => {
              if (!prev) return prev
              return {
                ...prev,
                lastJudgeResult: data.onJudgeResult.isMatch
              }
            })
          }
        },
        error: (err) => {
          console.error('onJudgeResult subscription error:', err)
        }
      })
      subscriptionsRef.current.push(judgeSub)
    } catch (err) {
      console.error('Failed to setup onJudgeResult subscription:', err)
    }

    // フォールバック：ポーリング（Subscriptionが動作しない場合の保険）
    pollingIntervalRef.current = setInterval(() => {
      fetchRoom()
    }, POLLING_INTERVAL)

    return () => {
      unsubscribeAll()
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [roomId, room?.roomCode])

  // 判定結果が更新されたら演出を表示
  // ただし、初回ロード時（リロード含む）は演出をスキップ
  const isInitialLoadRef = useRef(true)

  useEffect(() => {
    console.log('Checking for judge result:', {
      judgedAt: room?.judgedAt,
      lastJudgedAt: lastJudgedAtRef.current,
      lastJudgeResult: room?.lastJudgeResult,
      isInitialLoad: isInitialLoadRef.current
    })

    // 初回ロード時はjudgedAtを記録するだけで演出はスキップ
    if (isInitialLoadRef.current && room?.judgedAt) {
      console.log('Initial load - skipping overlay, recording judgedAt')
      lastJudgedAtRef.current = room.judgedAt
      isInitialLoadRef.current = false
      return
    }

    // 初回ロードが完了したらフラグを下げる
    if (isInitialLoadRef.current && room) {
      isInitialLoadRef.current = false
    }

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
  }, [room?.judgedAt, room])


  // ゲーム開始（バックエンドで10個のお題を生成）
  const startGame = async () => {
    setLoading(true)
    setError('')

    try {
      // バックエンドでお題を生成してゲーム開始
      await client.graphql({
        query: START_GAME,
        variables: { roomId }
      })

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
      await client.graphql({
        query: SUBMIT_ANSWER,
        variables: {
          roomId,
          playerId,
          answerType: 'TEXT',
          textAnswer: myAnswer,
          drawingData: null
        }
      })

      // 回答をリセット
      setMyAnswer('')
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
      const result = await client.graphql({
        query: JUDGE_ANSWERS,
        variables: { roomId, isMatch }
      })
      console.log('Judge result:', result)
      console.log('Judge result data:', result.data.judgeAnswers)

      // ルーム情報を再取得
      const roomResult = await client.graphql({
        query: GET_ROOM,
        variables: { roomId }
      })
      console.log('Fresh room data:', roomResult.data.getRoom)
      setRoom(roomResult.data.getRoom)
    } catch (err) {
      console.error('Failed to judge:', err)
      setError('判定に失敗しました')
    }
  }

  const nextRound = async () => {
    setMyAnswer('')

    try {
      // バックエンドで次のお題を取得してラウンド開始
      await client.graphql({
        query: NEXT_ROUND,
        variables: { roomId }
      })
      await fetchRoom()
    } catch (err) {
      console.error('Failed to start next round:', err)
    }
  }

  const endGame = async () => {
    try {
      await client.graphql({
        query: END_GAME,
        variables: { roomId }
      })
      await fetchRoom()
    } catch (err) {
      console.error('Failed to end game:', err)
    }
  }

  const handleLeave = async () => {
    try {
      await client.graphql({
        query: LEAVE_ROOM,
        variables: { roomId, playerId }
      })
      onLeave()
    } catch (err) {
      console.error('Failed to leave room:', err)
      onLeave()
    }
  }

  // プレイヤーを追放
  const kickPlayer = async (kickedPlayerId, kickedPlayerName) => {
    if (!confirm(`${kickedPlayerName} をルームから追放しますか？`)) {
      return
    }

    try {
      await client.graphql({
        query: KICK_PLAYER,
        variables: { roomId, playerId, kickedPlayerId }
      })
      await fetchRoom()
      setShowHostMenu(false)
    } catch (err) {
      console.error('Failed to kick player:', err)
      setError('プレイヤーの追放に失敗しました')
    }
  }

  const deleteAllData = async () => {
    if (!confirm('本当に全てのデータを削除しますか？この操作は取り消せません。')) {
      return
    }

    setLoading(true)
    try {
      console.log('Calling deleteAllData mutation...')
      const result = await client.graphql({
        query: DELETE_ALL_DATA
      })
      console.log('deleteAllData result:', result)
      alert(`削除完了:\nルーム: ${result.data.deleteAllData.deletedCounts.rooms}件\nプレイヤー: ${result.data.deleteAllData.deletedCounts.players}件\n回答: ${result.data.deleteAllData.deletedCounts.answers}件`)
      // ホーム画面に戻る
      onLeave()
    } catch (err) {
      console.error('deleteAllData error:', err)
      if (err.errors) {
        console.error('GraphQL errors:', err.errors)
        err.errors.forEach((error, index) => {
          console.error(`Error ${index + 1}:`, error.message, error)
        })
        setError(`データ削除に失敗しました: ${err.errors[0].message}`)
      } else {
        setError('データ削除に失敗しました')
      }
    } finally {
      setLoading(false)
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
              <div className="game-title">一致させ<br />げーむ</div>

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
                  <button
                    onClick={deleteAllData}
                    disabled={loading}
                    className="black-button"
                    style={{ backgroundColor: '#dc2626', marginTop: '2rem' }}
                  >
                    {loading ? '削除中...' : '全データ削除（開発用）'}
                  </button>
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
                      onClick={() => setMyAnswer('')}
                      className="white-outline-button"
                    >
                      書き直す
                    </button>
                    <button
                      onClick={submitAnswer}
                      disabled={loading || !myAnswer.trim()}
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
                    <input
                      type="text"
                      value={myAnswer}
                      onChange={(e) => setMyAnswer(e.target.value)}
                      placeholder="(入力してください)"
                      className="answer-display-input"
                    />
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
                          // 判定画面に遷移（即座に画面遷移）
                          await client.graphql({
                            query: START_JUDGING,
                            variables: { roomId }
                          })
                          await fetchRoom()

                          // コメント生成を非同期で開始（awaitしない）
                          client.graphql({
                            query: GENERATE_JUDGING_COMMENTS,
                            variables: { roomId }
                          }).then(() => {
                            console.log('コメント生成完了')
                          }).catch(err => {
                            console.error('コメント生成に失敗:', err)
                          })
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
              {/* コメント生成状態の表示（全員に表示） */}
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
                    <div className="answer-card-content">
                      <div className="answer-text">{answer.textAnswer}</div>
                    </div>
                    <div className="answer-card-footer">
                      {answer.playerName}
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
            <h2>ルームコード: <span className="room-code">{room.roomCode}</span>
              <button
                className="share-button"
                onClick={() => {
                  const shareUrl = `${window.location.origin}${window.location.pathname}?room=${room.roomCode}`
                  navigator.clipboard.writeText(shareUrl)
                    .then(() => alert('招待URLをコピーしました！'))
                    .catch(() => alert('コピーに失敗しました'))
                }}
                title="招待URLをコピー"
              >
                📋
              </button>
            </h2>
            <p>あなた: {playerName} {isHost && '(ホスト)'}</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {isHost && (
              <button
                className="leave-button"
                onClick={() => setShowHostMenu(true)}
                style={{ backgroundColor: '#4a5568' }}
              >
                参加者管理
              </button>
            )}
            <button className="leave-button" onClick={handleLeave}>
              退出
            </button>
          </div>
        </div>
      </div>

      {/* ホスト用メニュー（参加者管理） */}
      {showHostMenu && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '1.5rem',
            width: '90%',
            maxWidth: '400px',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '1rem'
            }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#333' }}>参加者管理</h2>
              <button
                onClick={() => setShowHostMenu(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#666'
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '1rem', color: '#666', fontSize: '0.9rem' }}>
              参加者: {room.players?.length}人
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {room.players?.map(player => (
                <div
                  key={player.playerId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.8rem 1rem',
                    backgroundColor: player.playerId === playerId ? '#e8f5e9' : '#f5f5f5',
                    borderRadius: '8px',
                    border: player.role === 'HOST' ? '2px solid #4caf50' : '1px solid #ddd'
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 'bold', color: '#333' }}>{player.name}</span>
                    {player.role === 'HOST' && (
                      <span style={{
                        marginLeft: '0.5rem',
                        fontSize: '0.75rem',
                        backgroundColor: '#4caf50',
                        color: 'white',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '4px'
                      }}>
                        ホスト
                      </span>
                    )}
                    {player.playerId === playerId && (
                      <span style={{
                        marginLeft: '0.5rem',
                        fontSize: '0.75rem',
                        color: '#666'
                      }}>
                        (あなた)
                      </span>
                    )}
                    {/* 回答済みかどうか表示 */}
                    {room.state === 'ANSWERING' && (
                      <span style={{
                        marginLeft: '0.5rem',
                        fontSize: '0.75rem',
                        color: room.answers?.some(a => a.playerId === player.playerId) ? '#4caf50' : '#ff9800'
                      }}>
                        {room.answers?.some(a => a.playerId === player.playerId) ? '✓回答済' : '未回答'}
                      </span>
                    )}
                  </div>
                  {player.playerId !== playerId && (
                    <button
                      onClick={() => kickPlayer(player.playerId, player.name)}
                      style={{
                        backgroundColor: '#dc2626',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.4rem 0.8rem',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        fontWeight: 'bold'
                      }}
                    >
                      追放
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowHostMenu(false)}
              style={{
                width: '100%',
                marginTop: '1.5rem',
                padding: '0.8rem',
                backgroundColor: '#333',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '1rem',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}

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
