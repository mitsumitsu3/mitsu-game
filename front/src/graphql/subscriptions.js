export const ON_ROOM_UPDATE = `
  subscription OnRoomUpdate($roomId: ID!) {
    onRoomUpdate(roomId: $roomId) {
      roomId
      state
      topic
      updatedAt
    }
  }
`

export const ON_PLAYER_CHANGED = `
  subscription OnPlayerChanged($roomId: ID!) {
    onPlayerChanged(roomId: $roomId) {
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
      playerId
      playerName
      answerType
      textAnswer
      drawingData
      submittedAt
    }
  }
`

export const ON_JUDGED = `
  subscription OnJudged($roomId: ID!) {
    onJudged(roomId: $roomId) {
      roomId
      isMatch
      judgedAt
    }
  }
`
