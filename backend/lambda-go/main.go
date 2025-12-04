// 認識合わせゲーム - バックエンドLambda関数 (Go版)
// AWS AppSyncからのGraphQLリクエストを処理するLambda関数
//
// ファイル構成:
// - main.go    : エントリポイント、初期化、ルーティング、ユーティリティ
// - models.go  : データ構造体の定義
// - room.go    : ルーム管理機能（作成・参加・退出・削除）
// - game.go    : ゲーム進行管理（開始・回答・判定・次ラウンド）
// - query.go   : データ取得機能（ルーム・プレイヤー・回答の取得）
// - openai.go  : OpenAI API連携（お題・コメント生成）
package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
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
	// ルーム管理 (room.go)
	case "createRoom":
		return createRoom(ctx, event.Arguments)
	case "joinRoom":
		return joinRoom(ctx, event.Arguments)
	case "leaveRoom":
		return leaveRoom(ctx, event.Arguments)
	case "kickPlayer":
		return kickPlayer(ctx, event.Arguments)
	case "deleteAllData":
		return deleteAllData(ctx)

	// ゲーム進行 (game.go)
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
	case "skipTopic":
		return skipTopic(ctx, event.Arguments)
	case "endGame":
		return endGame(ctx, event.Arguments)

	// ========== Query（データ取得操作） ==========
	// データ取得 (query.go)
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
