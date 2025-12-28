export const CREATE_ROOM = `
  mutation CreateRoom($hostName: String!) {
    createRoom(hostName: $hostName) {
      roomId
      roomCode
      hostId
      state
      createdAt
    }
  }
`

export const JOIN_ROOM = `
  mutation JoinRoom($roomCode: String!, $playerName: String!) {
    joinRoom(roomCode: $roomCode, playerName: $playerName) {
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

export const SUBMIT_ANSWER = `
  mutation SubmitAnswer(
    $roomId: ID!
    $playerId: ID!
    $answerType: AnswerType!
    $textAnswer: String
    $drawingData: String
  ) {
    submitAnswer(
      roomId: $roomId
      playerId: $playerId
      answerType: $answerType
      textAnswer: $textAnswer
      drawingData: $drawingData
    ) {
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

export const START_JUDGING = `
  mutation StartJudging($roomId: ID!) {
    startJudging(roomId: $roomId) {
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

export const GENERATE_JUDGING_COMMENTS = `
  mutation GenerateJudgingComments($roomId: ID!) {
    generateJudgingComments(roomId: $roomId) {
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

export const JUDGE_ANSWERS = `
  mutation JudgeAnswers($roomId: ID!, $isMatch: Boolean!) {
    judgeAnswers(roomId: $roomId, isMatch: $isMatch) {
      roomId
      isMatch
      judgedAt
    }
  }
`

export const START_GAME = `
  mutation StartGame($roomId: ID!) {
    startGame(roomId: $roomId) {
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

export const NEXT_ROUND = `
  mutation NextRound($roomId: ID!) {
    nextRound(roomId: $roomId) {
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

export const SKIP_TOPIC = `
  mutation SkipTopic($roomId: ID!) {
    skipTopic(roomId: $roomId) {
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

export const END_GAME = `
  mutation EndGame($roomId: ID!) {
    endGame(roomId: $roomId) {
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

export const LEAVE_ROOM = `
  mutation LeaveRoom($roomId: ID!, $playerId: ID!) {
    leaveRoom(roomId: $roomId, playerId: $playerId)
  }
`

export const KICK_PLAYER = `
  mutation KickPlayer($roomId: ID!, $playerId: ID!, $kickedPlayerId: ID!) {
    kickPlayer(roomId: $roomId, playerId: $playerId, kickedPlayerId: $kickedPlayerId) {
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

export const DELETE_ALL_DATA = `
  mutation DeleteAllData {
    deleteAllData {
      success
      message
      deletedCounts {
        rooms
        players
        answers
      }
    }
  }
`
