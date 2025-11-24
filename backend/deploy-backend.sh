#!/bin/bash

# 認識合わせゲーム - バックエンドデプロイスクリプト

set -e

# カラー出力
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# デフォルト値
STACK_NAME="${STACK_NAME:-mitsu-game-backend-stack}"
PROJECT_NAME="${PROJECT_NAME:-mitsu-game}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"
S3_BUCKET="${S3_BUCKET:-mitsu-game-deploy-${AWS_REGION}}"

# OpenAI API Keyの確認
if [ -z "$OPENAI_API_KEY" ]; then
  echo -e "${RED}エラー: OPENAI_API_KEY 環境変数が設定されていません${NC}"
  echo "export OPENAI_API_KEY='your-api-key-here' を実行してから再度デプロイしてください"
  exit 1
fi

echo -e "${BLUE}=== バックエンドのデプロイ ===${NC}"
echo "Stack Name: $STACK_NAME"
echo "Project Name: $PROJECT_NAME"
echo "Region: $AWS_REGION"
echo "S3 Bucket: $S3_BUCKET"
echo "OpenAI API Key: ${OPENAI_API_KEY:0:10}..." # 最初の10文字だけ表示
echo ""

# S3バケットの作成（存在しない場合）
echo -e "${BLUE}デプロイ用S3バケットを確認中...${NC}"
if ! aws s3 ls "s3://$S3_BUCKET" 2>/dev/null; then
  echo -e "${BLUE}S3バケットを作成中...${NC}"
  aws s3 mb "s3://$S3_BUCKET" --region "$AWS_REGION"
else
  echo -e "${GREEN}S3バケットは既に存在します${NC}"
fi

# Lambda関数の依存関係をインストール
echo -e "${BLUE}Lambda関数の依存関係をインストール中...${NC}"
cd lambda
npm install --production
cd ..

# Lambda関数をZIPに圧縮
echo -e "${BLUE}Lambda関数をZIP化中...${NC}"
cd lambda
zip -r ../lambda-function.zip . -x "*.git*" "*.DS_Store"
cd ..

# Lambda ZIPをS3にアップロード
echo -e "${BLUE}Lambda関数をS3にアップロード中...${NC}"
aws s3 cp lambda-function.zip "s3://$S3_BUCKET/lambda-function.zip"

# GraphQLスキーマをS3にアップロード
echo -e "${BLUE}GraphQLスキーマをS3にアップロード中...${NC}"
aws s3 cp schema/schema.graphql "s3://$S3_BUCKET/schema.graphql"

# CloudFormationスタックのデプロイ
echo -e "${BLUE}CloudFormationスタックをデプロイ中...${NC}"
aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name "$STACK_NAME" \
  --parameter-overrides \
    ProjectName="$PROJECT_NAME" \
    DeployBucket="$S3_BUCKET" \
    OpenAIApiKey="$OPENAI_API_KEY" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$AWS_REGION" \
  --no-fail-on-empty-changeset

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
GRAPHQL_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`GraphQLApiEndpoint`].OutputValue' \
  --output text)

API_KEY=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiKey`].OutputValue' \
  --output text)

# .backend-config ファイルを作成
cat > .backend-config << EOF
# バックエンド設定ファイル（フロントエンドで使用）
export GRAPHQL_ENDPOINT="$GRAPHQL_ENDPOINT"
export API_KEY="$API_KEY"
export AWS_REGION="$AWS_REGION"
EOF

# フロントエンド用の.env設定を出力
cat > ../front/.env.backend << EOF
VITE_GRAPHQL_ENDPOINT=$GRAPHQL_ENDPOINT
VITE_API_KEY=$API_KEY
VITE_AWS_REGION=$AWS_REGION
EOF

# 一時ファイルを削除
rm -f lambda-function.zip

echo ""
echo -e "${GREEN}バックエンド設定ファイル .backend-config を作成しました${NC}"
echo -e "${GREEN}フロントエンド用設定 ../front/.env.backend を作成しました${NC}"
echo -e "${BLUE}次のステップ: フロントエンドの.envに設定を追加してください${NC}"
