import './GameSelect.css'

const games = [
  {
    id: 'matching-game',
    name: '一致させゲーム',
    description: 'お題に対して全員が同じ回答を目指すゲーム',
    icon: '🎯',
    available: true
  },
  {
    id: 'quiz-game',
    name: 'クイズゲーム',
    description: '準備中...',
    icon: '❓',
    available: false
  },
  {
    id: 'drawing-game',
    name: 'お絵かきゲーム',
    description: '準備中...',
    icon: '🎨',
    available: false
  }
]

function GameSelect({ onSelectGame }) {
  return (
    <div className="game-select">
      <h1 className="game-select-title">みつゲーム</h1>
      <p className="game-select-subtitle">遊びたいゲームを選んでください</p>

      <div className="game-list">
        {games.map(game => (
          <button
            key={game.id}
            className={`game-card ${!game.available ? 'disabled' : ''}`}
            onClick={() => game.available && onSelectGame(game.id)}
            disabled={!game.available}
          >
            <div className="game-icon">{game.icon}</div>
            <div className="game-info">
              <h3 className="game-name">{game.name}</h3>
              <p className="game-description">{game.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export default GameSelect
