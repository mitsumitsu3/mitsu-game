import { useState, useEffect, useRef } from 'react'
import './NicoComments.css'

function NicoComments({ comments, judgedAt }) {
  const [activeComments, setActiveComments] = useState([])
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef(null)
  const playedJudgedAtRef = useRef(null) // 再生済みのjudgedAtを記録

  // judgedAtが変わったときに新しいコメント再生を開始
  useEffect(() => {
    if (!comments || comments.length === 0 || !judgedAt) {
      return
    }

    // 既に再生済みのjudgedAtなら何もしない（judgedAtのみで判定）
    if (playedJudgedAtRef.current === judgedAt) {
      console.log('Skipping duplicate comment stream for judgedAt:', judgedAt)
      return
    }

    console.log('Starting new comment stream for judgedAt:', judgedAt, 'comments:', comments.length)
    playedJudgedAtRef.current = judgedAt

    // 既存のインターバルをクリア
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }

    // 既存のコメントをクリアして新しく開始
    setActiveComments([])
    setIsPlaying(true)
    let commentIndex = 0

    // commentsをローカル変数にキャプチャして使用
    const commentsToPlay = [...comments]

    intervalRef.current = setInterval(() => {
      if (commentIndex < commentsToPlay.length) {
        const newComment = {
          id: Date.now() + commentIndex,
          text: commentsToPlay[commentIndex],
          top: Math.random() * 70 + 10, // 10% ~ 80%の位置にランダム配置
        }
        setActiveComments(prev => [...prev, newComment])
        commentIndex++
      } else {
        // すべてのコメントを表示したら停止
        console.log('All comments displayed')
        clearInterval(intervalRef.current)
        setIsPlaying(false)
      }
    }, 1000) // 1秒ごとに1つずつ表示（30個なら30秒で全表示）

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [judgedAt]) // judgedAtのみで判定（commentsは依存配列から除外）

  // 古いコメントを削除（アニメーション終了後）
  useEffect(() => {
    const cleanup = setInterval(() => {
      setActiveComments(prev =>
        prev.filter(comment => Date.now() - comment.id < 8000) // 8秒後に削除
      )
    }, 1000)

    return () => clearInterval(cleanup)
  }, [])

  return (
    <div className="nico-comments-container">
      {activeComments.map(comment => (
        <div
          key={comment.id}
          className="nico-comment"
          style={{ top: `${comment.top}%` }}
        >
          {comment.text}
        </div>
      ))}
    </div>
  )
}

export default NicoComments
