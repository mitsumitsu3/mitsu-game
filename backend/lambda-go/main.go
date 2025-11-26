// 認識合わせゲーム - バックエンドLambda関数 (Go版)
// AWS AppSyncからのGraphQLリクエストを処理するLambda関数
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

// ===========================================
// グローバル変数
// ===========================================

var (
	ddbClient   *dynamodb.Client // DynamoDBクライアント
	roomTable   string           // ルームテーブル名
	playerTable string           // プレイヤーテーブル名
	answerTable string           // 回答テーブル名
)

// ===========================================
// AppSync イベント構造体
// ===========================================

// AppSyncEvent - AppSyncから送られてくるイベントの構造
type AppSyncEvent struct {
	Info      AppSyncInfo            `json:"info"`      // GraphQL操作情報
	Arguments map[string]interface{} `json:"arguments"` // 引数
}

// AppSyncInfo - GraphQL操作の詳細情報
type AppSyncInfo struct {
	FieldName string `json:"fieldName"` // 呼び出されたフィールド名（createRoom, joinRoom等）
}

// ===========================================
// ドメインモデル（データ構造）
// ===========================================

// Room - ゲームルーム情報
type Room struct {
	RoomID          string   `json:"roomId" dynamodbav:"roomId"`                               // ルームID（UUID）
	RoomCode        string   `json:"roomCode" dynamodbav:"roomCode"`                           // ルームコード（6桁数字）
	HostID          string   `json:"hostId" dynamodbav:"hostId"`                               // ホストのプレイヤーID
	State           string   `json:"state" dynamodbav:"state"`                                 // ゲーム状態（WAITING/ANSWERING/JUDGING）
	Topic           *string  `json:"topic" dynamodbav:"topic,omitempty"`                       // 現在のお題
	TopicsPool      []string `json:"topicsPool" dynamodbav:"topicsPool"`                       // 未使用のお題プール
	UsedTopics      []string `json:"usedTopics" dynamodbav:"usedTopics"`                       // 使用済みお題リスト
	LastJudgeResult *bool    `json:"lastJudgeResult,omitempty" dynamodbav:"lastJudgeResult,omitempty"` // 前回の判定結果
	JudgedAt        *string  `json:"judgedAt,omitempty" dynamodbav:"judgedAt,omitempty"`       // 判定日時
	Comments        []string `json:"comments,omitempty" dynamodbav:"comments,omitempty"`       // ニコニコ風コメント
	CreatedAt       string   `json:"createdAt" dynamodbav:"createdAt"`                         // 作成日時
	UpdatedAt       string   `json:"updatedAt" dynamodbav:"updatedAt"`                         // 更新日時
	TTL             int64    `json:"ttl" dynamodbav:"ttl"`                                     // TTL（24時間後に自動削除）
	Players         []Player `json:"players"`                                                  // プレイヤー一覧（結合データ）
	Answers         []Answer `json:"answers"`                                                  // 回答一覧（結合データ）
}

// Player - プレイヤー情報
type Player struct {
	PlayerID  string `json:"playerId" dynamodbav:"playerId"`   // プレイヤーID（UUID）
	RoomID    string `json:"roomId" dynamodbav:"roomId"`       // 所属ルームID
	Name      string `json:"name" dynamodbav:"name"`           // プレイヤー名
	Role      string `json:"role" dynamodbav:"role"`           // 役割（HOST/PLAYER）
	Connected bool   `json:"connected" dynamodbav:"connected"` // 接続状態
	JoinedAt  string `json:"joinedAt" dynamodbav:"joinedAt"`   // 参加日時
}

// Answer - 回答情報
type Answer struct {
	AnswerID    string  `json:"answerId" dynamodbav:"answerId"`                       // 回答ID（UUID）
	RoomID      string  `json:"roomId" dynamodbav:"roomId"`                           // ルームID
	PlayerID    string  `json:"playerId" dynamodbav:"playerId"`                       // プレイヤーID
	PlayerName  string  `json:"playerName" dynamodbav:"playerName"`                   // プレイヤー名
	AnswerType  string  `json:"answerType" dynamodbav:"answerType"`                   // 回答タイプ（TEXT）
	TextAnswer  *string `json:"textAnswer,omitempty" dynamodbav:"textAnswer,omitempty"` // テキスト回答
	DrawingData *string `json:"drawingData,omitempty" dynamodbav:"drawingData,omitempty"` // 絵（未使用）
	SubmittedAt string  `json:"submittedAt" dynamodbav:"submittedAt"`                 // 提出日時
}

// JudgeResult - 判定結果
type JudgeResult struct {
	RoomID   string   `json:"roomId"`             // ルームID
	IsMatch  bool     `json:"isMatch"`            // 一致判定結果
	JudgedAt string   `json:"judgedAt"`           // 判定日時
	Comments []string `json:"comments,omitempty"` // コメント
}

// DeleteAllDataResponse - 全データ削除レスポンス（開発用）
type DeleteAllDataResponse struct {
	Success       bool          `json:"success"`
	Message       string        `json:"message"`
	DeletedCounts DeletedCounts `json:"deletedCounts"`
}

// DeletedCounts - 削除件数
type DeletedCounts struct {
	Rooms   int `json:"rooms"`
	Players int `json:"players"`
	Answers int `json:"answers"`
}

// ===========================================
// OpenAI API 関連の構造体
// ===========================================

// OpenAIRequest - OpenAI APIリクエスト
type OpenAIRequest struct {
	Model       string          `json:"model"`       // 使用モデル（gpt-4o-mini）
	Messages    []OpenAIMessage `json:"messages"`    // メッセージ配列
	Temperature float64         `json:"temperature"` // ランダム性（0.0-1.0）
	MaxTokens   int             `json:"max_tokens"`  // 最大トークン数
}

// OpenAIMessage - OpenAI メッセージ
type OpenAIMessage struct {
	Role    string `json:"role"`    // ロール（system/user/assistant）
	Content string `json:"content"` // メッセージ内容
}

// OpenAIResponse - OpenAI APIレスポンス
type OpenAIResponse struct {
	Choices []OpenAIChoice `json:"choices"`
}

// OpenAIChoice - OpenAI 選択肢
type OpenAIChoice struct {
	Message OpenAIMessage `json:"message"`
}

// ===========================================
// 初期化処理
// ===========================================

// init - Lambda起動時の初期化処理
// 環境変数の読み込みとDynamoDBクライアントの初期化を行う
func init() {
	// 環境変数からテーブル名を取得
	roomTable = os.Getenv("ROOM_TABLE")
	playerTable = os.Getenv("PLAYER_TABLE")
	answerTable = os.Getenv("ANSWER_TABLE")

	// AWS SDK設定を読み込み
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("SDK設定の読み込みに失敗: %v", err)
	}

	// DynamoDBクライアントを初期化
	ddbClient = dynamodb.NewFromConfig(cfg)

	// 乱数シードを初期化（ルームコード生成用）
	rand.Seed(time.Now().UnixNano())
}

// ===========================================
// メイン処理・ルーティング
// ===========================================

// main - Lambda関数のエントリーポイント
func main() {
	lambda.Start(handler)
}

// handler - AppSyncからのリクエストを処理するメインハンドラー
// GraphQLのフィールド名に応じて適切な関数にルーティングする
func handler(ctx context.Context, event AppSyncEvent) (interface{}, error) {
	log.Printf("イベント受信: %+v", event)
	log.Printf("フィールド名: %s", event.Info.FieldName)
	log.Printf("引数: %+v", event.Arguments)

	// フィールド名に応じて処理を振り分け
	switch event.Info.FieldName {
	// ========== Mutation（データ変更操作） ==========
	case "createRoom":
		return createRoom(ctx, event.Arguments)
	case "joinRoom":
		return joinRoom(ctx, event.Arguments)
	case "leaveRoom":
		return leaveRoom(ctx, event.Arguments)
	case "startGame":
		return startGame(ctx, event.Arguments)
	case "submitAnswer":
		return submitAnswer(ctx, event.Arguments)
	case "startJudging":
		return startJudging(ctx, event.Arguments)
	case "generateJudgingComments":
		return generateJudgingComments(ctx, event.Arguments)
	case "judgeAnswers":
		return judgeAnswers(ctx, event.Arguments)
	case "nextRound":
		return nextRound(ctx, event.Arguments)
	case "endGame":
		return endGame(ctx, event.Arguments)
	case "deleteAllData":
		return deleteAllData(ctx)

	// ========== Query（データ取得操作） ==========
	case "getRoom":
		return getRoom(ctx, event.Arguments)
	case "getRoomByCode":
		return getRoomByCode(ctx, event.Arguments)
	case "listPlayers":
		return listPlayers(ctx, event.Arguments)
	case "listAnswers":
		return listAnswers(ctx, event.Arguments)

	default:
		return nil, fmt.Errorf("不明なフィールド: %s", event.Info.FieldName)
	}
}

// ===========================================
// ユーティリティ関数
// ===========================================

// generateRoomCode - 6桁のランダムなルームコードを生成
func generateRoomCode() string {
	return fmt.Sprintf("%06d", rand.Intn(900000)+100000)
}

// marshalStringList - 文字列配列をDynamoDB用の属性値に変換
func marshalStringList(list []string) types.AttributeValue {
	if len(list) == 0 {
		return &types.AttributeValueMemberL{Value: []types.AttributeValue{}}
	}
	var values []types.AttributeValue
	for _, s := range list {
		values = append(values, &types.AttributeValueMemberS{Value: s})
	}
	return &types.AttributeValueMemberL{Value: values}
}

// ===========================================
// ルーム管理機能
// ===========================================

// createRoom - 新しいゲームルームを作成
// ホストとなるプレイヤーも同時に作成する
func createRoom(ctx context.Context, args map[string]interface{}) (*Room, error) {
	hostName := args["hostName"].(string)

	// ID生成
	roomID := uuid.New().String()
	playerID := uuid.New().String()
	roomCode := generateRoomCode()
	now := time.Now().UTC().Format(time.RFC3339)
	ttl := time.Now().Unix() + 86400 // 24時間後に自動削除

	// ルームデータを作成
	room := Room{
		RoomID:     roomID,
		RoomCode:   roomCode,
		HostID:     playerID,
		State:      "WAITING", // 待機状態で開始
		TopicsPool: []string{},
		UsedTopics: []string{},
		Comments:   []string{},
		CreatedAt:  now,
		UpdatedAt:  now,
		TTL:        ttl,
	}

	// DynamoDBにルームを保存
	roomItem, err := attributevalue.MarshalMap(room)
	if err != nil {
		return nil, fmt.Errorf("ルームのマーシャルに失敗: %w", err)
	}

	_, err = ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(roomTable),
		Item:      roomItem,
	})
	if err != nil {
		return nil, fmt.Errorf("ルームの作成に失敗: %w", err)
	}

	// ホストプレイヤーを作成
	player := Player{
		PlayerID:  playerID,
		RoomID:    roomID,
		Name:      hostName,
		Role:      "HOST",
		Connected: true,
		JoinedAt:  now,
	}

	playerItem, err := attributevalue.MarshalMap(player)
	if err != nil {
		return nil, fmt.Errorf("プレイヤーのマーシャルに失敗: %w", err)
	}

	_, err = ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(playerTable),
		Item:      playerItem,
	})
	if err != nil {
		return nil, fmt.Errorf("プレイヤーの作成に失敗: %w", err)
	}

	// レスポンス用にプレイヤー情報を追加
	room.Players = []Player{player}
	room.Answers = []Answer{}

	return &room, nil
}

// joinRoom - 既存のルームに参加
func joinRoom(ctx context.Context, args map[string]interface{}) (*Player, error) {
	roomCode := args["roomCode"].(string)
	playerName := args["playerName"].(string)

	// ルームコードからルームを検索
	room, err := getRoomByCode(ctx, map[string]interface{}{"roomCode": roomCode})
	if err != nil {
		return nil, err
	}
	if room == nil {
		return nil, fmt.Errorf("ルームが見つかりません")
	}

	// プレイヤーを作成
	playerID := uuid.New().String()
	now := time.Now().UTC().Format(time.RFC3339)

	player := Player{
		PlayerID:  playerID,
		RoomID:    room.RoomID,
		Name:      playerName,
		Role:      "PLAYER", // 一般プレイヤー
		Connected: true,
		JoinedAt:  now,
	}

	playerItem, err := attributevalue.MarshalMap(player)
	if err != nil {
		return nil, fmt.Errorf("プレイヤーのマーシャルに失敗: %w", err)
	}

	_, err = ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(playerTable),
		Item:      playerItem,
	})
	if err != nil {
		return nil, fmt.Errorf("プレイヤーの作成に失敗: %w", err)
	}

	return &player, nil
}

// leaveRoom - ルームから退出
func leaveRoom(ctx context.Context, args map[string]interface{}) (bool, error) {
	playerID := args["playerId"].(string)

	// プレイヤーを削除
	_, err := ddbClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(playerTable),
		Key: map[string]types.AttributeValue{
			"playerId": &types.AttributeValueMemberS{Value: playerID},
		},
	})
	if err != nil {
		return false, fmt.Errorf("プレイヤーの削除に失敗: %w", err)
	}

	return true, nil
}

// ===========================================
// OpenAI API連携
// ===========================================

// generateTopics - OpenAI APIを使ってお題を10個生成
func generateTopics(usedTopics []string) ([]string, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("OPENAI_API_KEYが設定されていません")
	}

	// 使用済みお題がある場合は、重複を避けるようプロンプトに含める
	usedTopicsText := ""
	if len(usedTopics) > 0 {
		usedTopicsText = fmt.Sprintf("【使用済みのお題】（これらと重複しないこと）：\n%s\n\n", strings.Join(usedTopics, "\n"))
	}

	// お題生成用のシステムプロンプト
	systemPrompt := `「認識合わせゲーム」のお題を10個生成してください。このゲームは参加者全員が同じ答えを思いつくことが目標です。

【重要ルール】答えが1〜3個に収束する、具体的だが一般的なお題を作ること。

【良いお題の例】（実際のゲームから）：
- 「真夏のスポーツの定番といえば？」→ 野球、海水浴など
- 「金持ちの家にある定番の物といえば？」→ プール、シアタールームなど
- 「スーパーカーのメーカーといえば？」→ フェラーリ、ランボルギーニなど
- 「卵を使った料理の定番といえば？」→ 卵焼き、目玉焼きなど
- 「志村けんのギャグといえば？」→ アイーン、だっふんだなど
- 「正月の遊びの定番といえば？」→ 凧揚げ、羽根つきなど
- 「ホームセンターの定番といえば？」→ カインズ、コーナンなど
- 「ピンクの服を着ている芸能人といえば？」→ ブルゾンちえみなど
- 「コンビニで必ず売っている飲み物といえば？」→ お茶、コーヒーなど
- 「日本一有名なお城といえば？」→ 姫路城、大阪城など
- 「小学校の給食の定番メニューといえば？」→ カレー、揚げパンなど

【お題の作り方】：
1. カテゴリを1つ決める（場所、食べ物、人物、企業など）
2. 「定番」「有名」「代表的」などで限定する
3. 誰もが知ってる一般的な範囲に収める
4. 固有名詞を指定する場合は明確に1人/1つに絞る（志村けん、ディズニーランドなど）

【絶対NGな例】：
❌ 「有名アーティストの代表曲といえば？」→ どのアーティスト？答えが発散
❌ 「人気アニメのキャラクターといえば？」→ どのアニメ？答えが発散
❌ 「有名大学の学部といえば？」→ どの大学？答えが発散
❌ 「一押しのレストランのメニューといえば？」→ どのレストラン？答えが発散
❌ 「春といえば？」「夏といえば？」→ 抽象的すぎる
❌ 「日本の四季といえば？」→ 抽象的すぎる

【OK例】：
✅ 「ファミレスの定番メニューといえば？」→ ハンバーグ、パスタなど（カテゴリ全体）
✅ 「ドラえもんの道具の定番といえば？」→ タケコプター、どこでもドアなど（固有名詞を明確に指定）
✅ 「回転寿司の人気ネタといえば？」→ サーモン、マグロなど（カテゴリ全体）
✅ 「冬のスポーツの定番といえば？」→ スキー、スノボなど（季節×カテゴリ）

` + usedTopicsText + `各お題を改行で区切って出力してください。番号や記号は付けないでください。`

	// OpenAI APIリクエストを構築
	reqBody := OpenAIRequest{
		Model: "gpt-4o-mini",
		Messages: []OpenAIMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: "誰もが知ってる一般的な範囲で、答えが1〜3個に収束するお題を10個生成してください。「有名〇〇の△△」のような二段階限定は避けてください。"},
		},
		Temperature: 0.9, // 高めの値でバリエーションを出す
		MaxTokens:   600,
	}

	// APIを呼び出してお題を取得
	topics, err := callOpenAI(reqBody)
	if err != nil {
		return nil, err
	}

	// 最大10個に制限
	if len(topics) > 10 {
		topics = topics[:10]
	}

	return topics, nil
}

// generateComments - ニコニコ動画風のコメントを生成
func generateComments(topic string, answers []Answer) ([]string, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("OPENAI_API_KEYが設定されていません")
	}

	// プレイヤー名と回答を整形
	var playerNames []string
	var answersTextParts []string
	for _, a := range answers {
		playerNames = append(playerNames, a.PlayerName)
		answerText := "(回答なし)"
		if a.TextAnswer != nil && *a.TextAnswer != "" {
			answerText = *a.TextAnswer
		}
		answersTextParts = append(answersTextParts, fmt.Sprintf("%s: %s", a.PlayerName, answerText))
	}

	// コメント生成用プロンプト
	prompt := fmt.Sprintf(`お題: %s

以下はゲーム参加者の回答です。ニコニコ動画風のツッコミコメントを30個生成してください。

【重要】必ず全員（%s）に対するコメントを含めること。

コメントの特徴:
- 短く簡潔（5〜15文字程度）
- 各プレイヤーに対して様々な角度からコメント（共感、ツッコミ、驚き、大喜利、ボケなど）
- 「草」「それな」「やばい」などネットスラング多用
- 「www」等の笑いの表現は多用しすぎない程度に使用する
- 似たようなコメントは避け、バリエーションを持たせる
- お題に対して全員が一致していた場合はお祝いの言葉を多めにする
- 全員の回答を比較するコメントも含める

回答:
%s

各コメントを改行で区切って出力してください。番号や記号は付けないでください。`,
		topic,
		strings.Join(playerNames, "、"),
		strings.Join(answersTextParts, "\n"))

	// OpenAI APIリクエストを構築
	reqBody := OpenAIRequest{
		Model: "gpt-4o-mini",
		Messages: []OpenAIMessage{
			{Role: "user", Content: prompt},
		},
		Temperature: 0.9,
		MaxTokens:   1000,
	}

	// APIを呼び出してコメントを取得
	comments, err := callOpenAI(reqBody)
	if err != nil {
		return nil, err
	}

	// 最大30個に制限
	if len(comments) > 30 {
		comments = comments[:30]
	}

	return comments, nil
}

// callOpenAI - OpenAI APIを呼び出す共通関数
func callOpenAI(reqBody OpenAIRequest) ([]string, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("リクエストのマーシャルに失敗: %w", err)
	}

	// HTTPリクエストを作成
	req, err := http.NewRequest("POST", "https://api.openai.com/v1/chat/completions", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("リクエストの作成に失敗: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	// APIを呼び出し
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("OpenAI APIの呼び出しに失敗: %w", err)
	}
	defer resp.Body.Close()

	// エラーレスポンスをチェック
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("OpenAI APIエラー: %d - %s", resp.StatusCode, string(body))
	}

	// レスポンスをパース
	var openaiResp OpenAIResponse
	if err := json.NewDecoder(resp.Body).Decode(&openaiResp); err != nil {
		return nil, fmt.Errorf("レスポンスのデコードに失敗: %w", err)
	}

	if len(openaiResp.Choices) == 0 {
		return nil, fmt.Errorf("レスポンスに選択肢がありません")
	}

	// 改行で分割してリストに変換
	generatedText := strings.TrimSpace(openaiResp.Choices[0].Message.Content)
	lines := strings.Split(generatedText, "\n")

	var results []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			results = append(results, line)
		}
	}

	return results, nil
}

// ===========================================
// ゲーム進行管理
// ===========================================

// startGame - ゲームを開始
// お題プールを生成し、最初のお題を設定する
func startGame(ctx context.Context, args map[string]interface{}) (*Room, error) {
	roomID := args["roomId"].(string)
	log.Printf("ゲーム開始: roomId=%s", roomID)

	// ルーム情報を取得
	room, err := getRoom(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		return nil, err
	}
	if room == nil {
		return nil, fmt.Errorf("ルームが見つかりません")
	}

	// お題を10個生成
	log.Println("お題を生成中...")
	newTopics, err := generateTopics(room.UsedTopics)
	if err != nil {
		return nil, fmt.Errorf("お題の生成に失敗: %w", err)
	}
	log.Printf("生成されたお題: %v", newTopics)

	// 最初のお題を取り出し、残りをプールに保存
	firstTopic := newTopics[0]
	remainingTopics := newTopics[1:]
	now := time.Now().UTC().Format(time.RFC3339)

	usedTopics := append(room.UsedTopics, firstTopic)

	// ルームを更新（状態をANSWERINGに変更）
	_, err = ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(roomTable),
		Key: map[string]types.AttributeValue{
			"roomId": &types.AttributeValueMemberS{Value: roomID},
		},
		UpdateExpression: aws.String("SET #state = :state, #topic = :topic, #topicsPool = :topicsPool, #usedTopics = :usedTopics, #updatedAt = :updatedAt"),
		ExpressionAttributeNames: map[string]string{
			"#state":      "state",
			"#topic":      "topic",
			"#topicsPool": "topicsPool",
			"#usedTopics": "usedTopics",
			"#updatedAt":  "updatedAt",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":state":      &types.AttributeValueMemberS{Value: "ANSWERING"},
			":topic":      &types.AttributeValueMemberS{Value: firstTopic},
			":topicsPool": marshalStringList(remainingTopics),
			":usedTopics": marshalStringList(usedTopics),
			":updatedAt":  &types.AttributeValueMemberS{Value: now},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("ルームの更新に失敗: %w", err)
	}

	return getRoom(ctx, map[string]interface{}{"roomId": roomID})
}

// submitAnswer - 回答を提出
func submitAnswer(ctx context.Context, args map[string]interface{}) (*Answer, error) {
	roomID := args["roomId"].(string)
	playerID := args["playerId"].(string)
	answerType := args["answerType"].(string)

	// オプショナルな引数を取得
	var textAnswer, drawingData *string
	if ta, ok := args["textAnswer"].(string); ok && ta != "" {
		textAnswer = &ta
	}
	if dd, ok := args["drawingData"].(string); ok && dd != "" {
		drawingData = &dd
	}

	answerID := uuid.New().String()
	now := time.Now().UTC().Format(time.RFC3339)

	// プレイヤー名を取得
	playerResult, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(playerTable),
		Key: map[string]types.AttributeValue{
			"playerId": &types.AttributeValueMemberS{Value: playerID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("プレイヤーの取得に失敗: %w", err)
	}

	playerName := "Unknown"
	if playerResult.Item != nil {
		var player Player
		if err := attributevalue.UnmarshalMap(playerResult.Item, &player); err == nil {
			playerName = player.Name
		}
	}

	// 回答データを作成
	answer := Answer{
		AnswerID:    answerID,
		RoomID:      roomID,
		PlayerID:    playerID,
		PlayerName:  playerName,
		AnswerType:  answerType,
		TextAnswer:  textAnswer,
		DrawingData: drawingData,
		SubmittedAt: now,
	}

	// DynamoDBに保存
	answerItem, err := attributevalue.MarshalMap(answer)
	if err != nil {
		return nil, fmt.Errorf("回答のマーシャルに失敗: %w", err)
	}

	_, err = ddbClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(answerTable),
		Item:      answerItem,
	})
	if err != nil {
		return nil, fmt.Errorf("回答の作成に失敗: %w", err)
	}

	return &answer, nil
}

// startJudging - 判定画面に遷移
// 状態をJUDGINGに変更し、コメントを生成する
func startJudging(ctx context.Context, args map[string]interface{}) (*Room, error) {
	roomID := args["roomId"].(string)
	now := time.Now().UTC().Format(time.RFC3339)

	// 状態をJUDGINGに更新
	_, err := ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(roomTable),
		Key: map[string]types.AttributeValue{
			"roomId": &types.AttributeValueMemberS{Value: roomID},
		},
		UpdateExpression: aws.String("SET #state = :state, #updatedAt = :updatedAt"),
		ExpressionAttributeNames: map[string]string{
			"#state":     "state",
			"#updatedAt": "updatedAt",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":state":     &types.AttributeValueMemberS{Value: "JUDGING"},
			":updatedAt": &types.AttributeValueMemberS{Value: now},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("ルームの更新に失敗: %w", err)
	}

	// ニコニコ風コメントを生成
	log.Println("コメントを生成中...")
	_, err = generateJudgingComments(ctx, args)
	if err != nil {
		log.Printf("警告: コメント生成に失敗: %v", err)
	}
	log.Println("コメント生成完了")

	return getRoom(ctx, map[string]interface{}{"roomId": roomID})
}

// generateJudgingComments - 判定用コメントを生成
func generateJudgingComments(ctx context.Context, args map[string]interface{}) (*JudgeResult, error) {
	roomID := args["roomId"].(string)
	now := time.Now().UTC().Format(time.RFC3339)

	// ルーム情報を取得
	room, err := getRoom(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		return nil, err
	}
	if room == nil {
		return nil, fmt.Errorf("ルームが見つかりません")
	}

	// コメントを生成
	log.Println("コメントを非同期生成中...")
	topic := ""
	if room.Topic != nil {
		topic = *room.Topic
	}
	comments, err := generateComments(topic, room.Answers)
	if err != nil {
		return nil, fmt.Errorf("コメントの生成に失敗: %w", err)
	}
	log.Printf("生成されたコメント数: %d", len(comments))

	// コメントをルームに保存
	_, err = ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(roomTable),
		Key: map[string]types.AttributeValue{
			"roomId": &types.AttributeValueMemberS{Value: roomID},
		},
		UpdateExpression: aws.String("SET #comments = :comments, #judgedAt = :judgedAt, #updatedAt = :updatedAt"),
		ExpressionAttributeNames: map[string]string{
			"#comments":  "comments",
			"#judgedAt":  "judgedAt",
			"#updatedAt": "updatedAt",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":comments":  marshalStringList(comments),
			":judgedAt":  &types.AttributeValueMemberS{Value: now},
			":updatedAt": &types.AttributeValueMemberS{Value: now},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("ルームの更新に失敗: %w", err)
	}

	return &JudgeResult{
		RoomID:   roomID,
		Comments: comments,
		JudgedAt: now,
	}, nil
}

// judgeAnswers - 判定結果を保存
func judgeAnswers(ctx context.Context, args map[string]interface{}) (*JudgeResult, error) {
	roomID := args["roomId"].(string)
	isMatch := args["isMatch"].(bool)
	now := time.Now().UTC().Format(time.RFC3339)

	log.Printf("判定実行: roomId=%s, isMatch=%v", roomID, isMatch)

	// 判定結果を保存
	_, err := ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(roomTable),
		Key: map[string]types.AttributeValue{
			"roomId": &types.AttributeValueMemberS{Value: roomID},
		},
		UpdateExpression: aws.String("SET #lastJudgeResult = :lastJudgeResult, #updatedAt = :updatedAt"),
		ExpressionAttributeNames: map[string]string{
			"#lastJudgeResult": "lastJudgeResult",
			"#updatedAt":       "updatedAt",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":lastJudgeResult": &types.AttributeValueMemberBOOL{Value: isMatch},
			":updatedAt":       &types.AttributeValueMemberS{Value: now},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("ルームの更新に失敗: %w", err)
	}

	log.Println("DynamoDB更新完了")

	return &JudgeResult{
		RoomID:   roomID,
		IsMatch:  isMatch,
		JudgedAt: now,
	}, nil
}

// nextRound - 次のラウンドに進む
func nextRound(ctx context.Context, args map[string]interface{}) (*Room, error) {
	roomID := args["roomId"].(string)
	log.Printf("次のラウンド: roomId=%s", roomID)

	// ルーム情報を取得
	room, err := getRoom(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		return nil, err
	}
	if room == nil {
		return nil, fmt.Errorf("ルームが見つかりません")
	}

	// 前ラウンドの回答を削除
	answers, err := listAnswers(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		return nil, err
	}
	for _, answer := range answers {
		_, err := ddbClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(answerTable),
			Key: map[string]types.AttributeValue{
				"answerId": &types.AttributeValueMemberS{Value: answer.AnswerID},
			},
		})
		if err != nil {
			log.Printf("警告: 回答の削除に失敗 %s: %v", answer.AnswerID, err)
		}
	}

	topicsPool := room.TopicsPool
	usedTopics := room.UsedTopics

	// お題プールが少なくなったら追加生成
	if len(topicsPool) <= 3 {
		log.Println("お題プールが少なくなったため、追加生成中...")
		newTopics, err := generateTopics(usedTopics)
		if err != nil {
			return nil, fmt.Errorf("お題の生成に失敗: %w", err)
		}
		log.Printf("追加生成されたお題: %v", newTopics)
		topicsPool = append(topicsPool, newTopics...)
	}

	// 次のお題を取得
	nextTopic := topicsPool[0]
	remainingTopics := topicsPool[1:]
	usedTopics = append(usedTopics, nextTopic)

	now := time.Now().UTC().Format(time.RFC3339)

	// ルームを更新（判定結果をクリアして次のラウンドへ）
	_, err = ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(roomTable),
		Key: map[string]types.AttributeValue{
			"roomId": &types.AttributeValueMemberS{Value: roomID},
		},
		UpdateExpression: aws.String("SET #state = :state, #topic = :topic, #topicsPool = :topicsPool, #usedTopics = :usedTopics, #updatedAt = :updatedAt REMOVE #lastJudgeResult, #judgedAt"),
		ExpressionAttributeNames: map[string]string{
			"#state":           "state",
			"#topic":           "topic",
			"#topicsPool":      "topicsPool",
			"#usedTopics":      "usedTopics",
			"#updatedAt":       "updatedAt",
			"#lastJudgeResult": "lastJudgeResult",
			"#judgedAt":        "judgedAt",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":state":      &types.AttributeValueMemberS{Value: "ANSWERING"},
			":topic":      &types.AttributeValueMemberS{Value: nextTopic},
			":topicsPool": marshalStringList(remainingTopics),
			":usedTopics": marshalStringList(usedTopics),
			":updatedAt":  &types.AttributeValueMemberS{Value: now},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("ルームの更新に失敗: %w", err)
	}

	return getRoom(ctx, map[string]interface{}{"roomId": roomID})
}

// endGame - ゲームを終了
func endGame(ctx context.Context, args map[string]interface{}) (*Room, error) {
	roomID := args["roomId"].(string)
	now := time.Now().UTC().Format(time.RFC3339)

	// 状態をWAITINGに戻す
	_, err := ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(roomTable),
		Key: map[string]types.AttributeValue{
			"roomId": &types.AttributeValueMemberS{Value: roomID},
		},
		UpdateExpression: aws.String("SET #state = :state, #updatedAt = :updatedAt REMOVE #topic"),
		ExpressionAttributeNames: map[string]string{
			"#state":     "state",
			"#topic":     "topic",
			"#updatedAt": "updatedAt",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":state":     &types.AttributeValueMemberS{Value: "WAITING"},
			":updatedAt": &types.AttributeValueMemberS{Value: now},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("ルームの更新に失敗: %w", err)
	}

	return getRoom(ctx, map[string]interface{}{"roomId": roomID})
}

// ===========================================
// データ取得機能（Query）
// ===========================================

// getRoom - ルーム情報を取得
// プレイヤーと回答も結合して返す
func getRoom(ctx context.Context, args map[string]interface{}) (*Room, error) {
	roomID := args["roomId"].(string)

	// ルームを取得
	result, err := ddbClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(roomTable),
		Key: map[string]types.AttributeValue{
			"roomId": &types.AttributeValueMemberS{Value: roomID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("ルームの取得に失敗: %w", err)
	}

	if result.Item == nil {
		return nil, nil
	}

	var room Room
	if err := attributevalue.UnmarshalMap(result.Item, &room); err != nil {
		return nil, fmt.Errorf("ルームのアンマーシャルに失敗: %w", err)
	}

	// プレイヤー一覧を取得して結合
	players, err := listPlayers(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		return nil, err
	}
	room.Players = players

	// 回答一覧を取得して結合
	answers, err := listAnswers(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		return nil, err
	}
	room.Answers = answers

	return &room, nil
}

// getRoomByCode - ルームコードからルームを検索
func getRoomByCode(ctx context.Context, args map[string]interface{}) (*Room, error) {
	roomCode := args["roomCode"].(string)

	// GSIを使ってルームコードで検索
	result, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(roomTable),
		IndexName:              aws.String("roomCode-index"),
		KeyConditionExpression: aws.String("roomCode = :roomCode"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":roomCode": &types.AttributeValueMemberS{Value: roomCode},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("ルームの検索に失敗: %w", err)
	}

	if len(result.Items) == 0 {
		return nil, nil
	}

	var room Room
	if err := attributevalue.UnmarshalMap(result.Items[0], &room); err != nil {
		return nil, fmt.Errorf("ルームのアンマーシャルに失敗: %w", err)
	}

	// プレイヤーと回答を結合
	players, err := listPlayers(ctx, map[string]interface{}{"roomId": room.RoomID})
	if err != nil {
		return nil, err
	}
	room.Players = players

	answers, err := listAnswers(ctx, map[string]interface{}{"roomId": room.RoomID})
	if err != nil {
		return nil, err
	}
	room.Answers = answers

	return &room, nil
}

// listPlayers - ルームのプレイヤー一覧を取得
func listPlayers(ctx context.Context, args map[string]interface{}) ([]Player, error) {
	roomID := args["roomId"].(string)

	// GSIを使ってroomIdで検索
	result, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(playerTable),
		IndexName:              aws.String("roomId-index"),
		KeyConditionExpression: aws.String("roomId = :roomId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":roomId": &types.AttributeValueMemberS{Value: roomID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("プレイヤーの検索に失敗: %w", err)
	}

	var players []Player
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &players); err != nil {
		return nil, fmt.Errorf("プレイヤーのアンマーシャルに失敗: %w", err)
	}

	return players, nil
}

// listAnswers - ルームの回答一覧を取得
func listAnswers(ctx context.Context, args map[string]interface{}) ([]Answer, error) {
	roomID := args["roomId"].(string)

	// GSIを使ってroomIdで検索
	result, err := ddbClient.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(answerTable),
		IndexName:              aws.String("roomId-index"),
		KeyConditionExpression: aws.String("roomId = :roomId"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":roomId": &types.AttributeValueMemberS{Value: roomID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("回答の検索に失敗: %w", err)
	}

	var answers []Answer
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &answers); err != nil {
		return nil, fmt.Errorf("回答のアンマーシャルに失敗: %w", err)
	}

	return answers, nil
}

// ===========================================
// 開発用機能
// ===========================================

// deleteAllData - 全データを削除（開発用）
func deleteAllData(ctx context.Context) (*DeleteAllDataResponse, error) {
	log.Println("全データ削除を開始")

	deletedCounts := DeletedCounts{}

	// 回答を全削除
	answersResult, err := ddbClient.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(answerTable),
	})
	if err != nil {
		return nil, fmt.Errorf("回答のスキャンに失敗: %w", err)
	}

	for _, item := range answersResult.Items {
		var answer Answer
		if err := attributevalue.UnmarshalMap(item, &answer); err != nil {
			continue
		}
		_, err := ddbClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(answerTable),
			Key: map[string]types.AttributeValue{
				"answerId": &types.AttributeValueMemberS{Value: answer.AnswerID},
			},
		})
		if err == nil {
			deletedCounts.Answers++
		}
	}

	// プレイヤーを全削除
	playersResult, err := ddbClient.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(playerTable),
	})
	if err != nil {
		return nil, fmt.Errorf("プレイヤーのスキャンに失敗: %w", err)
	}

	for _, item := range playersResult.Items {
		var player Player
		if err := attributevalue.UnmarshalMap(item, &player); err != nil {
			continue
		}
		_, err := ddbClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(playerTable),
			Key: map[string]types.AttributeValue{
				"playerId": &types.AttributeValueMemberS{Value: player.PlayerID},
			},
		})
		if err == nil {
			deletedCounts.Players++
		}
	}

	// ルームを全削除
	roomsResult, err := ddbClient.Scan(ctx, &dynamodb.ScanInput{
		TableName: aws.String(roomTable),
	})
	if err != nil {
		return nil, fmt.Errorf("ルームのスキャンに失敗: %w", err)
	}

	for _, item := range roomsResult.Items {
		var room Room
		if err := attributevalue.UnmarshalMap(item, &room); err != nil {
			continue
		}
		_, err := ddbClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(roomTable),
			Key: map[string]types.AttributeValue{
				"roomId": &types.AttributeValueMemberS{Value: room.RoomID},
			},
		})
		if err == nil {
			deletedCounts.Rooms++
		}
	}

	log.Printf("全データ削除完了: %+v", deletedCounts)

	return &DeleteAllDataResponse{
		Success:       true,
		Message:       "全データを削除しました",
		DeletedCounts: deletedCounts,
	}, nil
}
