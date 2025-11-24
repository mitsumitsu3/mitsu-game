#!/bin/bash

# 認識合わせゲーム - フロントエンドデプロイスクリプト

set -e

# カラー出力
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# デプロイ設定の読み込み
if [ -f .deploy-config ]; then
  source .deploy-config
  echo -e "${GREEN}.deploy-config を読み込みました${NC}"
else
  echo -e "${RED}エラー: .deploy-config が見つかりません${NC}"
  echo -e "${BLUE}先に ./deploy-infra.sh を実行してください${NC}"
  exit 1
fi

# 設定確認
echo -e "${BLUE}=== デプロイ設定 ===${NC}"
echo "Bucket Name: $BUCKET_NAME"
echo "Distribution ID: $DISTRIBUTION_ID"
echo "Region: $AWS_REGION"
echo ""

# フロントエンドディレクトリに移動
cd ../front

# 依存関係のインストール確認
if [ ! -d "node_modules" ]; then
  echo -e "${BLUE}依存関係をインストール中...${NC}"
  npm install
fi

# ビルド
echo -e "${BLUE}フロントエンドをビルド中...${NC}"
npm run build

# S3にアップロード
echo -e "${BLUE}S3にアップロード中...${NC}"
aws s3 sync dist/ "s3://$BUCKET_NAME/" \
  --region "$AWS_REGION" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html"

# index.htmlは別途アップロード（短いキャッシュ）
aws s3 cp dist/index.html "s3://$BUCKET_NAME/index.html" \
  --region "$AWS_REGION" \
  --cache-control "public, max-age=0, must-revalidate"

# CloudFrontキャッシュの無効化
echo -e "${BLUE}CloudFrontキャッシュを無効化中...${NC}"
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

echo -e "${GREEN}キャッシュ無効化を開始しました (ID: $INVALIDATION_ID)${NC}"

# 無効化完了待機（オプション）
if [ "$WAIT_FOR_INVALIDATION" = "true" ]; then
  echo -e "${BLUE}キャッシュ無効化の完了を待機中...${NC}"
  aws cloudfront wait invalidation-completed \
    --distribution-id "$DISTRIBUTION_ID" \
    --id "$INVALIDATION_ID"
  echo -e "${GREEN}キャッシュ無効化が完了しました${NC}"
fi

# 完了メッセージ
echo ""
echo -e "${GREEN}=== デプロイ完了！ ===${NC}"
echo -e "${BLUE}Website URL: $WEBSITE_URL${NC}"
echo ""
echo "ブラウザで上記URLにアクセスしてください"
echo "※キャッシュ無効化には数分かかる場合があります"
