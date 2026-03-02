<template>
  <div class="weekly-section">
    <!-- Team KPI -->
    <section v-if="report.teamKPI" class="section">
      <h2>团队 KPI</h2>
      <div class="kpi-overview">
        <p>{{ report.teamKPI.overview || '暂无总体情况' }}</p>
      </div>
      <div v-if="report.teamKPI.individuals && report.teamKPI.individuals.length > 0" class="kpi-table">
        <table>
          <thead>
            <tr>
              <th>成员</th>
              <th>KPI 要点</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(ind, i) in report.teamKPI.individuals" :key="i">
              <td>{{ ind.name }}</td>
              <td>{{ ind.kpi }}</td>
              <td><span :class="['status-badge', getStatusClass(ind.status)]">{{ getStatusText(ind.status) }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Announcements -->
    <section class="section">
      <h2>公告</h2>
      <EditableList
        :items="report.announcements || []"
        :fields="[
          { key: 'title', label: '标题', type: 'text' },
          { key: 'detail', label: '内容', type: 'textarea' },
          { key: 'owner', label: '发布人', type: 'text' }
        ]"
        section="announcements"
        :meeting-id="meetingId"
        empty-text="暂无公告"
        add-label="+ 添加公告"
      />
    </section>

    <!-- Project Reviews -->
    <section v-if="report.projectReviews && report.projectReviews.length > 0" class="section">
      <h2>项目进展</h2>
      <ProjectReview
        v-for="(review, index) in report.projectReviews"
        :key="index"
        :review="review"
        :index="index"
        :meeting-id="meetingId"
      />
    </section>

    <!-- Next Meeting -->
    <section v-if="report.nextMeeting" class="section">
      <h2>下次会议</h2>
      <div class="static-content">{{ report.nextMeeting }}</div>
    </section>
  </div>
</template>

<script setup>
import EditableList from '@/components/common/EditableList.vue'
import ProjectReview from '@/components/meeting/ProjectReview.vue'

defineProps({
  report: {
    type: Object,
    required: true
  },
  meetingId: {
    type: String,
    required: true
  }
})

function getStatusClass(status) {
  const map = {
    'on-track': 'status-success',
    'at-risk': 'status-warning',
    'completed': 'status-done'
  }
  return map[status] || 'status-pending'
}

function getStatusText(status) {
  const map = {
    'on-track': '按计划',
    'at-risk': '有风险',
    'completed': '已完成'
  }
  return map[status] || status
}
</script>
<style scoped>
.weekly-section {
  margin-top: 2rem;
}

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

.kpi-overview {
  padding: 1rem;
  background: var(--color-surface);
  border-radius: 4px;
  border: 1px solid var(--color-border);
  margin-bottom: 1rem;
  white-space: pre-wrap;
}

.kpi-table {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: var(--color-surface);
  border-radius: 4px;
  overflow: hidden;
}

thead {
  background: rgba(255, 153, 0, 0.1);
}

th {
  padding: 0.75rem;
  text-align: left;
  color: var(--color-orange);
  font-weight: 600;
  font-size: 0.875rem;
  border-bottom: 2px solid var(--color-border);
}

td {
  padding: 0.75rem;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
  font-size: 0.875rem;
}

tbody tr:last-child td {
  border-bottom: none;
}

tbody tr:hover {
  background: rgba(255, 153, 0, 0.05);
}

.status-badge {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-success {
  background: rgba(46, 125, 50, 0.2);
  color: #2e7d32;
}

.status-warning {
  background: rgba(255, 153, 0, 0.2);
  color: var(--color-orange);
}

.status-done {
  background: rgba(46, 125, 50, 0.2);
  color: #2e7d32;
}

.status-pending {
  background: rgba(135, 149, 150, 0.2);
  color: var(--color-muted);
}

.static-content {
  padding: 1rem;
  background: var(--color-surface);
  border-radius: 4px;
  border: 1px solid var(--color-border);
  white-space: pre-wrap;
}
</style>
