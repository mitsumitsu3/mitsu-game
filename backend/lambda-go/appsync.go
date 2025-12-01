// appsync.go - AppSync Subscription用のPublish処理
// LambdaからAppSyncのMutationを呼び出してSubscriptionをトリガーする
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/config"
)

var (
	appsyncEndpoint string
	awsRegion       string
)

func init() {
	appsyncEndpoint = os.Getenv("APPSYNC_ENDPOINT")
	awsRegion = os.Getenv("AWS_REGION")
	if awsRegion == "" {
		awsRegion = "ap-northeast-1"
	}
}

// GraphQLRequest - AppSyncへのリクエスト構造
type GraphQLRequest struct {
	Query     string                 `json:"query"`
	Variables map[string]interface{} `json:"variables,omitempty"`
}

// GraphQLResponse - AppSyncからのレスポンス構造
type GraphQLResponse struct {
	Data   interface{} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors,omitempty"`
}

// executeAppSyncMutation - AppSyncのMutationを実行
func executeAppSyncMutation(ctx context.Context, query string, variables map[string]interface{}) error {
	if appsyncEndpoint == "" {
		log.Println("警告: APPSYNC_ENDPOINTが未設定のためSubscription publishをスキップ")
		return nil
	}

	// リクエストボディを作成
	reqBody := GraphQLRequest{
		Query:     query,
		Variables: variables,
	}
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("リクエストボディのシリアライズに失敗: %w", err)
	}

	// HTTPリクエストを作成
	req, err := http.NewRequestWithContext(ctx, "POST", appsyncEndpoint, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("HTTPリクエストの作成に失敗: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	// AWS SigV4署名
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("AWS設定の読み込みに失敗: %w", err)
	}

	creds, err := cfg.Credentials.Retrieve(ctx)
	if err != nil {
		return fmt.Errorf("認証情報の取得に失敗: %w", err)
	}

	// ボディのハッシュを計算
	hash := sha256.Sum256(jsonBody)
	payloadHash := hex.EncodeToString(hash[:])

	signer := v4.NewSigner()
	err = signer.SignHTTP(ctx, creds, req, payloadHash, "appsync", awsRegion, time.Now())
	if err != nil {
		return fmt.Errorf("リクエストの署名に失敗: %w", err)
	}

	// リクエストを送信
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("AppSyncリクエストの送信に失敗: %w", err)
	}
	defer resp.Body.Close()

	// レスポンスを読み取り
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("レスポンスの読み取りに失敗: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("AppSyncエラー: status=%d, body=%s", resp.StatusCode, string(body))
	}

	// エラーチェック
	var graphqlResp GraphQLResponse
	if err := json.Unmarshal(body, &graphqlResp); err != nil {
		return fmt.Errorf("レスポンスのパースに失敗: %w", err)
	}

	if len(graphqlResp.Errors) > 0 {
		return fmt.Errorf("GraphQLエラー: %s", graphqlResp.Errors[0].Message)
	}

	log.Printf("AppSync Mutation成功: %s", string(body)[:min(200, len(body))])
	return nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ===========================================
// Publish関数
// ===========================================

// PublishPlayerJoined - プレイヤー参加をSubscriberに通知
func PublishPlayerJoined(ctx context.Context, player *Player) error {
	query := `
		mutation PublishPlayerJoined(
			$playerId: ID!
			$roomId: ID!
			$name: String!
			$role: PlayerRole!
			$connected: Boolean!
			$joinedAt: AWSDateTime!
		) {
			publishPlayerJoined(
				playerId: $playerId
				roomId: $roomId
				name: $name
				role: $role
				connected: $connected
				joinedAt: $joinedAt
			) {
				playerId
				roomId
				name
				role
				connected
				joinedAt
			}
		}
	`

	variables := map[string]interface{}{
		"playerId":  player.PlayerID,
		"roomId":    player.RoomID,
		"name":      player.Name,
		"role":      player.Role,
		"connected": player.Connected,
		"joinedAt":  player.JoinedAt,
	}

	log.Printf("PublishPlayerJoined: playerId=%s, roomId=%s", player.PlayerID, player.RoomID)
	return executeAppSyncMutation(ctx, query, variables)
}

// PublishRoomUpdated - ルーム更新をSubscriberに通知
func PublishRoomUpdated(ctx context.Context, room *Room) error {
	query := `
		mutation PublishRoomUpdated(
			$roomId: ID!
			$roomCode: String!
			$hostId: ID!
			$state: GameState!
			$topic: String
			$topicsPool: [String!]!
			$usedTopics: [String!]!
			$lastJudgeResult: Boolean
			$judgedAt: AWSDateTime
			$comments: [String!]
			$createdAt: AWSDateTime!
			$updatedAt: AWSDateTime!
			$players: [PlayerInput!]!
			$answers: [AnswerInput!]!
		) {
			publishRoomUpdated(
				roomId: $roomId
				roomCode: $roomCode
				hostId: $hostId
				state: $state
				topic: $topic
				topicsPool: $topicsPool
				usedTopics: $usedTopics
				lastJudgeResult: $lastJudgeResult
				judgedAt: $judgedAt
				comments: $comments
				createdAt: $createdAt
				updatedAt: $updatedAt
				players: $players
				answers: $answers
			) {
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

	// プレイヤーをInput型に変換
	playerInputs := make([]map[string]interface{}, len(room.Players))
	for i, p := range room.Players {
		playerInputs[i] = map[string]interface{}{
			"playerId":  p.PlayerID,
			"roomId":    p.RoomID,
			"name":      p.Name,
			"role":      p.Role,
			"connected": p.Connected,
			"joinedAt":  p.JoinedAt,
		}
	}

	// 回答をInput型に変換
	answerInputs := make([]map[string]interface{}, len(room.Answers))
	for i, a := range room.Answers {
		answerInput := map[string]interface{}{
			"answerId":   a.AnswerID,
			"roomId":     a.RoomID,
			"playerId":   a.PlayerID,
			"playerName": a.PlayerName,
			"answerType": a.AnswerType,
		}
		if a.TextAnswer != nil {
			answerInput["textAnswer"] = *a.TextAnswer
		}
		if a.DrawingData != nil {
			answerInput["drawingData"] = *a.DrawingData
		}
		answerInput["submittedAt"] = a.SubmittedAt
		answerInputs[i] = answerInput
	}

	variables := map[string]interface{}{
		"roomId":     room.RoomID,
		"roomCode":   room.RoomCode,
		"hostId":     room.HostID,
		"state":      room.State,
		"topicsPool": room.TopicsPool,
		"usedTopics": room.UsedTopics,
		"createdAt":  room.CreatedAt,
		"updatedAt":  room.UpdatedAt,
		"players":    playerInputs,
		"answers":    answerInputs,
	}

	if room.Topic != nil {
		variables["topic"] = *room.Topic
	}
	if room.LastJudgeResult != nil {
		variables["lastJudgeResult"] = *room.LastJudgeResult
	}
	if room.JudgedAt != nil {
		variables["judgedAt"] = *room.JudgedAt
	}
	if room.Comments != nil {
		variables["comments"] = room.Comments
	}

	log.Printf("PublishRoomUpdated: roomId=%s, state=%s", room.RoomID, room.State)
	return executeAppSyncMutation(ctx, query, variables)
}

// PublishAnswerSubmitted - 回答提出をSubscriberに通知
func PublishAnswerSubmitted(ctx context.Context, answer *Answer) error {
	query := `
		mutation PublishAnswerSubmitted(
			$answerId: ID!
			$roomId: ID!
			$playerId: ID!
			$playerName: String!
			$answerType: AnswerType!
			$textAnswer: String
			$drawingData: String
			$submittedAt: AWSDateTime!
		) {
			publishAnswerSubmitted(
				answerId: $answerId
				roomId: $roomId
				playerId: $playerId
				playerName: $playerName
				answerType: $answerType
				textAnswer: $textAnswer
				drawingData: $drawingData
				submittedAt: $submittedAt
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

	variables := map[string]interface{}{
		"answerId":    answer.AnswerID,
		"roomId":      answer.RoomID,
		"playerId":    answer.PlayerID,
		"playerName":  answer.PlayerName,
		"answerType":  answer.AnswerType,
		"submittedAt": answer.SubmittedAt,
	}

	if answer.TextAnswer != nil {
		variables["textAnswer"] = *answer.TextAnswer
	}
	if answer.DrawingData != nil {
		variables["drawingData"] = *answer.DrawingData
	}

	log.Printf("PublishAnswerSubmitted: answerId=%s, roomId=%s", answer.AnswerID, answer.RoomID)
	return executeAppSyncMutation(ctx, query, variables)
}

// PublishJudgeResult - 判定結果をSubscriberに通知
func PublishJudgeResult(ctx context.Context, result *JudgeResult) error {
	query := `
		mutation PublishJudgeResult(
			$roomId: ID!
			$isMatch: Boolean!
			$judgedAt: AWSDateTime!
		) {
			publishJudgeResult(
				roomId: $roomId
				isMatch: $isMatch
				judgedAt: $judgedAt
			) {
				roomId
				isMatch
				judgedAt
			}
		}
	`

	variables := map[string]interface{}{
		"roomId":   result.RoomID,
		"isMatch":  result.IsMatch,
		"judgedAt": result.JudgedAt,
	}

	log.Printf("PublishJudgeResult: roomId=%s, isMatch=%v", result.RoomID, result.IsMatch)
	return executeAppSyncMutation(ctx, query, variables)
}
