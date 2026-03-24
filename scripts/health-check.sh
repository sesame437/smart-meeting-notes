#!/bin/bash
# meeting-minutes health check
# cc 每次 session 开始运行，确认基础正常再动手

set -e

echo "===== meeting-minutes Health Check ====="

# 1. 服务检查
echo ""
echo "[1/3] 服务状态..."
if curl -s http://localhost:3300/api/health > /dev/null 2>&1; then
  STATUS=$(curl -s http://localhost:3300/api/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "ok")
  echo "✅ 服务正常 (port 3300, status=$STATUS)"
else
  echo "⚠️  服务未运行"
  echo "   启动方式: cd /home/qiankai/projects/meeting-minutes && node server.js &"
  echo "   或检查: pm2 start server.js --name meeting-minutes"
fi

# 2. Full Gate (lint + test)
echo ""
echo "[2/3] Full Gate..."

# lint
LINT_RESULT=$(npm run lint 2>&1 | grep "problems" | tail -1)
if echo "$LINT_RESULT" | grep -q " 0 errors"; then
  echo "✅ Lint: $LINT_RESULT"
else
  echo "⚠️  Lint: $LINT_RESULT"
fi

# test
TEST_RESULT=$(npm test -- --passWithNoTests 2>&1 | tail -3)
echo "$TEST_RESULT"
if echo "$TEST_RESULT" | grep -q "failed"; then
  echo "❌ 有测试失败！请先修复再开始新功能"
  exit 1
else
  echo "✅ Tests passed"
fi

# 3. 当前进度
echo ""
echo "[3/3] 当前进度..."
if [ -f "PROGRESS.md" ]; then
  head -20 PROGRESS.md
else
  echo "⚠️  PROGRESS.md 不存在，建议创建"
fi

echo ""
echo "===== Health Check 完成，可以开始工作 ====="
