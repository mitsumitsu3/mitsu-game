import { useState, useEffect, useRef } from 'react'
import './NicoComments.css'

function NicoComments({ comments, judgedAt }) {
  const [activeComments, setActiveComments] = useState([])
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef(null)

  // judgedAtが変わったときに新しいコメント再生を開始
  useEffect(() => {
    if (!comments || comments.length === 0 || !judgedAt) {
      return
    }

    console.log('Starting new comment stream for judgedAt:', judgedAt, 'comments:', comments.length)

    // 既存の再生中のコメント表示は継続（activeCommentsはクリアしない）
    // 新しいコメント再生を開始
    setIsPlaying(true)
    let commentIndex = 0

    intervalRef.current = setInterval(() => {
      if (commentIndex < comments.length) {
        const newComment = {
          id: Date.now() + commentIndex,
          text: comments[commentIndex],
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
  }, [judgedAt]) // judgedAtが変わったときのみ実行

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
