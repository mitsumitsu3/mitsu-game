import { useState } from 'react'
import './App.css'
import DrawingCanvas from './DrawingCanvas'

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY

function SinglePlayerGame({ onBack }) {
  // ゲーム状態
  const [gameState, setGameState] = useState('setup') // setup, answering, judging
  const [topic, setTopic] = useState('')
  const [players, setPlayers] = useState([
    { id: 1, name: 'プレイヤー1', answer: '', answerType: 'text', drawingData: null },
    { id: 2, name: 'プレイヤー2', answer: '', answerType: 'text', drawingData: null },
    { id: 3, name: 'プレイヤー3', answer: '', answerType: 'text', drawingData: null },
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [judged, setJudged] = useState(false) // 判定済みかどうか
  const [lastJudgeResult, setLastJudgeResult] = useState(null) // 最後の判定結果

  // ChatGPT APIでお題を生成
  const generateTopic = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: '「認識合わせゲーム」のお題を生成してください。お題は「〇〇といえば？」という形式で、参加者が同じ答えを出しやすいようなものにしてください。お題だけを出力してください。'
            },
            {
              role: 'user',
              content: 'お題を1つ出してください。'
            }
          ],
          temperature: 0.8,
          max_tokens: 100
        })
      })

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`)
      }

      const data = await response.json()
      const generatedTopic = data.choices[0].message.content.trim()
      setTopic(generatedTopic)

      // プレイヤーの回答をリセット
      setPlayers(players.map(p => ({ ...p, answer: '', drawingData: null })))
      setGameState('answering')

    } catch (err) {
      setError(`エラーが発生しました: ${err.message}`)
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // プレイヤーの回答を更新
  const updateAnswer = (playerId, answer) => {
    setPlayers(players.map(p =>
      p.id === playerId ? { ...p, answer } : p
    ))
  }

  // プレイヤーの回答タイプを変更
  const changeAnswerType = (playerId, type) => {
    setPlayers(players.map(p =>
      p.id === playerId ? { ...p, answerType: type, answer: '', drawingData: null } : p
    ))
  }

  // プレイヤーのお絵描きデータを保存
  const updateDrawing = (playerId, drawingData) => {
    setPlayers(players.map(p =>
      p.id === playerId ? { ...p, drawingData } : p
    ))
  }

  // 全員が回答したか確認
  const allAnswered = players.every(p => {
    if (p.answerType === 'text') {
      return p.answer.trim() !== ''
    } else {
      return p.drawingData !== null
    }
  })

  // 回答を提出して判定画面へ
  const submitAnswers = () => {
    if (allAnswered) {
      setGameState('judging')
    }
  }

  // 回答の一致判定
  const judgeAnswers = (isMatch) => {
    setJudged(true)
    setLastJudgeResult(isMatch)
  }

  // 次のラウンドへ進む
  const nextRound = async () => {
    setJudged(false)
    setLastJudgeResult(null)
    await generateTopic()
  }

  // ゲームを終了してセットアップに戻る
  const endGame = () => {
    setGameState('setup')
    setTopic('')
    setJudged(false)
    setLastJudgeResult(null)
    // プレイヤーの回答をリセット
    setPlayers(players.map(p => ({ ...p, answer: '', drawingData: null })))
  }

  // プレイヤー数変更
  const addPlayer = () => {
    const newId = Math.max(...players.map(p => p.id)) + 1
    setPlayers([...players, {
      id: newId,
      name: `プレイヤー${newId}`,
      answer: '',
      answerType: 'text',
      drawingData: null
    }])
  }

  const removePlayer = (playerId) => {
    if (players.length > 2) {
      setPlayers(players.filter(p => p.id !== playerId))
    }
  }

  return (
    <div className="App">
      <div className="game-header-single">
        <button className="back-button-single" onClick={onBack}>
          ← モード選択に戻る
        </button>
        <h1>認識合わせゲーム (シングルプレイ)</h1>
      </div>

      {/* セットアップ画面 */}
      {gameState === 'setup' && (
        <div className="setup-screen">
          <h2>ゲーム開始</h2>

          <div className="player-management">
            <h3>プレイヤー設定</h3>
            {players.map(p => (
              <div key={p.id} className="player-item">
                <span>{p.name}</span>
                <button
                  onClick={() => removePlayer(p.id)}
                  disabled={players.length <= 2}
                >
                  削除
                </button>
              </div>
            ))}
            <button onClick={addPlayer}>プレイヤー追加</button>
          </div>

          <button
            onClick={generateTopic}
            disabled={loading}
            className="primary-button"
          >
            {loading ? 'お題を生成中...' : 'お題を生成'}
          </button>

          {error && <div className="error">{error}</div>}
        </div>
      )}

      {/* 回答入力画面 */}
      {gameState === 'answering' && (
        <div className="answering-screen">
          <h2>お題</h2>
          <div className="topic">{topic}</div>

          <div className="answer-inputs">
            {players.map(p => (
              <div key={p.id} className="player-answer">
                <div className="answer-header">
                  <label>{p.name}</label>
                  <div className="answer-type-buttons">
                    <button
                      className={`type-btn ${p.answerType === 'text' ? 'active' : ''}`}
                      onClick={() => changeAnswerType(p.id, 'text')}
                    >
                      テキスト
                    </button>
                    <button
                      className={`type-btn ${p.answerType === 'drawing' ? 'active' : ''}`}
                      onClick={() => changeAnswerType(p.id, 'drawing')}
                    >
                      お絵描き
                    </button>
                  </div>
                </div>

                {p.answerType === 'text' ? (
                  <input
                    type="text"
                    value={p.answer}
                    onChange={(e) => updateAnswer(p.id, e.target.value)}
                    placeholder="回答を入力"
                  />
                ) : (
                  <DrawingCanvas
                    onDrawingComplete={(data) => updateDrawing(p.id, data)}
                    initialData={p.drawingData}
                  />
                )}
              </div>
            ))}
          </div>

          <button
            onClick={submitAnswers}
            disabled={!allAnswered}
            className="primary-button"
          >
            回答を提出
          </button>
        </div>
      )}

      {/* 判定画面 */}
      {gameState === 'judging' && (
        <div className="judging-screen">
          <h2>お題</h2>
          <div className="topic">{topic}</div>

          <h2>みんなの回答</h2>
          <div className="answers-grid">
            {players.map(p => (
              <div key={p.id} className="answer-card">
                <div className="answer-card-header">
                  {p.name}
                </div>
                <div className="answer-card-content">
                  {p.answerType === 'text' ? (
                    <div className="answer-text">{p.answer}</div>
                  ) : (
                    <div className="answer-drawing-preview">
                      <img src={p.drawingData} alt={`${p.name}の絵`} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {!judged ? (
            <div className="judge-buttons">
              <button
                onClick={() => judgeAnswers(true)}
                className="success-button"
              >
                一致している！
              </button>
              <button
                onClick={() => judgeAnswers(false)}
                className="fail-button"
              >
                一致していない
              </button>
            </div>
          ) : (
            <div>
              <div className="judge-result">
                {lastJudgeResult ? (
                  <p className="success-message">✓ 正解！全員の答えが一致しました！</p>
                ) : (
                  <p className="fail-message">✗ 残念！答えが一致しませんでした。</p>
                )}
              </div>
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SinglePlayerGame
