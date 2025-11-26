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
