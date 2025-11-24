import './ModeSelection.css'

function ModeSelection({ onSelectMode }) {
  return (
    <div className="mode-selection">
      <h2>ゲームモードを選択</h2>
      <div className="mode-buttons">
        <button
          className="mode-button single-mode"
          onClick={() => onSelectMode('single')}
        >
          <div className="mode-icon">🎮</div>
          <h3>シングルプレイ</h3>
          <p>1人でテストプレイ<br/>全員の回答を入力できます</p>
        </button>

        <button
          className="mode-button multi-mode"
          onClick={() => onSelectMode('multi')}
        >
          <div className="mode-icon">👥</div>
          <h3>マルチプレイヤー</h3>
          <p>友達と一緒にプレイ<br/>リアルタイム同期</p>
        </button>
      </div>
    </div>
  )
}

export default ModeSelection
