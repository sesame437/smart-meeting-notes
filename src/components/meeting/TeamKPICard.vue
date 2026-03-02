<template>
  <div class="team-kpi-card">
    <div class="kpi-overview">
      <p>{{ teamKPI?.overview || '暂无总体情况' }}</p>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-cards">
      <div class="stat-card stat-success" @click="toggleTable">
        <div class="stat-number">{{ onTrackCount }}</div>
        <div class="stat-label">按计划</div>
      </div>
      <div class="stat-card stat-warning" @click="toggleTable">
        <div class="stat-number">{{ atRiskCount }}</div>
        <div class="stat-label">有风险</div>
      </div>
      <div class="stat-card stat-done" @click="toggleTable">
        <div class="stat-number">{{ completedCount }}</div>
        <div class="stat-label">已完成</div>
      </div>
    </div>

    <!-- Individuals 表格（折叠） -->
    <div v-if="showTable && hasIndividuals" class="kpi-table">
      <table>
        <thead>
          <tr>
            <th>成员</th>
            <th>KPI 要点</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(ind, i) in teamKPI.individuals" :key="i">
            <td>{{ ind.name }}</td>
            <td>{{ ind.kpi }}</td>
            <td>
              <span :class="['status-badge', getStatusClass(ind.status)]">
                {{ getStatusText(ind.status) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  teamKPI: {
    type: Object,
    default: () => ({})
  }
})

const showTable = ref(false)

const hasIndividuals = computed(() => {
  return props.teamKPI?.individuals && props.teamKPI.individuals.length > 0
})

const onTrackCount = computed(() => {
  if (!hasIndividuals.value) return 0
  return props.teamKPI.individuals.filter(ind => ind.status === 'on-track').length
})

const atRiskCount = computed(() => {
  if (!hasIndividuals.value) return 0
  return props.teamKPI.individuals.filter(ind => ind.status === 'at-risk').length
})

const completedCount = computed(() => {
  if (!hasIndividuals.value) return 0
  return props.teamKPI.individuals.filter(ind => ind.status === 'completed').length
})

function toggleTable() {
  if (hasIndividuals.value) {
    showTable.value = !showTable.value
  }
}

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
.team-kpi-card { margin-bottom: 2rem; }
.kpi-overview { padding: 1rem; background: var(--color-surface); border-radius: 4px; border: 1px solid var(--color-border); margin-bottom: 1rem; white-space: pre-wrap; }
.stats-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1rem; }
.stat-card { padding: 1.5rem 1rem; background: var(--color-surface); border-radius: 8px; border: 2px solid; text-align: center; cursor: pointer; transition: all 0.2s; }
.stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); }
.stat-success { border-color: #2e7d32; }
.stat-warning { border-color: var(--color-orange); }
.stat-done { border-color: #2e7d32; }
.stat-number { font-size: 2.5rem; font-weight: 700; color: var(--color-text); margin-bottom: 0.5rem; }
.stat-label { font-size: 0.875rem; color: var(--color-muted); font-weight: 500; }
.kpi-table { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; background: var(--color-surface); border-radius: 4px; overflow: hidden; }
thead { background: rgba(255, 153, 0, 0.1); }
th { padding: 0.75rem; text-align: left; color: var(--color-orange); font-weight: 600; font-size: 0.875rem; border-bottom: 2px solid var(--color-border); }
td { padding: 0.75rem; border-bottom: 1px solid var(--color-border); color: var(--color-text); font-size: 0.875rem; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: rgba(255, 153, 0, 0.05); }
.status-badge { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
.status-success { background: rgba(46, 125, 50, 0.2); color: #2e7d32; }
.status-warning { background: rgba(255, 153, 0, 0.2); color: var(--color-orange); }
.status-done { background: rgba(46, 125, 50, 0.2); color: #2e7d32; }
.status-pending { background: rgba(135, 149, 150, 0.2); color: var(--color-muted); }
</style>
