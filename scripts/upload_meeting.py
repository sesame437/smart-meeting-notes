#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Meeting Minutes 上传脚本
用法：python3 upload_meeting.py <文件路径> [--title "会议标题"] [--type general|weekly]

功能：
1. 上传音频/视频文件到 S3
2. 在 DynamoDB 创建会议记录
3. 推送 SQS 消息触发转录流水线

依赖：pip3 install boto3
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError
except ImportError:
    print("❌ 缺少依赖：请先运行 pip3 install boto3")
    sys.exit(1)

# --- 配置（与服务器 .env 保持一致）---
AWS_REGION          = os.environ.get("AWS_REGION", "us-west-2")
AWS_PROFILE         = os.environ.get("AWS_PROFILE", "default")
S3_BUCKET           = os.environ.get("S3_BUCKET", "")
S3_PREFIX           = os.environ.get("S3_PREFIX", "meeting-minutes")
DYNAMODB_TABLE      = os.environ.get("DYNAMODB_TABLE", "meeting-minutes-meetings")
SQS_QUEUE_URL       = os.environ.get("SQS_TRANSCRIPTION_QUEUE", "")

ALLOWED_EXTENSIONS  = {".mp3", ".mp4", ".m4a", ".wav", ".ogg", ".webm", ".mov", ".flac", ".aac"}
MAX_FILE_SIZE_GB    = 2
# -----------------------------------------------------------------------


def get_session():
    """获取 boto3 session，使用 default profile"""
    try:
        session = boto3.Session(profile_name=AWS_PROFILE, region_name=AWS_REGION)
        # 快速验证凭证
        sts = session.client("sts")
        identity = sts.get_caller_identity()
        print(f"✅ AWS 凭证有效 | Account: {identity['Account']} | ARN: {identity['Arn']}")
        return session
    except NoCredentialsError:
        print("❌ 未找到 AWS 凭证，请先运行 `aws configure`")
        sys.exit(1)
    except ClientError as e:
        print(f"❌ AWS 凭证验证失败: {e}")
        sys.exit(1)


def validate_file(filepath: Path):
    """校验文件"""
    if not filepath.exists():
        print(f"❌ 文件不存在: {filepath}")
        sys.exit(1)

    suffix = filepath.suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        print(f"❌ 不支持的文件格式: {suffix}")
        print(f"   支持格式: {', '.join(sorted(ALLOWED_EXTENSIONS))}")
        sys.exit(1)

    size_bytes = filepath.stat().st_size
    size_gb = size_bytes / (1024 ** 3)
    if size_gb > MAX_FILE_SIZE_GB:
        print(f"❌ 文件过大: {size_gb:.2f}GB（上限 {MAX_FILE_SIZE_GB}GB）")
        sys.exit(1)

    print(f"📁 文件: {filepath.name} ({size_bytes / (1024**2):.1f} MB)")
    return size_bytes


def upload_to_s3(session, filepath: Path, s3_key: str) -> str:
    """上传文件到 S3，显示进度"""
    s3 = session.client("s3")

    # 根据后缀推断 content type
    mime_map = {
        ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".m4a": "audio/mp4",
        ".wav": "audio/wav", ".ogg": "audio/ogg", ".webm": "audio/webm",
        ".mov": "video/quicktime", ".flac": "audio/flac", ".aac": "audio/aac",
    }
    content_type = mime_map.get(filepath.suffix.lower(), "application/octet-stream")

    file_size = filepath.stat().st_size
    uploaded = [0]

    def progress(chunk):
        uploaded[0] += chunk
        pct = uploaded[0] / file_size * 100
        bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
        print(f"\r   [{bar}] {pct:.1f}%", end="", flush=True)

    print(f"⬆️  上传到 S3: s3://{S3_BUCKET}/{s3_key}")
    with open(filepath, "rb") as f:
        s3.upload_fileobj(
            f, S3_BUCKET, s3_key,
            ExtraArgs={"ContentType": content_type},
            Callback=progress,
        )
    print()  # 换行
    print(f"✅ S3 上传完成")
    return s3_key


def create_dynamo_record(session, meeting_id: str, s3_key: str,
                          filename: str, title: str, meeting_type: str):
    """在 DynamoDB 创建会议记录"""
    dynamo = session.resource("dynamodb", region_name=AWS_REGION)
    table = dynamo.Table(DYNAMODB_TABLE)

    now = datetime.now(timezone.utc).isoformat()
    item = {
        "meetingId":   meeting_id,
        "title":       title,
        "status":      "pending",
        "s3Key":       s3_key,
        "filename":    filename,
        "meetingType": meeting_type,
        "createdAt":   now,
        "updatedAt":   now,
    }

    table.put_item(Item=item)
    print(f"✅ DynamoDB 记录已创建 | meetingId: {meeting_id}")
    return item


def send_sqs_message(session, meeting_id: str, s3_key: str,
                     filename: str, meeting_type: str):
    """推送 SQS 消息触发转录"""
    sqs = session.client("sqs")
    body = {
        "meetingId":   meeting_id,
        "s3Key":       s3_key,
        "filename":    filename,
        "meetingType": meeting_type,
    }
    sqs.send_message(
        QueueUrl=SQS_QUEUE_URL,
        MessageBody=json.dumps(body),
    )
    print(f"✅ SQS 消息已发送，转录任务已入队")


def main():
    parser = argparse.ArgumentParser(
        description="上传会议录音到 Meeting Minutes 系统",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  python3 upload_meeting.py ./recording.mp4
  python3 upload_meeting.py ./recording.mp4 --title "2月周会" --type weekly
  python3 upload_meeting.py ./recording.m4a --title "客户访谈"
        """
    )
    parser.add_argument("file", help="本地音频/视频文件路径")
    parser.add_argument("--title", help="会议标题（默认使用文件名）")
    parser.add_argument(
        "--type", dest="meeting_type",
        choices=["general", "weekly"], default="general",
        help="会议类型（默认: general）"
    )
    args = parser.parse_args()

    filepath = Path(args.file).expanduser().resolve()
    validate_file(filepath)

    filename   = filepath.name
    title      = args.title or filepath.stem  # 无后缀的文件名作为默认标题
    meeting_id = str(uuid.uuid4())
    s3_key     = f"{S3_PREFIX}/inbox/{meeting_id}/{filename}"

    print(f"\n🚀 开始上传")
    print(f"   会议ID:   {meeting_id}")
    print(f"   标题:     {title}")
    print(f"   类型:     {args.meeting_type}")
    print()

    session = get_session()

    # 1. 上传 S3
    upload_to_s3(session, filepath, s3_key)

    # 2. 写 DynamoDB
    create_dynamo_record(session, meeting_id, s3_key, filename, title, args.meeting_type)

    # 3. 推 SQS
    send_sqs_message(session, meeting_id, s3_key, filename, args.meeting_type)

    print(f"""
🎉 上传成功！

   会议ID:   {meeting_id}
   状态:     pending（转录中）
   查看进度: http://<服务器IP>:3300
""")


if __name__ == "__main__":
    main()
