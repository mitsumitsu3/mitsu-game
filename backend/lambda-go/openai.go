// openai.go - OpenAI API連携機能
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"
)

// カテゴリプール - ランダムに選択してバリエーションを出す
var categoryPool = []string{
	"食べ物・料理・グルメ",
	"スポーツ・運動",
	"芸能人・有名人・タレント",
	"アニメ・漫画・ゲーム",
	"場所・観光地・旅行",
	"企業・ブランド・お店",
	"音楽・アーティスト・楽器",
	"映画・ドラマ・テレビ番組",
	"学校・教育・勉強",
	"季節・イベント・行事",
	"動物・生き物",
	"乗り物・交通",
	"家電・日用品・生活",
	"ファッション・服・アクセサリー",
	"趣味・遊び・娯楽",
	"歴史・偉人・文化",
	"職業・仕事",
	"飲み物・ドリンク",
	"お菓子・スイーツ・デザート",
	"自然・天気・地理",
}

// generateTopics - OpenAI APIを使ってお題を5個生成（カテゴリランダム、重複チェック付き）
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

	var resultTopics []string
	maxRetries := 3 // 最大3回まで追加取得を試みる

	for retry := 0; retry < maxRetries && len(resultTopics) < 5; retry++ {
		// ランダムに3つのカテゴリを選択
		rand.Seed(time.Now().UnixNano())
		selectedCategories := selectRandomCategories(3)
		categoriesText := strings.Join(selectedCategories, "、")

		// 使用済みお題 + 今回既に取得したお題を合わせてGPTに渡す
		allUsedTopics := append(usedTopics, resultTopics...)
		usedTopicsText := ""
		if len(allUsedTopics) > 0 {
			// 最新20個だけ渡す（プロンプトが長くなりすぎないように）
			recentUsed := allUsedTopics
			if len(allUsedTopics) > 20 {
				recentUsed = allUsedTopics[len(allUsedTopics)-20:]
			}
			usedTopicsText = fmt.Sprintf("\n\n【使用済みのお題】（これらと同じ・似たお題は絶対に避けること）：\n%s", strings.Join(recentUsed, "\n"))
		}

		// お題生成用のシステムプロンプト（常に5個リクエスト）
		systemPrompt := fmt.Sprintf(`「認識合わせゲーム」のお題を5個生成してください。このゲームは参加者全員が同じ答えを思いつくことが目標です。

【今回のカテゴリ指定】以下のカテゴリから出題すること：
★ %s ★

【重要ルール】答えが1〜3個に収束する、具体的だが一般的なお題を作ること。

【お題の作り方】：
1. 指定されたカテゴリから1つ選ぶ
2. 「定番」「有名」「代表的」「人気」などで限定する
3. 誰もが知ってる一般的な範囲に収める
4. 固有名詞を指定する場合は明確に1人/1つに絞る

【良いお題の例】：
- 回転寿司の人気ネタといえば？
- ドラえもんの道具の定番といえば？
- 小学校の給食の定番メニューといえば？
- 日本一有名なお城といえば？

【NGな例】：
- 抽象的すぎる（春といえば？）
- 二段階限定（有名アーティストの代表曲）
- 答えが発散する（好きな食べ物は？）%s

【出力形式】お題のみを1行ずつ出力。答えの例や説明は絶対に含めないこと。`, categoriesText, usedTopicsText)

		// OpenAI APIリクエストを構築（常に5個リクエスト）
		reqBody := OpenAIRequest{
			Model: "gpt-4o-mini",
			Messages: []OpenAIMessage{
				{Role: "system", Content: systemPrompt},
				{Role: "user", Content: fmt.Sprintf("【%s】のカテゴリから、お題を5個生成してください。お題のみを出力し、答えの例は含めないでください。", categoriesText)},
			},
			Temperature: 1.0,
			MaxTokens:   400,
		}

		// APIを呼び出してお題を取得
		topics, err := callOpenAI(reqBody)
		if err != nil {
			return nil, err
		}

		// お題をクリーンアップして重複チェック
		for _, topic := range topics {
			cleaned := cleanTopic(topic)
			if cleaned == "" {
				continue
			}

			// 重複チェック（使用済みお題）
			if usedTopicsMap[cleaned] {
				continue // 使用済みなのでスキップ
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

			// 重複なし、追加（5個以上でもOK）
			resultTopics = append(resultTopics, cleaned)
		}
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

// selectRandomCategories - カテゴリプールからランダムにn個選択
func selectRandomCategories(n int) []string {
	// カテゴリプールをシャッフル
	shuffled := make([]string, len(categoryPool))
	copy(shuffled, categoryPool)
	rand.Shuffle(len(shuffled), func(i, j int) {
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	})

	// 先頭からn個を返す
	if n > len(shuffled) {
		n = len(shuffled)
	}
	return shuffled[:n]
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
