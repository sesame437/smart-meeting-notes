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

      <!-- Summary (all types) -->
      <section class="section">
        <h2>会议摘要</h2>
        <div class="static-content">{{ report.summary || '暂无摘要' }}</div>
      </section>

      <!-- Participants (all types) -->
      <section class="section">
        <h2>参会人员</h2>
        <div class="participants">
          <span v-for="(p, i) in report.participants" :key="i" class="participant-tag">{{ p }}</span>
          <span v-if="!report.participants || report.participants.length === 0" class="muted">暂无参会人员</span>
        </div>
      </section>

      <!-- Highlights (all types) -->
      <section class="section">
        <h2>亮点</h2>
        <EditableList
          :items="report.highlights || []"
          :fields="[{ key: 'point', label: '标题', type: 'text' }, { key: 'detail', label: '详情', type: 'textarea' }]"
          section="highlights"
          :meeting-id="meeting.meetingId"
          empty-text="暂无亮点"
          add-label="+ 添加亮点"
        />
      </section>

      <!-- Lowlights (all types) -->
      <section class="section">
        <h2>问题</h2>
        <EditableList
          :items="report.lowlights || []"
          :fields="[{ key: 'point', label: '标题', type: 'text' }, { key: 'detail', label: '详情', type: 'textarea' }]"
          section="lowlights"
          :meeting-id="meeting.meetingId"
          empty-text="暂无问题"
          add-label="+ 添加问题"
        />
      </section>

      <!-- Actions (all types) -->
      <section class="section">
        <h2>行动项</h2>
        <EditableList
          :items="report.actions || []"
          :fields="[
            { key: 'task', label: '任务', type: 'text' },
            { key: 'owner', label: '负责人', type: 'text' },
            { key: 'deadline', label: '截止日期', type: 'text' },
            { key: 'priority', label: '优先级', type: 'text' }
          ]"
          section="actions"
          :meeting-id="meeting.meetingId"
          empty-text="暂无行动项"
          add-label="+ 添加行动项"
        />
      </section>

      <!-- Decisions (all types) -->
      <section class="section">
        <h2>决策</h2>
        <EditableList
          :items="report.decisions || []"
          :fields="[{ key: 'decision', label: '决策', type: 'text' }, { key: 'rationale', label: '原因', type: 'textarea' }]"
          section="decisions"
          :meeting-id="meeting.meetingId"
          empty-text="暂无决策"
          add-label="+ 添加决策"
        />
      </section>

      <!-- Topics (tech/general only) -->
      <section v-if="meetingType === 'tech' || meetingType === 'general'" class="section">
        <h2>议题</h2>
        <EditableList
          :items="report.topics || []"
          :fields="[
            { key: 'topic', label: '议题', type: 'text' },
            { key: 'discussion', label: '讨论要点', type: 'textarea' },
            { key: 'conclusion', label: '结论', type: 'textarea' }
          ]"
          section="topics"
          :meeting-id="meeting.meetingId"
          empty-text="暂无议题"
          add-label="+ 添加议题"
        />
      </section>

      <!-- Customer sections (read-only) -->
      <template v-if="meetingType === 'customer'">
        <section class="section">
          <h2>客户信息</h2>
          <div class="static-content">
            <p><strong>公司:</strong> {{ report.customerInfo?.company || '-' }}</p>
            <p><strong>客户参会人:</strong> {{ (report.customerInfo?.attendees || []).join(', ') || '-' }}</p>
            <p><strong>AWS参会人:</strong> {{ (report.awsAttendees || []).join(', ') || '-' }}</p>
          </div>
        </section>

        <section class="section">
          <h2>客户需求</h2>
          <div v-for="(need, i) in report.customerNeeds" :key="i" class="static-item">
            <p><strong>需求:</strong> {{ need.need }}</p>
            <p><strong>优先级:</strong> {{ need.priority }}</p>
            <p v-if="need.background"><strong>背景:</strong> {{ need.background }}</p>
          </div>
          <div v-if="!report.customerNeeds || report.customerNeeds.length === 0" class="muted">暂无客户需求</div>
        </section>

        <section class="section">
          <h2>痛点</h2>
          <div v-for="(pain, i) in report.painPoints" :key="i" class="static-item">
            <p><strong>{{ pain.point }}:</strong> {{ pain.detail }}</p>
          </div>
          <div v-if="!report.painPoints || report.painPoints.length === 0" class="muted">暂无痛点</div>
        </section>

        <section class="section">
          <h2>解决方案</h2>
          <div v-for="(sol, i) in report.solutionsDiscussed" :key="i" class="static-item">
            <p><strong>方案:</strong> {{ sol.solution }}</p>
            <p><strong>AWS服务:</strong> {{ (sol.awsServices || []).join(', ') }}</p>
            <p v-if="sol.customerFeedback"><strong>客户反馈:</strong> {{ sol.customerFeedback }}</p>
          </div>
          <div v-if="!report.solutionsDiscussed || report.solutionsDiscussed.length === 0" class="muted">暂无解决方案</div>
        </section>

        <section class="section">
          <h2>承诺</h2>
          <div v-for="(commit, i) in report.commitments" :key="i" class="static-item">
            <p><strong>{{ commit.party }}:</strong> {{ commit.commitment }}</p>
            <p><strong>负责人:</strong> {{ commit.owner }} | <strong>截止:</strong> {{ commit.deadline }}</p>
          </div>
          <div v-if="!report.commitments || report.commitments.length === 0" class="muted">暂无承诺</div>
        </section>

        <section class="section">
          <h2>后续步骤</h2>
          <div v-for="(step, i) in report.nextSteps" :key="i" class="static-item">
            <p><strong>{{ step.task }}</strong> ({{ step.priority }})</p>
            <p><strong>负责人:</strong> {{ step.owner }} | <strong>截止:</strong> {{ step.deadline }}</p>
          </div>
          <div v-if="!report.nextSteps || report.nextSteps.length === 0" class="muted">暂无后续步骤</div>
        </section>
      </template>

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
import EditableList from '@/components/common/EditableList.vue'

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

.static-content {
  padding: 1rem;
  background: var(--color-surface);
  border-radius: 4px;
  border: 1px solid var(--color-border);
  white-space: pre-wrap;
}

.static-content p {
  margin: 0.5rem 0;
}

.participants {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.participant-tag {
  padding: 4px 12px;
  background: rgba(255, 153, 0, 0.2);
  color: var(--color-orange);
  border-radius: 12px;
  font-size: 0.875rem;
}

.static-item {
  padding: 1rem;
  background: var(--color-surface);
  border-radius: 4px;
  border: 1px solid var(--color-border);
  margin-bottom: 0.5rem;
}

.static-item p {
  margin: 0.25rem 0;
}

.muted {
  color: var(--color-muted);
  font-style: italic;
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
