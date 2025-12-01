// game.go - ゲーム進行管理機能
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

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

	// 更新後のルーム情報を取得してPublish
	updatedRoom, err := getRoom(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		return nil, err
	}

	// Subscription用にPublish
	if err := PublishRoomUpdated(ctx, updatedRoom); err != nil {
		log.Printf("警告: PublishRoomUpdatedに失敗: %v", err)
	}

	return updatedRoom, nil
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

	// Subscription用にPublish
	if err := PublishAnswerSubmitted(ctx, &answer); err != nil {
		log.Printf("警告: PublishAnswerSubmittedに失敗: %v", err)
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

	// 更新後のルーム情報を取得してPublish
	updatedRoom, err := getRoom(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		return nil, err
	}

	// Subscription用にPublish
	if err := PublishRoomUpdated(ctx, updatedRoom); err != nil {
		log.Printf("警告: PublishRoomUpdatedに失敗: %v", err)
	}

	return updatedRoom, nil
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

	result := &JudgeResult{
		RoomID:   roomID,
		IsMatch:  isMatch,
		JudgedAt: now,
	}

	// Subscription用にPublish
	if err := PublishJudgeResult(ctx, result); err != nil {
		log.Printf("警告: PublishJudgeResultに失敗: %v", err)
	}

	return result, nil
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

	// 更新後のルーム情報を取得してPublish
	updatedRoom, err := getRoom(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		return nil, err
	}

	// Subscription用にPublish
	if err := PublishRoomUpdated(ctx, updatedRoom); err != nil {
		log.Printf("警告: PublishRoomUpdatedに失敗: %v", err)
	}

	return updatedRoom, nil
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

	// 更新後のルーム情報を取得してPublish
	updatedRoom, err := getRoom(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		return nil, err
	}

	// Subscription用にPublish
	if err := PublishRoomUpdated(ctx, updatedRoom); err != nil {
		log.Printf("警告: PublishRoomUpdatedに失敗: %v", err)
	}

	return updatedRoom, nil
}
