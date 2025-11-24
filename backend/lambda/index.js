const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const ROOM_TABLE = process.env.ROOM_TABLE;
const PLAYER_TABLE = process.env.PLAYER_TABLE;
const ANSWER_TABLE = process.env.ANSWER_TABLE;

// ランダムなルームコードを生成（6文字）
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// メインハンドラー
exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  // AppSyncのイベント構造から取得
  const fieldName = event.info?.fieldName;
  const args = event.arguments || {};

  console.log('Field name:', fieldName);
  console.log('Arguments:', JSON.stringify(args));

  try {
    switch (fieldName) {
      // Mutations
      case 'createRoom':
        return await createRoom(args);
      case 'joinRoom':
        return await joinRoom(args);
      case 'leaveRoom':
        return await leaveRoom(args);
      case 'startGame':
        return await startGame(args);
      case 'submitAnswer':
        return await submitAnswer(args);
      case 'startJudging':
        return await startJudging(args);
      case 'generateJudgingComments':
        return await generateJudgingComments(args);
      case 'judgeAnswers':
        console.log('Calling judgeAnswers with:', args);
        const result = await judgeAnswers(args);
        console.log('judgeAnswers returned:', result);
        return result;
      case 'nextRound':
        return await nextRound(args);
      case 'endGame':
        return await endGame(args);

      // Queries
      case 'getRoom':
        return await getRoom(args);
      case 'getRoomByCode':
        return await getRoomByCode(args);
      case 'listPlayers':
        return await listPlayers(args);
      case 'listAnswers':
        return await listAnswers(args);

      default:
        throw new Error(`Unknown field: ${fieldName}`);
    }
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};

// ルーム作成
async function createRoom({ hostName }) {
  const roomId = uuidv4();
  const playerId = uuidv4();
  const roomCode = generateRoomCode();
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 86400; // 24時間後

  // ルームを作成
  const room = {
    roomId,
    roomCode,
    hostId: playerId,
    state: 'WAITING',
    topic: null,
    topicsPool: [],      // 未使用お題リスト
    usedTopics: [],      // 使用済みお題リスト
    comments: [],        // ニコニコ風コメント
    createdAt: now,
    updatedAt: now,
    ttl,
  };

  await ddb.send(new PutCommand({
    TableName: ROOM_TABLE,
    Item: room,
  }));

  // ホストをプレイヤーとして追加
  const player = {
    playerId,
    roomId,
    name: hostName,
    role: 'HOST',
    connected: true,
    joinedAt: now,
  };

  await ddb.send(new PutCommand({
    TableName: PLAYER_TABLE,
    Item: player,
  }));

  return { ...room, players: [player], answers: [] };
}

// ルーム参加
async function joinRoom({ roomCode, playerName }) {
  // ルームコードからルームを検索
  const room = await getRoomByCode({ roomCode });
  if (!room) {
    throw new Error('Room not found');
  }

  const playerId = uuidv4();
  const now = new Date().toISOString();

  const player = {
    playerId,
    roomId: room.roomId,
    name: playerName,
    role: 'PLAYER',
    connected: true,
    joinedAt: now,
  };

  await ddb.send(new PutCommand({
    TableName: PLAYER_TABLE,
    Item: player,
  }));

  return player;
}

// ルーム退出
async function leaveRoom({ roomId, playerId }) {
  await ddb.send(new DeleteCommand({
    TableName: PLAYER_TABLE,
    Key: { playerId },
  }));

  return true;
}

// お題を10個生成（OpenAI API）
async function generateTopics(usedTopics = []) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: '「認識合わせゲーム」のお題を10個生成してください。このゲームは参加者全員が同じ答えを思いつくことが目標です。\n\n' +
                   '【重要ルール】答えが1〜3個に収束する、具体的だが一般的なお題を作ること。\n\n' +
                   '【良いお題の例】（実際のゲームから）：\n' +
                   '- 「真夏のスポーツの定番といえば？」→ 野球、海水浴など\n' +
                   '- 「金持ちの家にある定番の物といえば？」→ プール、シアタールームなど\n' +
                   '- 「スーパーカーのメーカーといえば？」→ フェラーリ、ランボルギーニなど\n' +
                   '- 「卵を使った料理の定番といえば？」→ 卵焼き、目玉焼きなど\n' +
                   '- 「志村けんのギャグといえば？」→ アイーン、だっふんだなど\n' +
                   '- 「正月の遊びの定番といえば？」→ 凧揚げ、羽根つきなど\n' +
                   '- 「ホームセンターの定番といえば？」→ カインズ、コーナンなど\n' +
                   '- 「ピンクの服を着ている芸能人といえば？」→ ブルゾンちえみなど\n' +
                   '- 「コンビニで必ず売っている飲み物といえば？」→ お茶、コーヒーなど\n' +
                   '- 「日本一有名なお城といえば？」→ 姫路城、大阪城など\n' +
                   '- 「小学校の給食の定番メニューといえば？」→ カレー、揚げパンなど\n\n' +
                   '【お題の作り方】：\n' +
                   '1. カテゴリを1つ決める（場所、食べ物、人物、企業など）\n' +
                   '2. 「定番」「有名」「代表的」などで限定する\n' +
                   '3. 誰もが知ってる一般的な範囲に収める\n' +
                   '4. 固有名詞を指定する場合は明確に1人/1つに絞る（志村けん、ディズニーランドなど）\n\n' +
                   '【絶対NGな例】：\n' +
                   '❌ 「有名アーティストの代表曲といえば？」→ どのアーティスト？答えが発散\n' +
                   '❌ 「人気アニメのキャラクターといえば？」→ どのアニメ？答えが発散\n' +
                   '❌ 「有名大学の学部といえば？」→ どの大学？答えが発散\n' +
                   '❌ 「一押しのレストランのメニューといえば？」→ どのレストラン？答えが発散\n' +
                   '❌ 「春といえば？」「夏といえば？」→ 抽象的すぎる\n' +
                   '❌ 「日本の四季といえば？」→ 抽象的すぎる\n\n' +
                   '【OK例】：\n' +
                   '✅ 「ファミレスの定番メニューといえば？」→ ハンバーグ、パスタなど（カテゴリ全体）\n' +
                   '✅ 「ドラえもんの道具の定番といえば？」→ タケコプター、どこでもドアなど（固有名詞を明確に指定）\n' +
                   '✅ 「回転寿司の人気ネタといえば？」→ サーモン、マグロなど（カテゴリ全体）\n' +
                   '✅ 「冬のスポーツの定番といえば？」→ スキー、スノボなど（季節×カテゴリ）\n\n' +
                   (usedTopics.length > 0 ? `【使用済みのお題】（これらと重複しないこと）：\n${usedTopics.join('\n')}\n\n` : '') +
                   '各お題を改行で区切って出力してください。番号や記号は付けないでください。'
        },
        {
          role: 'user',
          content: '誰もが知ってる一般的な範囲で、答えが1〜3個に収束するお題を10個生成してください。「有名〇〇の△△」のような二段階限定は避けてください。'
        }
      ],
      temperature: 0.9,
      max_tokens: 600
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API Error: ${response.status}`);
  }

  const data = await response.json();
  const generatedText = data.choices[0].message.content.trim();

  // 改行で分割してお題リストを作成
  const topics = generatedText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(0, 10);  // 最大10個

  return topics;
}

// ゲーム開始（お題プールを生成）
async function startGame({ roomId }) {
  console.log('startGame called with:', { roomId });

  // ルーム情報を取得
  const room = await getRoom({ roomId });
  if (!room) {
    throw new Error('Room not found');
  }

  // お題を10個生成
  console.log('Generating topics...');
  const newTopics = await generateTopics(room.usedTopics || []);
  console.log('Generated topics:', newTopics);

  // 最初のお題を取り出す
  const firstTopic = newTopics[0];
  const remainingTopics = newTopics.slice(1);

  const now = new Date().toISOString();

  // ルームを更新
  await ddb.send(new UpdateCommand({
    TableName: ROOM_TABLE,
    Key: { roomId },
    UpdateExpression: 'SET #state = :state, #topic = :topic, #topicsPool = :topicsPool, #usedTopics = list_append(if_not_exists(#usedTopics, :emptyList), :usedTopic), #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#state': 'state',
      '#topic': 'topic',
      '#topicsPool': 'topicsPool',
      '#usedTopics': 'usedTopics',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':state': 'ANSWERING',
      ':topic': firstTopic,
      ':topicsPool': remainingTopics,
      ':usedTopic': [firstTopic],
      ':emptyList': [],
      ':updatedAt': now,
    },
  }));

  return await getRoom({ roomId });
}

// 回答提出
async function submitAnswer({ roomId, playerId, answerType, textAnswer, drawingData }) {
  const answerId = uuidv4();
  const now = new Date().toISOString();

  // プレイヤー情報を取得
  const playerResult = await ddb.send(new GetCommand({
    TableName: PLAYER_TABLE,
    Key: { playerId },
  }));

  const answer = {
    answerId,
    roomId,
    playerId,
    playerName: playerResult.Item?.name || 'Unknown',
    answerType,
    textAnswer: textAnswer || null,
    drawingData: drawingData || null,
    submittedAt: now,
  };

  await ddb.send(new PutCommand({
    TableName: ANSWER_TABLE,
    Item: answer,
  }));

  return answer;
}

// 判定画面に遷移（コメント生成を非同期で開始）
async function startJudging({ roomId }) {
  const now = new Date().toISOString();

  // 判定画面に即座に遷移
  await ddb.send(new UpdateCommand({
    TableName: ROOM_TABLE,
    Key: { roomId },
    UpdateExpression: 'SET #state = :state, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#state': 'state',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':state': 'JUDGING',
      ':updatedAt': now,
    },
  }));

  // コメント生成を非同期で開始（待たない）
  generateJudgingComments({ roomId }).catch(err => {
    console.error('Failed to generate comments:', err);
  });

  return await getRoom({ roomId });
}

// コメント生成（非同期で呼び出される）
async function generateJudgingComments({ roomId }) {
  const now = new Date().toISOString();

  // ルーム情報と回答を取得
  const room = await getRoom({ roomId });
  if (!room) {
    throw new Error('Room not found');
  }

  // コメントを生成
  console.log('Generating comments asynchronously...');
  const comments = await generateComments(room.topic, room.answers);
  console.log('Generated comments:', comments.length);

  // コメントを保存
  await ddb.send(new UpdateCommand({
    TableName: ROOM_TABLE,
    Key: { roomId },
    UpdateExpression: 'SET #comments = :comments, #judgedAt = :judgedAt, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#comments': 'comments',
      '#judgedAt': 'judgedAt',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':comments': comments,
      ':judgedAt': now,
      ':updatedAt': now,
    },
  }));

  return {
    roomId,
    comments,
    judgedAt: now,
  };
}

// GPT-4 Visionでニコニコ風コメント生成
async function generateComments(topic, answers) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  // プレイヤー名のリストを作成
  const playerNames = answers.map(a => a.playerName).join('、');

  // メッセージコンテンツを構築
  const content = [
    {
      type: 'text',
      text: `お題: ${topic}\n\n以下はゲーム参加者の回答です。ニコニコ動画風のツッコミコメントを30個生成してください。\n\n` +
            `【重要】必ず全員（${playerNames}）に対するコメントを含めること。\n\n` +
            `コメントの特徴:\n` +
            `- 短く簡潔（5〜15文字程度）\n` +
            `- 各プレイヤーに対して様々な角度からコメント（共感、ツッコミ、驚き、大喜利、ボケなど）\n` +
            `- 「www」「草」「それな」「やばい」などネットスラング多用\n` +
            `- 「www」は多用しすぎない程度に使用する\n` +
            `- 似たようなコメントは避け、バリエーションを持たせる\n` +
            `- 絵の回答には絵の具体的な内容や特徴に言及する\n` +
            `- 全員の回答を比較するコメントも含める\n\n` +
            `回答:\n`
    }
  ];

  // 各回答を追加（テキストと画像）
  for (const answer of answers) {
    content.push({
      type: 'text',
      text: `\n${answer.playerName}の回答: `
    });

    if (answer.answerType === 'TEXT') {
      content.push({
        type: 'text',
        text: answer.textAnswer
      });
    } else {
      // 画像の場合はBase64データを送信
      content.push({
        type: 'image_url',
        image_url: {
          url: answer.drawingData
        }
      });
    }
  }

  content.push({
    type: 'text',
    text: '\n\n各コメントを改行で区切って出力してください。番号や記号は付けないでください。30個のコメントすべてで、全員のプレイヤーに対するツッコミをバランスよく含めてください。'
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',  // GPT-4 Vision対応モデル
      messages: [
        {
          role: 'user',
          content: content
        }
      ],
      temperature: 0.9,
      max_tokens: 1000  // 30個のコメントに調整
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API Error: ${response.status}`);
  }

  const data = await response.json();
  const generatedText = data.choices[0].message.content.trim();

  // 改行で分割してコメントリストを作成
  const comments = generatedText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(0, 30);  // 最大30個

  return comments;
}

// 判定（コメントは既に生成済み）
async function judgeAnswers({ roomId, isMatch }) {
  console.log('judgeAnswers function called with:', { roomId, isMatch });
  const now = new Date().toISOString();

  // 判定結果だけをRoomに保存（コメントは既にstartJudgingで生成済み）
  console.log('Updating judgment result:', {
    roomId,
    lastJudgeResult: isMatch
  });

  await ddb.send(new UpdateCommand({
    TableName: ROOM_TABLE,
    Key: { roomId },
    UpdateExpression: 'SET #lastJudgeResult = :lastJudgeResult, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#lastJudgeResult': 'lastJudgeResult',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':lastJudgeResult': isMatch,
      ':updatedAt': now,
    },
  }));

  console.log('DynamoDB update completed successfully');

  const result = {
    roomId,
    isMatch,
    judgedAt: now,
  };
  console.log('Returning result:', result);
  return result;
}

// 次のラウンド
async function nextRound({ roomId }) {
  console.log('nextRound called with:', { roomId });

  // ルーム情報を取得
  const room = await getRoom({ roomId });
  if (!room) {
    throw new Error('Room not found');
  }

  // 回答をクリア
  const answers = await listAnswers({ roomId });
  for (const answer of answers) {
    await ddb.send(new DeleteCommand({
      TableName: ANSWER_TABLE,
      Key: { answerId: answer.answerId },
    }));
  }

  let topicsPool = room.topicsPool || [];
  let usedTopics = room.usedTopics || [];

  // お題プールが3個以下なら追加で10個生成
  if (topicsPool.length <= 3) {
    console.log('Topics pool is running low, generating more topics...');
    const newTopics = await generateTopics(usedTopics);
    console.log('Generated new topics:', newTopics);
    topicsPool = [...topicsPool, ...newTopics];
  }

  // 次のお題を取り出す
  const nextTopic = topicsPool[0];
  const remainingTopics = topicsPool.slice(1);

  // 使用済みリストに追加
  usedTopics = [...usedTopics, nextTopic];

  const now = new Date().toISOString();

  // ルーム状態を更新（判定結果はクリア、コメントはそのまま残す）
  await ddb.send(new UpdateCommand({
    TableName: ROOM_TABLE,
    Key: { roomId },
    UpdateExpression: 'SET #state = :state, #topic = :topic, #topicsPool = :topicsPool, #usedTopics = :usedTopics, #updatedAt = :updatedAt REMOVE #lastJudgeResult, #judgedAt',
    ExpressionAttributeNames: {
      '#state': 'state',
      '#topic': 'topic',
      '#topicsPool': 'topicsPool',
      '#usedTopics': 'usedTopics',
      '#updatedAt': 'updatedAt',
      '#lastJudgeResult': 'lastJudgeResult',
      '#judgedAt': 'judgedAt',
    },
    ExpressionAttributeValues: {
      ':state': 'ANSWERING',
      ':topic': nextTopic,
      ':topicsPool': remainingTopics,
      ':usedTopics': usedTopics,
      ':updatedAt': now,
    },
  }));

  return await getRoom({ roomId });
}

// ゲーム終了
async function endGame({ roomId }) {
  const now = new Date().toISOString();

  await ddb.send(new UpdateCommand({
    TableName: ROOM_TABLE,
    Key: { roomId },
    UpdateExpression: 'SET #state = :state, #topic = :topic, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#state': 'state',
      '#topic': 'topic',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':state': 'WAITING',
      ':topic': null,
      ':updatedAt': now,
    },
  }));

  return await getRoom({ roomId });
}

// ルーム取得
async function getRoom({ roomId }) {
  const result = await ddb.send(new GetCommand({
    TableName: ROOM_TABLE,
    Key: { roomId },
  }));

  if (!result.Item) {
    return null;
  }

  const players = await listPlayers({ roomId });
  const answers = await listAnswers({ roomId });

  return {
    ...result.Item,
    players,
    answers,
  };
}

// ルームコードからルームを取得
async function getRoomByCode({ roomCode }) {
  const result = await ddb.send(new QueryCommand({
    TableName: ROOM_TABLE,
    IndexName: 'roomCode-index',
    KeyConditionExpression: 'roomCode = :roomCode',
    ExpressionAttributeValues: {
      ':roomCode': roomCode,
    },
  }));

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const room = result.Items[0];
  const players = await listPlayers({ roomId: room.roomId });
  const answers = await listAnswers({ roomId: room.roomId });

  return {
    ...room,
    players,
    answers,
  };
}

// プレイヤー一覧
async function listPlayers({ roomId }) {
  const result = await ddb.send(new QueryCommand({
    TableName: PLAYER_TABLE,
    IndexName: 'roomId-index',
    KeyConditionExpression: 'roomId = :roomId',
    ExpressionAttributeValues: {
      ':roomId': roomId,
    },
  }));

  return result.Items || [];
}

// 回答一覧
async function listAnswers({ roomId }) {
  const result = await ddb.send(new QueryCommand({
    TableName: ANSWER_TABLE,
    IndexName: 'roomId-index',
    KeyConditionExpression: 'roomId = :roomId',
    ExpressionAttributeValues: {
      ':roomId': roomId,
    },
  }));

  return result.Items || [];
}
