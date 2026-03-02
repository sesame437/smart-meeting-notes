<template>
  <div class="meeting-view">
    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="meeting" class="meeting-content">
      <!-- Header -->
      <div class="header">
        <button @click="goBack" class="btn-back">← 返回</button>
        <h1>{{ meeting.title || '未命名会议' }}</h1>
        <span :class="['status-badge', statusClass]">{{ statusText }}</span>
      </div>

      <!-- General sections (all types) -->
      <GeneralSection :report="report" :meeting-id="meeting.meetingId" :meeting-type="meetingType" />

      <!-- Weekly sections -->
      <WeeklySection v-if="meetingType === 'weekly'" :report="report" :meeting-id="meeting.meetingId" />

      <!-- Customer sections -->
      <CustomerSection v-if="meetingType === 'customer'" :report="report" />

      <!-- Action buttons -->
      <div class="actions">
        <button class="btn-primary">发送邮件</button>
        <button class="btn-secondary">重新生成</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMeetingStore } from '@/stores/meeting'
import GeneralSection from '@/components/meeting/GeneralSection.vue'
import CustomerSection from '@/components/meeting/CustomerSection.vue'
import WeeklySection from '@/components/meeting/WeeklySection.vue'

const route = useRoute()
const router = useRouter()
const store = useMeetingStore()

const meeting = computed(() => store.current)
const report = computed(() => store.report)
const loading = computed(() => store.loading)
const error = computed(() => store.error)
const meetingType = computed(() => meeting.value?.meetingType || 'general')

const statusClass = computed(() => {
  const status = meeting.value?.status || 'unknown'
  if (status === 'done') return 'status-done'
  if (['processing', 'reported', 'transcribed'].includes(status)) return 'status-progress'
  if (status === 'failed') return 'status-failed'
  return 'status-pending'
})

const statusText = computed(() => {
  const statusMap = {
    pending: '待处理', processing: '处理中', transcribed: '已转录',
    reported: '已生成', done: '已完成', failed: '失败'
  }
  return statusMap[meeting.value?.status] || meeting.value?.status || '未知'
})

function goBack() {
  router.push('/')
}

onMounted(async () => {
  await store.fetchMeeting(route.params.id)
})
</script>

<style scoped>
.meeting-view {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

.loading, .error {
  text-align: center;
  padding: 2rem;
}

.error {
  color: var(--color-danger);
}

.header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
}

.btn-back {
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
}

.btn-back:hover {
  background: #1f2937;
}

h1 {
  flex: 1;
  margin: 0;
  color: var(--color-orange);
  font-size: 1.5rem;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-done { background: rgba(46, 125, 50, 0.2); color: #2e7d32; }
.status-progress { background: rgba(255, 153, 0, 0.2); color: var(--color-orange); }
.status-failed { background: rgba(211, 47, 47, 0.2); color: #d32f2f; }
.status-pending { background: rgba(135, 149, 150, 0.2); color: var(--color-muted); }

.section {
  margin-bottom: 2rem;
}

.section h2 {
  color: var(--color-orange);
  font-size: 1.2rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.5rem;
}

.actions {
  display: flex;
  gap: 1rem;
  margin-top: 2rem;
}

.btn-primary {
  flex: 1;
  padding: 0.75rem;
  background: var(--color-orange);
  color: var(--color-bg);
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:hover {
  background: #e68a00;
}

.btn-secondary {
  flex: 1;
  padding: 0.75rem;
  background: var(--color-muted);
  color: var(--color-bg);
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-secondary:hover {
  background: #6e7d7e;
}
</style>
