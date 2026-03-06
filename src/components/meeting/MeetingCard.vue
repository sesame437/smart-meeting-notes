<template>
  <div class="meeting-card" @click="handleClick">
    <div class="card-header">
      <h3 class="meeting-title">{{ displayTitle }}</h3>
      <span :class="['status-badge', statusClass]">{{ statusText }}</span>
    </div>
    <div class="card-meta">
      <span class="meeting-date">{{ formattedDate }}</span>
      <span :class="['meeting-type-tag', typeClass]">{{ typeText }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  meeting: {
    type: Object,
    required: true
  }
})

const router = useRouter()

// 显示标题：优先用 title，否则截断 meetingId
const displayTitle = computed(() => {
  if (props.meeting.title) return props.meeting.title
  if (props.meeting.meetingId) {
    return props.meeting.meetingId.substring(0, 8) + '...'
  }
  return '未命名会议'
})

// 格式化日期：YYYY-MM-DD HH:mm
const formattedDate = computed(() => {
  if (!props.meeting.createdAt) return '未知日期'
  const date = new Date(props.meeting.createdAt)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
})

// 状态 badge 样式
const statusClass = computed(() => {
  const status = props.meeting.status || 'unknown'
  if (status === 'done') return 'status-done'
  if (['processing', 'reported', 'transcribed'].includes(status)) return 'status-progress'
  if (status === 'failed') return 'status-failed'
  return 'status-pending'
})

// 状态文本
const statusText = computed(() => {
  const statusMap = {
    pending: '待处理',
    processing: '处理中',
    transcribed: '已转录',
    reported: '已生成',
    done: '已完成',
    failed: '失败'
  }
  return statusMap[props.meeting.status] || props.meeting.status || '未知'
})

// 会议类型样式
const typeClass = computed(() => {
  const type = props.meeting.meetingType || 'general'
  return `type-${type}`
})

// 会议类型文本
const typeText = computed(() => {
  const typeMap = {
    general: '通用',
    weekly: '周会',
    tech: '技术',
    customer: '客户',
    merged: '合并'
  }
  return typeMap[props.meeting.meetingType] || props.meeting.meetingType || '通用'
})

// 点击跳转
function handleClick() {
  if (props.meeting.meetingId) {
    router.push(`/meetings/${props.meeting.meetingId}`)
  }
}
</script>
<style scoped>
.meeting-card {
  background: #ffffff;
  border-radius: 8px;
  padding: 16px;
  border-bottom: 1px solid #e8edf2;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;
}

.meeting-card:hover {
  background: #fafafa;
  border-left-color: var(--color-orange);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.meeting-title {
  color: var(--color-text);
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
  flex: 1;
  word-break: break-word;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.status-done {
  background: rgba(46, 125, 50, 0.2);
  color: #2e7d32;
}

.status-progress {
  background: rgba(255, 153, 0, 0.2);
  color: var(--color-orange);
}

.status-failed {
  background: rgba(211, 47, 47, 0.2);
  color: #d32f2f;
}

.status-pending {
  background: rgba(135, 149, 150, 0.2);
  color: var(--color-muted);
}

.card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.meeting-date {
  color: var(--color-muted);
  font-size: 0.875rem;
}

.meeting-type-tag {
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.type-general {
  background: rgba(100, 149, 237, 0.2);
  color: #6495ed;
}

.type-weekly {
  background: rgba(138, 43, 226, 0.2);
  color: #8a2be2;
}

.type-tech {
  background: rgba(34, 139, 34, 0.2);
  color: #228b22;
}

.type-customer {
  background: rgba(255, 140, 0, 0.2);
  color: #ff8c00;
}

.type-merged {
  background: rgba(70, 130, 180, 0.2);
  color: #4682b4;
}
</style>
