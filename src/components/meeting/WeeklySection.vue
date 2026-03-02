<template>
  <div class="weekly-layout">
    <!-- 左侧导航 -->
    <WeeklySidebar :sections="sidebarSections" />

    <!-- 移动端顶部 Tab -->
    <div class="mobile-tabs">
      <a
        v-for="section in sidebarSections"
        :key="section.id"
        :href="`#${section.id}`"
        class="mobile-tab"
      >
        {{ section.label }}
      </a>
    </div>

    <!-- 内容区 -->
    <div class="weekly-content">
      <!-- Team KPI -->
      <section v-if="report.teamKPI" id="team-kpi" class="section">
        <h2>团队 KPI</h2>
        <TeamKPICard :team-k-p-i="report.teamKPI" />
      </section>

      <!-- Announcements -->
      <section id="announcements" class="section">
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
      <section v-if="report.projectReviews && report.projectReviews.length > 0" id="projects" class="section">
        <h2>项目进展</h2>
        <ProjectAccordion
          v-for="(review, index) in report.projectReviews"
          :key="index"
          :id="`project-${index}`"
          :review="review"
          :index="index"
          :meeting-id="meetingId"
        />
      </section>

      <!-- General Highlights -->
      <section id="highlights" class="section">
        <h2>整体亮点</h2>
        <EditableList
          :items="report.highlights || []"
          :fields="[
            { key: 'point', label: '标题', type: 'text' },
            { key: 'detail', label: '详情', type: 'textarea' }
          ]"
          section="highlights"
          :meeting-id="meetingId"
          empty-text="暂无亮点"
          add-label="+ 添加亮点"
        />
      </section>

      <!-- General Lowlights -->
      <section id="lowlights" class="section">
        <h2>整体问题</h2>
        <EditableList
          :items="report.lowlights || []"
          :fields="[
            { key: 'point', label: '标题', type: 'text' },
            { key: 'detail', label: '详情', type: 'textarea' }
          ]"
          section="lowlights"
          :meeting-id="meetingId"
          empty-text="暂无问题"
          add-label="+ 添加问题"
        />
      </section>

      <!-- Next Meeting -->
      <section v-if="report.nextMeeting" id="next-meeting" class="section">
        <h2>下次会议</h2>
        <div class="static-content">{{ report.nextMeeting }}</div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import EditableList from '@/components/common/EditableList.vue'
import TeamKPICard from './TeamKPICard.vue'
import ProjectAccordion from './ProjectAccordion.vue'
import WeeklySidebar from './WeeklySidebar.vue'

const props = defineProps({
  report: { type: Object, required: true },
  meetingId: { type: String, required: true }
})

const sidebarSections = computed(() => {
  const sections = []
  if (props.report.teamKPI) sections.push({ id: 'team-kpi', label: '团队 KPI', type: 'section' })
  sections.push({ id: 'announcements', label: '公告', type: 'section' })
  if (props.report.projectReviews?.length > 0) {
    props.report.projectReviews.forEach((review, index) => {
      sections.push({ id: `project-${index}`, label: review.project || `项目 ${index + 1}`, type: 'project', status: 'on-track' })
    })
  }
  sections.push({ id: 'highlights', label: '整体亮点', type: 'section' })
  sections.push({ id: 'lowlights', label: '整体问题', type: 'section' })
  if (props.report.nextMeeting) sections.push({ id: 'next-meeting', label: '下次会议', type: 'section' })
  return sections
})
</script>

<style scoped>
.weekly-layout { position: relative; margin-top: 2rem; }
.weekly-content { margin-left: 180px; }
.mobile-tabs { display: none; }
.section { margin-bottom: 2rem; }
.section h2 { color: var(--color-orange); font-size: 1.2rem; margin-bottom: 1rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.5rem; }
.static-content { padding: 1rem; background: var(--color-surface); border-radius: 4px; border: 1px solid var(--color-border); white-space: pre-wrap; }

@media (max-width: 767px) {
  .weekly-content { margin-left: 0; }
  .mobile-tabs { display: flex; gap: 0.5rem; overflow-x: auto; -webkit-overflow-scrolling: touch; margin-bottom: 1rem; padding: 0.5rem 0; border-bottom: 2px solid var(--color-border); }
  .mobile-tab { padding: 0.5rem 1rem; background: var(--color-surface); color: var(--color-text); text-decoration: none; border-radius: 4px; white-space: nowrap; font-size: 0.875rem; }
}
</style>
