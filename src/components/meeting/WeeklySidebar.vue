<template>
  <aside class="weekly-sidebar">
    <nav>
      <a
        v-for="section in sections"
        :key="section.id"
        :href="`#${section.id}`"
        :class="['sidebar-link', { active: activeSection === section.id }]"
        @click.prevent="scrollToSection(section.id)"
      >
        <span v-if="section.type === 'project' && section.status" :class="['status-dot', `status-${section.status}`]"></span>
        {{ section.label }}
      </a>
    </nav>
  </aside>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  sections: {
    type: Array,
    required: true
  }
})

const activeSection = ref('')
let observer = null

onMounted(() => {
  setupScrollspy()
})

onUnmounted(() => {
  if (observer) {
    observer.disconnect()
  }
})

function setupScrollspy() {
  const options = {
    root: null,
    rootMargin: '-100px 0px -50% 0px',
    threshold: 0
  }

  observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        activeSection.value = entry.target.id
      }
    })
  }, options)

  // 观察所有 section
  props.sections.forEach(section => {
    const element = document.getElementById(section.id)
    if (element) {
      observer.observe(element)
    }
  })
}

function scrollToSection(id) {
  const element = document.getElementById(id)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
</script>

<style scoped>
.weekly-sidebar {
  position: sticky;
  top: 80px;
  width: 160px;
  min-width: 160px;
  flex-shrink: 0;
  align-self: flex-start;
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border);
  padding: 1rem;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}

nav {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sidebar-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  color: var(--color-muted);
  text-decoration: none;
  font-size: 0.875rem;
  border-radius: 4px;
  transition: all 0.2s;
}

.sidebar-link:hover {
  background: rgba(255, 153, 0, 0.1);
  color: var(--color-text);
}

.sidebar-link.active {
  background: rgba(255, 153, 0, 0.2);
  color: var(--color-orange);
  font-weight: 600;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-on-track {
  background: #2e7d32;
}

.status-at-risk {
  background: var(--color-orange);
}

.status-completed {
  background: #6e7d7e;
}

/* 移动端隐藏 */
@media (max-width: 767px) {
  .weekly-sidebar {
    display: none;
  }
}
</style>
