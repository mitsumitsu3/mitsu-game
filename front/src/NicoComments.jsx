import { useState, useEffect, useRef } from 'react'
import './NicoComments.css'

function NicoComments({ comments }) {
  const [activeComments, setActiveComments] = useState([])

  useEffect(() => {
    console.log('NicoComments mounted! Displaying', comments.length, 'comments')

    if (!comments || comments.length === 0) {
      return
    }

    // コメントを順次表示（マウント時に一度だけ実行）
    let commentIndex = 0
    const interval = setInterval(() => {
      if (commentIndex < comments.length) {
        const newComment = {
          id: Date.now() + commentIndex,
          text: comments[commentIndex],
          top: Math.random() * 70 + 10, // 10% ~ 80%の位置にランダム配置
        }
        setActiveComments(prev => [...prev, newComment])
        commentIndex++
      } else {
        // すべてのコメントを表示したら停止（ループしない）
        console.log('All comments displayed')
        clearInterval(interval)
      }
    }, 1000) // 1秒ごとに1つずつ表示（30個なら30秒で全表示）

    return () => clearInterval(interval)
  }, []) // 空の依存配列 = マウント時に一度だけ実行

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
