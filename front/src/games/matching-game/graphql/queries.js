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
        roomCode
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

// Subscriptions
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
        roomCode
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

export const ON_PLAYER_JOINED = `
  subscription OnPlayerJoined($roomCode: String!) {
    onPlayerJoined(roomCode: $roomCode) {
      playerId
      roomId
      roomCode
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
