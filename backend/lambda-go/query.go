// query.go - データ取得機能（Query）
package main

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

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

	// nullの場合は空配列を設定（GraphQLスキーマでnon-nullableのため）
	if room.TopicsPool == nil {
		room.TopicsPool = []string{}
	}
	if room.UsedTopics == nil {
		room.UsedTopics = []string{}
	}
	if room.Comments == nil {
		room.Comments = []string{}
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

	// nullの場合は空配列を設定（GraphQLスキーマでnon-nullableのため）
	if room.TopicsPool == nil {
		room.TopicsPool = []string{}
	}
	if room.UsedTopics == nil {
		room.UsedTopics = []string{}
	}
	if room.Comments == nil {
		room.Comments = []string{}
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
