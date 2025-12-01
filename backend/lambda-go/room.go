// room.go - ルーム管理機能
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

	// Subscription用にPublish
	if err := PublishPlayerJoined(ctx, &player); err != nil {
		log.Printf("警告: PublishPlayerJoinedに失敗: %v", err)
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

// kickPlayer - プレイヤーを追放（ホストのみ）
func kickPlayer(ctx context.Context, args map[string]interface{}) (bool, error) {
	roomID := args["roomId"].(string)
	playerID := args["playerId"].(string)
	kickedPlayerID := args["kickedPlayerId"].(string)

	log.Printf("プレイヤー追放: roomId=%s, playerId=%s, kickedPlayerId=%s", roomID, playerID, kickedPlayerID)

	// ルーム情報を取得してホストか確認
	room, err := getRoom(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		return false, err
	}
	if room == nil {
		return false, fmt.Errorf("ルームが見つかりません")
	}

	// ホストのみ追放可能
	if room.HostID != playerID {
		return false, fmt.Errorf("ホストのみがプレイヤーを追放できます")
	}

	// 自分自身は追放できない
	if playerID == kickedPlayerID {
		return false, fmt.Errorf("自分自身を追放することはできません")
	}

	// プレイヤーを削除
	_, err = ddbClient.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(playerTable),
		Key: map[string]types.AttributeValue{
			"playerId": &types.AttributeValueMemberS{Value: kickedPlayerID},
		},
	})
	if err != nil {
		return false, fmt.Errorf("プレイヤーの削除に失敗: %w", err)
	}

	// 追放されたプレイヤーの回答も削除
	answers, err := listAnswers(ctx, map[string]interface{}{"roomId": roomID})
	if err != nil {
		log.Printf("警告: 回答の取得に失敗: %v", err)
	} else {
		for _, answer := range answers {
			if answer.PlayerID == kickedPlayerID {
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
		}
	}

	log.Printf("プレイヤー追放完了: kickedPlayerId=%s", kickedPlayerID)
	return true, nil
}

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
