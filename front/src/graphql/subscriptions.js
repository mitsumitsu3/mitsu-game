export const ON_ROOM_UPDATED = `
  subscription OnRoomUpdated($roomId: ID!) {
    onRoomUpdated(roomId: $roomId) {
      roomId
      roomCode
      hostId
      state
      topic
      topicsPool
      usedTopics
      lastJudgeResult
      judgedAt
      comments
      createdAt
      updatedAt
      players {
        playerId
        roomId
        name
        role
        connected
        joinedAt
      }
      answers {
        answerId
        roomId
        playerId
        playerName
        answerType
        textAnswer
        drawingData
        submittedAt
      }
    }
  }
`

export const ON_PLAYER_JOINED = `
  subscription OnPlayerJoined($roomCode: String!) {
    onPlayerJoined(roomCode: $roomCode) {
      playerId
      roomId
      name
      role
      connected
      joinedAt
    }
  }
`

export const ON_ANSWER_SUBMITTED = `
  subscription OnAnswerSubmitted($roomId: ID!) {
    onAnswerSubmitted(roomId: $roomId) {
      answerId
      roomId
      playerId
      playerName
      answerType
      textAnswer
      drawingData
      submittedAt
    }
  }
`

export const ON_JUDGE_RESULT = `
  subscription OnJudgeResult($roomId: ID!) {
    onJudgeResult(roomId: $roomId) {
      roomId
      isMatch
      judgedAt
    }
  }
`
