# Commit, Push, and Report

完成以下步骤，不要跳过任何一步：

1. 运行 Full Gate：
   - npm run lint（确认 0 errors）
   - npm test（确认全绿，失败则先修复）

2. 如果有测试失败，先修复再继续，不要带红测试提交。

3. git add -A

4. git commit -m "$(按照 type(scope): message 格式，根据本次改动自动生成 commit message)"

5. git push origin HEAD

6. 输出总结：
   - 本次改动的文件列表
   - commit hash
   - 测试通过数量
   - 如有新的经验教训，已写入 CLAUDE.md（如没有则说明无需更新）
