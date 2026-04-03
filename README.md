![Smart Meeting Notes — One Recording. Full Clarity.](assets/readme-header.png)

# Smart Meeting Notes

[English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

AI-powered meeting minutes: upload audio, get structured reports with action items, decisions, and speaker attribution.

Upload a recording of any meeting and Smart Meeting Notes will automatically transcribe it with speaker labels, generate a structured AI report, and deliver polished meeting minutes to your inbox -- no manual note-taking required.

### Features

- **Multi-format audio upload** -- MP4, MP3, M4A, OGG, and WAV with drag-and-drop support
- **GPU-accelerated transcription** -- FunASR with CAM++ speaker diarization
- **AI report generation** -- Amazon Bedrock Claude extracts summary, action items, decisions, highlights, and risks
- **Multiple meeting templates** -- General, Weekly Standup, Tech Review, and Customer Meeting, each with tailored report sections
- **Chunked weekly generation** -- 3-phase report generation for weekly meetings to avoid token-repetition hallucination
- **Meeting merge** -- combine 2-10 meetings into a single consolidated report
- **Auto-naming** -- Claude Haiku generates semantic meeting titles from transcript content
- **Speaker mapping** -- rename raw speaker labels (SPEAKER_0 -> John) and regenerate reports with real names
- **Glossary management** -- maintain domain terms and contact names to improve transcription accuracy and report quality
- **Inline report editing** -- modify any section directly in the browser, with edit/delete/add for all meeting types
- **Email delivery** -- HTML-formatted meeting minutes via Amazon SES
- **GPU auto-hibernate** -- FunASR EC2 instance auto-stops after 30 minutes idle to reduce costs
- **Mobile responsive UI** -- Cloudscape-inspired design that works on desktop and mobile

### Architecture

```
Browser (HTML / CSS / JS)
    |
    v
Express API (port 3300)
    |
    +---> S3 (audio files, transcripts, reports)
    +---> DynamoDB (meeting metadata, glossary)
    +---> SQS (3 queues: transcription, report, export)
    |
Workers (3 independent Node.js processes)
    |
    +---> Transcription Worker ---> FunASR (GPU EC2)
    +---> Report Worker ---------> Amazon Bedrock Claude
    +---> Export Worker ----------> Amazon SES
```

**Data flow:**

1. User uploads audio. File goes to S3, metadata to DynamoDB, job message to SQS.
2. Transcription worker picks up the job, sends audio to FunASR, stores the transcript in S3.
3. Report worker reads the transcript and glossary, calls Bedrock Claude, stores the structured report in S3 and DynamoDB.
4. User views and edits the report in the browser. Speaker names can be remapped and the report regenerated.
5. Export worker renders the report as HTML and sends it via SES.

**Status flow:** `pending -> processing -> transcribed -> reported -> done` (any step can transition to `failed`).

### Tech Stack

| Layer          | Technology                                                     |
| -------------- | -------------------------------------------------------------- |
| Frontend       | HTML / CSS / JavaScript (Cloudscape design style)              |
| Backend        | Node.js + Express (CommonJS)                                   |
| AI             | Amazon Bedrock (Claude for reports, Haiku for naming)          |
| Transcription  | FunASR with CAM++ speaker diarization (GPU EC2)                |
| Database       | Amazon DynamoDB                                                |
| Storage        | Amazon S3                                                      |
| Queue          | Amazon SQS (3 queues)                                          |
| Email          | Amazon SES                                                     |
| Security       | Helmet CSP + CORS + Zod validation + rate limiting             |

### Quick Start

#### Prerequisites

- Node.js >= 18
- AWS account with CLI credentials configured
- AWS resources: S3 bucket, DynamoDB tables, SQS queues, SES verified domain

#### Option A: CloudFormation (Recommended)

```bash
# 1. Deploy AWS resources
aws cloudformation deploy \
  --template-file infrastructure/cloudformation.yaml \
  --stack-name smart-meeting-notes \
  --capabilities CAPABILITY_IAM

# 2. Get outputs
aws cloudformation describe-stacks \
  --stack-name smart-meeting-notes \
  --query 'Stacks[0].Outputs'

# 3. Configure
cp .env.example .env
# Edit .env with values from CloudFormation outputs

# 4. Install and start
npm install
npm start

# 5. Start workers (each in a separate terminal)
npm run worker:transcription
npm run worker:report
npm run worker:export
```

#### Option B: Docker

```bash
cp .env.example .env
# Edit .env with your AWS configuration

docker compose up
```

Then visit **http://localhost:3300**.

### Configuration

Copy `.env.example` to `.env` and set the following variables:

| Variable                   | Description                                 | Example                                   |
| -------------------------- | ------------------------------------------- | ----------------------------------------- |
| `PORT`                     | Server port                                 | `3300`                                    |
| `API_KEY`                  | API key for authentication                  | `your-secret-api-key`                     |
| `AWS_REGION`               | AWS region for all services                 | `us-west-2`                               |
| `S3_BUCKET`                | S3 bucket name                              | `smart-meeting-notes-bucket`              |
| `S3_PREFIX`                | Key prefix inside the bucket                | `meeting-minutes/`                        |
| `DYNAMODB_TABLE`           | DynamoDB table for meetings                 | `smart-meeting-notes-meetings`            |
| `GLOSSARY_TABLE`           | DynamoDB table for glossary terms           | `smart-meeting-notes-glossary`            |
| `SQS_TRANSCRIPTION_QUEUE`  | SQS queue URL for transcription jobs        | `https://sqs.us-west-2.amazonaws.com/...` |
| `SQS_REPORT_QUEUE`         | SQS queue URL for report generation jobs    | `https://sqs.us-west-2.amazonaws.com/...` |
| `SQS_EXPORT_QUEUE`         | SQS queue URL for email export jobs         | `https://sqs.us-west-2.amazonaws.com/...` |
| `BEDROCK_MODEL_ID`         | Bedrock model for report generation         | `anthropic.claude-sonnet-4-20250514`      |
| `BEDROCK_HAIKU_MODEL_ID`   | Bedrock model for auto-naming               | `anthropic.claude-3-5-haiku-20241022`     |
| `FUNASR_URL`               | FunASR server URL                           | `http://172.31.27.101:9002`               |
| `FUNASR_INSTANCE_ID`       | EC2 instance ID for GPU auto-hibernate      | `i-0abcdef1234567890`                     |
| `SES_FROM_EMAIL`           | Verified SES sender email address           | `meetings@example.com`                    |
| `SES_REGION`               | SES region (must match verified identity)   | `us-west-2`                               |
| `NODE_ENV`                 | Environment                                 | `production`                              |

### Project Structure

```
smart-meeting-notes/
├── server.js                     # Express entry point
├── routes/
│   ├── meetings/                 # Meeting endpoints
│   │   ├── index.js              #   Router aggregator
│   │   ├── core.js               #   CRUD, upload, retry, auto-name
│   │   ├── report.js             #   Report generation, PATCH, speaker mapping, merge
│   │   ├── email.js              #   Email sending
│   │   └── helpers.js            #   Shared route utilities
│   └── glossary.js               # Glossary management
├── services/
│   ├── meeting-store.js          # DynamoDB meeting operations
│   ├── glossary-store.js         # DynamoDB glossary operations
│   ├── bedrock.js                # Bedrock Claude invocation + prompt templates
│   ├── report-builder.js         # Report construction logic
│   ├── report-chunked.js         # 3-phase chunked generation for weekly meetings
│   ├── report-speaker-normalizer.js  # Speaker name normalization
│   ├── report-post-processor.js  # Glossary + speaker post-processing
│   ├── s3.js                     # S3 file operations (auto Buffer encoding)
│   ├── sqs.js                    # SQS send / receive / delete
│   ├── ses.js                    # SES email sending
│   ├── gpu-autoscale.js          # FunASR EC2 auto-hibernate
│   ├── ffmpeg.js                 # Audio format conversion
│   └── logger.js                 # Centralized logger
├── workers/
│   ├── transcription-worker.js   # SQS -> FunASR -> S3
│   ├── report-worker.js          # SQS -> Bedrock Claude -> S3 + DynamoDB
│   └── export-worker.js          # SQS -> HTML render -> SES
├── public/                       # Frontend (static HTML / CSS / JS)
│   ├── index.html                # Meeting list page
│   ├── meeting.html              # Meeting detail page
│   ├── glossary.html             # Glossary management page
│   ├── js/app.js                 # Frontend application logic
│   └── css/style.css             # Cloudscape-style theme
├── infrastructure/               # CloudFormation templates
├── tests/                        # Jest unit tests (550+)
├── e2e/                          # Playwright E2E tests
└── scripts/                      # CLI utilities
```

### API Reference

All endpoints require the `x-api-key` header unless noted otherwise.

#### Meetings

| Method   | Endpoint                                | Description                        |
| -------- | --------------------------------------- | ---------------------------------- |
| `GET`    | `/api/meetings`                         | List meetings (paginated)          |
| `GET`    | `/api/meetings/:id`                     | Get meeting by ID                  |
| `POST`   | `/api/meetings/upload`                  | Upload audio file                  |
| `DELETE` | `/api/meetings/:id`                     | Delete a meeting                   |
| `POST`   | `/api/meetings/:id/regenerate`          | Regenerate report                  |
| `POST`   | `/api/meetings/:id/auto-name`           | Auto-generate meeting title        |
| `PATCH`  | `/api/meetings/:id/report`              | Update a report section            |
| `PUT`    | `/api/meetings/:id/speaker-names`       | Update speaker name mappings       |
| `POST`   | `/api/meetings/:id/email`              | Send meeting minutes via email     |
| `POST`   | `/api/meetings/merge`                   | Merge multiple meetings            |

#### Glossary

| Method   | Endpoint                                | Description                        |
| -------- | --------------------------------------- | ---------------------------------- |
| `GET`    | `/api/glossary`                         | List glossary terms                |
| `POST`   | `/api/glossary`                         | Add a glossary term                |
| `PUT`    | `/api/glossary/:id`                     | Update a glossary term             |
| `DELETE` | `/api/glossary/:id`                     | Delete a glossary term             |

#### System

| Method   | Endpoint                                | Description                        |
| -------- | --------------------------------------- | ---------------------------------- |
| `GET`    | `/health`                               | Health check                       |

Error responses follow a consistent format:

```json
{ "error": { "code": "MEETING_NOT_FOUND", "message": "Meeting does not exist" } }
```

### Development

```bash
# Install dependencies
npm install

# Run unit tests (550+ tests)
npm test

# Run linter
npm run lint

# Run E2E tests (requires a running server)
npm start &
npx playwright test e2e/

# Run a single test file
npx jest tests/meeting-store.test.js
```

Each worker runs as an independent process and polls its SQS queue:

```bash
npm run worker:transcription   # Terminal 1
npm run worker:report          # Terminal 2
npm run worker:export          # Terminal 3
```

### Contributing

Contributions are welcome. To get started:

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature`.
3. Make your changes and add tests.
4. Run the full test suite: `npm test && npm run lint`.
5. Commit with a clear message: `git commit -m "feat(scope): description"`.
6. Push and open a pull request against `main`.

Please follow the existing code style: ESLint + Prettier (single quotes, no semicolons, 100-char line width). All API input must be validated with Zod schemas. Use the centralized logger (`services/logger.js`) -- never `console.log` in production code.

### License

Apache License 2.0. See the [LICENSE](LICENSE) file for details.

---

<a id="中文"></a>

## 中文

AI 驱动的会议纪要系统：上传录音，自动生成结构化报告，包含行动项、决策和说话人识别。

上传任意会议录音，Smart Meeting Notes 会自动进行带说话人标签的语音转录，生成结构化 AI 报告，并将精美的会议纪要发送到你的邮箱——无需手动记录。

### 功能特性

- **多格式音频上传** — 支持 MP4、MP3、M4A、OGG、WAV，拖拽上传
- **GPU 加速转录** — FunASR + CAM++ 说话人分离
- **AI 报告生成** — Amazon Bedrock Claude 提取摘要、行动项、决策、亮点和风险
- **多种会议模板** — 通用会议、周会、技术讨论、客户会议，各有专属报告结构
- **周会分段生成** — 3 阶段分块生成，避免长文本 token 重复幻觉
- **会议合并** — 2-10 场会议合并为一份综合报告
- **自动命名** — Claude Haiku 根据转录内容生成语义化会议标题
- **说话人映射** — 将原始标签（SPEAKER_0）映射为真实姓名，并可重新生成报告
- **词库管理** — 维护专有名词和联系人姓名，提升转录准确性和报告质量
- **行内编辑** — 在浏览器中直接修改任意报告章节，所有会议类型均支持编辑/删除/添加
- **邮件发送** — 通过 Amazon SES 发送 HTML 格式的会议纪要
- **GPU 自动休眠** — FunASR EC2 实例空闲 30 分钟后自动停止，降低成本
- **移动端适配** — Cloudscape 风格设计，桌面端和移动端均可使用

### 系统架构

```
浏览器 (HTML / CSS / JS)
    |
    v
Express API (端口 3300)
    |
    +---> S3 (音频文件、转录文本、报告)
    +---> DynamoDB (会议元数据、词库)
    +---> SQS (3 个队列: 转录、报告、导出)
    |
Workers (3 个独立 Node.js 进程)
    |
    +---> 转录 Worker ---> FunASR (GPU EC2)
    +---> 报告 Worker ---> Amazon Bedrock Claude
    +---> 导出 Worker ---> Amazon SES
```

**数据流：**

1. 用户上传音频。文件存入 S3，元数据写入 DynamoDB，任务消息发送到 SQS。
2. 转录 Worker 获取任务，将音频发送到 FunASR，转录结果存入 S3。
3. 报告 Worker 读取转录文本和词库，调用 Bedrock Claude，将结构化报告存入 S3 和 DynamoDB。
4. 用户在浏览器中查看和编辑报告。可以重新映射说话人姓名并重新生成报告。
5. 导出 Worker 将报告渲染为 HTML 并通过 SES 发送。

**状态流转：** `pending -> processing -> transcribed -> reported -> done`（任一步骤可转为 `failed`）。

### 技术栈

| 层级     | 技术                                                           |
| -------- | -------------------------------------------------------------- |
| 前端     | HTML / CSS / JavaScript（Cloudscape 设计风格）                  |
| 后端     | Node.js + Express (CommonJS)                                   |
| AI       | Amazon Bedrock（Claude 生成报告，Haiku 自动命名）               |
| 转录     | FunASR + CAM++ 说话人分离（GPU EC2）                            |
| 数据库   | Amazon DynamoDB                                                |
| 存储     | Amazon S3                                                      |
| 队列     | Amazon SQS（3 个队列）                                          |
| 邮件     | Amazon SES                                                     |
| 安全     | Helmet CSP + CORS + Zod 校验 + 速率限制                         |

### 快速开始

#### 前置条件

- Node.js >= 18
- 已配置 CLI 凭证的 AWS 账号
- AWS 资源：S3 存储桶、DynamoDB 表、SQS 队列、SES 已验证域名

#### 方式 A：CloudFormation（推荐）

```bash
# 1. 部署 AWS 资源
aws cloudformation deploy \
  --template-file infrastructure/cloudformation.yaml \
  --stack-name smart-meeting-notes \
  --capabilities CAPABILITY_IAM

# 2. 获取输出
aws cloudformation describe-stacks \
  --stack-name smart-meeting-notes \
  --query 'Stacks[0].Outputs'

# 3. 配置
cp .env.example .env
# 用 CloudFormation 输出的值编辑 .env

# 4. 安装并启动
npm install
npm start

# 5. 启动 Worker（每个在单独终端中）
npm run worker:transcription
npm run worker:report
npm run worker:export
```

#### 方式 B：Docker

```bash
cp .env.example .env
# 用你的 AWS 配置编辑 .env

docker compose up
```

然后访问 **http://localhost:3300**。

### 配置说明

将 `.env.example` 复制为 `.env` 并设置以下变量：

| 变量                        | 说明                                    | 示例                                      |
| -------------------------- | --------------------------------------- | ----------------------------------------- |
| `PORT`                     | 服务端口                                 | `3300`                                    |
| `API_KEY`                  | API 认证密钥                             | `your-secret-api-key`                     |
| `AWS_REGION`               | 所有服务的 AWS 区域                       | `us-west-2`                               |
| `S3_BUCKET`                | S3 存储桶名称                            | `smart-meeting-notes-bucket`              |
| `S3_PREFIX`                | 桶内 Key 前缀                            | `meeting-minutes/`                        |
| `DYNAMODB_TABLE`           | 会议 DynamoDB 表                         | `smart-meeting-notes-meetings`            |
| `GLOSSARY_TABLE`           | 词库 DynamoDB 表                         | `smart-meeting-notes-glossary`            |
| `SQS_TRANSCRIPTION_QUEUE`  | 转录任务 SQS 队列 URL                    | `https://sqs.us-west-2.amazonaws.com/...` |
| `SQS_REPORT_QUEUE`         | 报告生成 SQS 队列 URL                    | `https://sqs.us-west-2.amazonaws.com/...` |
| `SQS_EXPORT_QUEUE`         | 邮件导出 SQS 队列 URL                    | `https://sqs.us-west-2.amazonaws.com/...` |
| `BEDROCK_MODEL_ID`         | 报告生成 Bedrock 模型                     | `anthropic.claude-sonnet-4-20250514`      |
| `BEDROCK_HAIKU_MODEL_ID`   | 自动命名 Bedrock 模型                     | `anthropic.claude-3-5-haiku-20241022`     |
| `FUNASR_URL`               | FunASR 服务地址                           | `http://172.31.27.101:9002`               |
| `FUNASR_INSTANCE_ID`       | GPU 自动休眠 EC2 实例 ID                  | `i-0abcdef1234567890`                     |
| `SES_FROM_EMAIL`           | SES 已验证发件人邮箱                      | `meetings@example.com`                    |
| `SES_REGION`               | SES 区域（须与已验证身份匹配）              | `us-west-2`                               |
| `NODE_ENV`                 | 运行环境                                 | `production`                              |

### API 参考

除特别说明外，所有接口需要 `x-api-key` 请求头。

#### 会议

| 方法      | 路径                                     | 说明                               |
| -------- | --------------------------------------- | ---------------------------------- |
| `GET`    | `/api/meetings`                         | 会议列表（分页）                     |
| `GET`    | `/api/meetings/:id`                     | 获取会议详情                         |
| `POST`   | `/api/meetings/upload`                  | 上传音频文件                         |
| `DELETE` | `/api/meetings/:id`                     | 删除会议                            |
| `POST`   | `/api/meetings/:id/regenerate`          | 重新生成报告                         |
| `POST`   | `/api/meetings/:id/auto-name`           | 自动生成会议标题                      |
| `PATCH`  | `/api/meetings/:id/report`              | 更新报告章节                         |
| `PUT`    | `/api/meetings/:id/speaker-names`       | 更新说话人姓名映射                    |
| `POST`   | `/api/meetings/:id/email`              | 发送会议纪要邮件                      |
| `POST`   | `/api/meetings/merge`                   | 合并多场会议                         |

#### 词库

| 方法      | 路径                                     | 说明                               |
| -------- | --------------------------------------- | ---------------------------------- |
| `GET`    | `/api/glossary`                         | 词库列表                            |
| `POST`   | `/api/glossary`                         | 添加词条                            |
| `PUT`    | `/api/glossary/:id`                     | 更新词条                            |
| `DELETE` | `/api/glossary/:id`                     | 删除词条                            |

#### 系统

| 方法      | 路径                                     | 说明                               |
| -------- | --------------------------------------- | ---------------------------------- |
| `GET`    | `/health`                               | 健康检查                            |

错误响应统一格式：

```json
{ "error": { "code": "MEETING_NOT_FOUND", "message": "会议不存在" } }
```

### 开发

```bash
# 安装依赖
npm install

# 运行单元测试（550+ 用例）
npm test

# 运行代码检查
npm run lint

# 运行 E2E 测试（需要先启动服务）
npm start &
npx playwright test e2e/

# 运行单个测试文件
npx jest tests/meeting-store.test.js
```

每个 Worker 作为独立进程运行，轮询各自的 SQS 队列：

```bash
npm run worker:transcription   # 终端 1
npm run worker:report          # 终端 2
npm run worker:export          # 终端 3
```

### 贡献指南

欢迎贡献代码。开始步骤：

1. Fork 本仓库。
2. 创建功能分支：`git checkout -b feature/your-feature`。
3. 编写代码并添加测试。
4. 运行完整测试套件：`npm test && npm run lint`。
5. 提交清晰的 commit 信息：`git commit -m "feat(scope): description"`。
6. 推送并向 `main` 分支发起 Pull Request。

请遵循现有代码风格：ESLint + Prettier（单引号、无分号、100 字符行宽）。所有 API 入参必须使用 Zod schema 校验。使用集中式 logger（`services/logger.js`）——生产代码禁止使用 `console.log`。

### 许可证

Apache License 2.0。详见 [LICENSE](LICENSE) 文件。
