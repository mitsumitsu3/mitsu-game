// models.go - データ構造体の定義
package main

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
	RoomID          string   `json:"roomId" dynamodbav:"roomId"`                                        // ルームID（UUID）
	RoomCode        string   `json:"roomCode" dynamodbav:"roomCode"`                                    // ルームコード（6桁数字）
	HostID          string   `json:"hostId" dynamodbav:"hostId"`                                        // ホストのプレイヤーID
	State           string   `json:"state" dynamodbav:"state"`                                          // ゲーム状態（WAITING/ANSWERING/JUDGING）
	Topic           *string  `json:"topic" dynamodbav:"topic,omitempty"`                                // 現在のお題
	TopicsPool      []string `json:"topicsPool" dynamodbav:"topicsPool"`                                // 未使用のお題プール
	UsedTopics      []string `json:"usedTopics" dynamodbav:"usedTopics"`                                // 使用済みお題リスト
	LastJudgeResult *bool    `json:"lastJudgeResult,omitempty" dynamodbav:"lastJudgeResult,omitempty"`  // 前回の判定結果
	JudgedAt        *string  `json:"judgedAt,omitempty" dynamodbav:"judgedAt,omitempty"`                // 判定日時
	Comments        []string `json:"comments,omitempty" dynamodbav:"comments,omitempty"`                // ニコニコ風コメント
	CreatedAt       string   `json:"createdAt" dynamodbav:"createdAt"`                                  // 作成日時
	UpdatedAt       string   `json:"updatedAt" dynamodbav:"updatedAt"`                                  // 更新日時
	TTL             int64    `json:"ttl" dynamodbav:"ttl"`                                              // TTL（24時間後に自動削除）
	Players         []Player `json:"players"`                                                           // プレイヤー一覧（結合データ）
	Answers         []Answer `json:"answers"`                                                           // 回答一覧（結合データ）
}

// Player - プレイヤー情報
type Player struct {
	PlayerID  string `json:"playerId" dynamodbav:"playerId"`   // プレイヤーID（UUID）
	RoomID    string `json:"roomId" dynamodbav:"roomId"`       // 所属ルームID
	RoomCode  string `json:"roomCode" dynamodbav:"-"`          // ルームコード（Subscriptionフィルタ用、DBには保存しない）
	Name      string `json:"name" dynamodbav:"name"`           // プレイヤー名
	Role      string `json:"role" dynamodbav:"role"`           // 役割（HOST/PLAYER）
	Connected bool   `json:"connected" dynamodbav:"connected"` // 接続状態
	JoinedAt  string `json:"joinedAt" dynamodbav:"joinedAt"`   // 参加日時
}

// Answer - 回答情報
type Answer struct {
	AnswerID    string  `json:"answerId" dynamodbav:"answerId"`                           // 回答ID（UUID）
	RoomID      string  `json:"roomId" dynamodbav:"roomId"`                               // ルームID
	PlayerID    string  `json:"playerId" dynamodbav:"playerId"`                           // プレイヤーID
	PlayerName  string  `json:"playerName" dynamodbav:"playerName"`                       // プレイヤー名
	AnswerType  string  `json:"answerType" dynamodbav:"answerType"`                       // 回答タイプ（TEXT）
	TextAnswer  *string `json:"textAnswer,omitempty" dynamodbav:"textAnswer,omitempty"`   // テキスト回答
	DrawingData *string `json:"drawingData,omitempty" dynamodbav:"drawingData,omitempty"` // 絵（未使用）
	SubmittedAt string  `json:"submittedAt" dynamodbav:"submittedAt"`                     // 提出日時
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
