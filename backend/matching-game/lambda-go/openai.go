// openai.go - OpenAI API連携機能
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// generateTopics - OpenAI APIを使ってお題を130個一気に生成（高品質プロンプト）
func generateTopics(usedTopics []string) ([]string, error) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("OPENAI_API_KEYが設定されていません")
	}

	// 使用済みお題をマップに変換（高速な重複チェック用）
	usedTopicsMap := make(map[string]bool)
	for _, t := range usedTopics {
		usedTopicsMap[t] = true
	}

	// 使用済みお題のテキスト（最新100個渡す）
	usedTopicsText := ""
	if len(usedTopics) > 0 {
		recentUsed := usedTopics
		if len(usedTopics) > 100 {
			recentUsed = usedTopics[len(usedTopics)-100:]
		}
		usedTopicsText = fmt.Sprintf("\n\n【絶対に避けるべきお題】以下と同じ・類似のお題は絶対に出さないこと。似たパターンも禁止：\n%s", strings.Join(recentUsed, "\n"))
	}

	// 高品質なお題を生成するプロンプト
	systemPrompt := fmt.Sprintf(`あなたは「認識合わせゲーム」のお題作成の専門家です。
このゲームでは、参加者全員が同じ答えを思いつくことが目標です。

【あなたの任務】
日本人なら誰でも答えが一致するような、高品質なお題を130個作成してください。

【高品質なお題の条件】
1. 答えが1〜3個に自然と収束する
2. 具体的な場面・状況で限定されている
3. 「〜といえば？」の形式で統一
4. 日本人の常識・共通体験に基づいている

【必須のカテゴリ配分】130個の中で以下を必ず含めること：
- 食べ物・飲み物（22問）：コンビニ、給食、お祭り、季節の食べ物、お菓子など
- 場所・観光地（13問）：修学旅行、観光名所、都道府県の名物など
- キャラクター・アニメ（18問）：国民的アニメ、キャラクターの特徴など
- 学校・行事（13問）：運動会、夏休み、卒業式、授業、部活など
- 動物・生き物（13問）：ペット、動物園、虫、水族館など
- 色・形・特徴（13問）：「赤い〜」「丸い〜」「甘い〜」など
- お店・チェーン（13問）：コンビニ、ファストフード、100均など
- 乗り物・交通（8問）：電車、新幹線、飛行機など
- スポーツ・遊び（8問）：野球、サッカー、ゲーム、カードなど
- その他（9問）：芸能人、音楽、映画など

【良いお題の例】
- コンビニのおにぎりで一番人気の具といえば？
- 修学旅行で行く定番の場所といえば？
- ドラえもんの道具の定番といえば？
- 給食の人気メニューといえば？
- 動物園の人気者といえば？
- 赤い野菜といえば？
- ファストフードの定番チェーンといえば？
- 運動会の定番競技といえば？

【絶対にNGな例】
- 「春といえば？」→ 抽象的すぎて答えが発散
- 「好きな食べ物は？」→ 個人の好みで答えがバラバラ
- 「有名アーティストの代表曲は？」→ 二段階で絞っていて答えが定まらない
- 同じパターンの連続（「黄色い〜」「赤い〜」「青い〜」を連続で出すなど）%s

【出力形式】
- お題のみを1行ずつ出力
- 番号や記号は付けない
- 答えの例や説明は絶対に含めない
- 必ず130個出力すること`, usedTopicsText)

	// OpenAI APIリクエストを構築（130個リクエスト）
	reqBody := OpenAIRequest{
		Model: "gpt-4o-mini",
		Messages: []OpenAIMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: "上記の条件に従って、高品質なお題を130個生成してください。各カテゴリからバランスよく出題し、同じパターンの繰り返しを避けてください。"},
		},
		Temperature: 0.9,
		MaxTokens:   8000,
	}

	// APIを呼び出してお題を取得
	topics, err := callOpenAI(reqBody)
	if err != nil {
		return nil, err
	}

	// お題をクリーンアップして重複チェック
	var resultTopics []string
	for _, topic := range topics {
		cleaned := cleanTopic(topic)
		if cleaned == "" {
			continue
		}

		// 重複チェック（使用済みお題）
		if usedTopicsMap[cleaned] {
			continue
		}

		// 今回の結果に既にあるかチェック
		duplicate := false
		for _, rt := range resultTopics {
			if rt == cleaned {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}

		resultTopics = append(resultTopics, cleaned)
	}

	return resultTopics, nil
}

// cleanTopic - お題文字列をクリーンアップ
func cleanTopic(topic string) string {
	// 「→」以降を削除（答えの例が含まれている場合）
	if idx := strings.Index(topic, "→"); idx != -1 {
		topic = strings.TrimSpace(topic[:idx])
	}
	// 先頭の「- 」「・」「「」を削除
	topic = strings.TrimPrefix(topic, "- ")
	topic = strings.TrimPrefix(topic, "・")
	topic = strings.TrimPrefix(topic, "「")
	topic = strings.TrimSuffix(topic, "」")
	return strings.TrimSpace(topic)
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

	// APIを呼び出し（90個生成には時間がかかるため60秒に設定）
	client := &http.Client{Timeout: 60 * time.Second}
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
