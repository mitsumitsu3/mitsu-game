#!/bin/bash

# 認識合わせゲーム - インフラデプロイスクリプト

set -e

# カラー出力
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# デフォルト値
STACK_NAME="${STACK_NAME:-mitsu-game-stack}"
PROJECT_NAME="${PROJECT_NAME:-mitsu-game}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"

echo -e "${BLUE}=== CloudFormationスタックのデプロイ ===${NC}"
echo "Stack Name: $STACK_NAME"
echo "Project Name: $PROJECT_NAME"
echo "Region: $AWS_REGION"
echo ""

# CloudFormationスタックのデプロイ
echo -e "${BLUE}CloudFormationスタックをデプロイ中...${NC}"
aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name "$STACK_NAME" \
  --parameter-overrides ProjectName="$PROJECT_NAME" \
  --region "$AWS_REGION" \
  --no-fail-on-empty-changeset \
  --tags Project="$PROJECT_NAME"

# デプロイ完了待機
echo -e "${BLUE}スタックの作成完了を待機中...${NC}"
aws cloudformation wait stack-create-complete \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" 2>/dev/null || \
aws cloudformation wait stack-update-complete \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" 2>/dev/null || true

# スタック出力の取得
echo -e "${GREEN}デプロイ完了！${NC}"
echo ""
echo -e "${BLUE}=== スタック情報 ===${NC}"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

# 環境変数ファイルの作成
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`WebsiteBucketName`].OutputValue' \
  --output text)

DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
  --output text)

WEBSITE_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`WebsiteURL`].OutputValue' \
  --output text)

# .deploy-config ファイルを作成
cat > .deploy-config << EOF
# デプロイ設定ファイル（deploy-frontend.sh で使用）
export STACK_NAME="$STACK_NAME"
export BUCKET_NAME="$BUCKET_NAME"
export DISTRIBUTION_ID="$DISTRIBUTION_ID"
export WEBSITE_URL="$WEBSITE_URL"
export AWS_REGION="$AWS_REGION"
EOF

echo ""
echo -e "${GREEN}デプロイ設定ファイル .deploy-config を作成しました${NC}"
echo -e "${BLUE}次のステップ: ./deploy-frontend.sh を実行してフロントエンドをデプロイしてください${NC}"
