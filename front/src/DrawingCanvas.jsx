import { useRef, useEffect, useState } from 'react'
import './DrawingCanvas.css'

function DrawingCanvas({ onDrawingComplete, initialData = null }) {
  const canvasRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [color, setColor] = useState('#ffffff')
  const [lineWidth, setLineWidth] = useState(3)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')

    // 初期データがあれば描画
    if (initialData) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0)
      }
      img.src = initialData
    } else {
      // キャンバスを白で初期化
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
  }, [initialData])

  const startDrawing = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const ctx = canvas.getContext('2d')

    ctx.beginPath()
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
    setIsDrawing(true)
  }

  const draw = (e) => {
    if (!isDrawing) return

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const ctx = canvas.getContext('2d')

    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.stroke()
  }

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false)
      saveDrawing()
    }
  }

  const saveDrawing = () => {
    const canvas = canvasRef.current
    const dataURL = canvas.toDataURL('image/png')
    onDrawingComplete(dataURL)
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    onDrawingComplete(null)
  }

  return (
    <div className="drawing-canvas-container">
      <div className="drawing-tools">
        <div className="color-picker">
          <label>色:</label>
          <button
            className={`color-btn ${color === '#ffffff' ? 'active' : ''}`}
            style={{ backgroundColor: '#ffffff' }}
            onClick={() => setColor('#ffffff')}
          />
          <button
            className={`color-btn ${color === '#ff0000' ? 'active' : ''}`}
            style={{ backgroundColor: '#ff0000' }}
            onClick={() => setColor('#ff0000')}
          />
          <button
            className={`color-btn ${color === '#00ff00' ? 'active' : ''}`}
            style={{ backgroundColor: '#00ff00' }}
            onClick={() => setColor('#00ff00')}
          />
          <button
            className={`color-btn ${color === '#0000ff' ? 'active' : ''}`}
            style={{ backgroundColor: '#0000ff' }}
            onClick={() => setColor('#0000ff')}
          />
          <button
            className={`color-btn ${color === '#ffff00' ? 'active' : ''}`}
            style={{ backgroundColor: '#ffff00' }}
            onClick={() => setColor('#ffff00')}
          />
          <button
            className={`color-btn ${color === '#ff00ff' ? 'active' : ''}`}
            style={{ backgroundColor: '#ff00ff' }}
            onClick={() => setColor('#ff00ff')}
          />
        </div>
        <div className="line-width-picker">
          <label>太さ:</label>
          <button
            className={lineWidth === 2 ? 'active' : ''}
            onClick={() => setLineWidth(2)}
          >
            細
          </button>
          <button
            className={lineWidth === 5 ? 'active' : ''}
            onClick={() => setLineWidth(5)}
          >
            中
          </button>
          <button
            className={lineWidth === 10 ? 'active' : ''}
            onClick={() => setLineWidth(10)}
          >
            太
          </button>
        </div>
        <button className="clear-btn" onClick={clearCanvas}>
          クリア
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={500}
        height={400}
        className="drawing-canvas"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
      />
    </div>
  )
}

export default DrawingCanvas
