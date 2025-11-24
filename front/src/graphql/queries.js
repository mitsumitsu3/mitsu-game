export const GET_ROOM = `
  query GetRoom($roomId: ID!) {
    getRoom(roomId: $roomId) {
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
        name
        role
        connected
      }
      answers {
        answerId
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

export const GET_ROOM_BY_CODE = `
  query GetRoomByCode($roomCode: String!) {
    getRoomByCode(roomCode: $roomCode) {
      roomId
      roomCode
      hostId
      state
    }
  }
`

export const LIST_PLAYERS = `
  query ListPlayers($roomId: ID!) {
    listPlayers(roomId: $roomId) {
      playerId
      name
      role
      connected
    }
  }
`

export const LIST_ANSWERS = `
  query ListAnswers($roomId: ID!) {
    listAnswers(roomId: $roomId) {
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
