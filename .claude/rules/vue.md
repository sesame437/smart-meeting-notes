# Vue 3 + Vite 开发规范

## 技术栈
- Vue 3 + `<script setup>` Composition API
- Vite（构建工具）
- Pinia（状态管理，替代 Vuex）
- Vue Router 4（路由）
- TypeScript 可选（当前阶段用 JS，后续可渐进迁移）

## 文件组织
```
src/
├── main.js
├── App.vue
├── router/index.js
├── stores/          # Pinia stores
├── api/index.js     # 统一 API 层（唯一调用 fetch 的地方）
├── components/      # 可复用组件（无路由）
│   ├── common/      # EditableList, ConfirmDialog, Toast
│   ├── meeting/     # MeetingCard, MeetingDetail, ProjectReview, SpeakerMap
│   └── upload/      # UploadArea
└── views/           # 路由级页面组件
    ├── HomeView.vue
    ├── MeetingView.vue
    └── GlossaryView.vue
```

## 文件大小上限（铁律）
- 每个 .vue 文件 ≤ 200 行（含 template + script + style）
- 超过 200 行必须拆分子组件
- 禁止在单文件里实现多个逻辑无关的功能

## 组件规范
```vue
<script setup>
// 1. imports
import { ref, computed, onMounted } from 'vue'
import { useMeetingStore } from '@/stores/meeting'

// 2. props & emits
const props = defineProps({ meetingId: String })
const emit = defineEmits(['update', 'delete'])

// 3. store
const store = useMeetingStore()

// 4. local state
const loading = ref(false)

// 5. computed
const items = computed(() => store.highlights)

// 6. methods
async function save() { ... }

// 7. lifecycle
onMounted(() => { ... })
</script>

<template>
  <!-- 单根元素 -->
</template>

<style scoped>
/* 仅 scoped，禁止全局样式写在组件里 */
</style>
```

## Pinia Store 规范
```js
// stores/meeting.js
import { defineStore } from 'pinia'
import { api } from '@/api'

export const useMeetingStore = defineStore('meeting', {
  state: () => ({ current: null, list: [], loading: false }),
  getters: {
    report: (state) => state.current?.content || {}
  },
  actions: {
    async fetchMeeting(id) {
      this.loading = true
      this.current = await api.get(`/meetings/${id}`)
      this.loading = false
    },
    async patchSection(id, section, data) {
      await api.patch(`/meetings/${id}/report`, { section, data })
      // 乐观更新本地 state
      if (this.current?.content) {
        this.current.content[section] = data
      }
    }
  }
})
```

## API 层规范
```js
// api/index.js — 唯一调用 fetch 的地方
const BASE = '/api'
export const api = {
  get:    (path) => fetch(`${BASE}${path}`).then(r => r.json()),
  post:   (path, body) => fetch(`${BASE}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(r => r.json()),
  patch:  (path, body) => fetch(`${BASE}${path}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(r => r.json()),
  delete: (path) => fetch(`${BASE}${path}`, { method:'DELETE' }).then(r => r.ok),
}
// 禁止在 store 或 component 里直接调用 fetch
```

## EditableList 组件规范（核心通用组件）
```vue
<!-- components/common/EditableList.vue -->
<script setup>
const props = defineProps({
  items:     Array,   // 数据数组
  fields:    Array,   // [{key, label, type:'text'|'textarea', required}]
  section:   String,  // 对应 report 字段名（如 'highlights'）
  meetingId: String,
  prIndex:   Number,  // projectReview 索引，非 PR 传 undefined
  addLabel:  String,
  emptyText: String,
})
const emit = defineEmits(['save'])  // 父组件监听保存
</script>
```

## 禁止事项
- 禁止直接操作 DOM（document.getElementById、innerHTML）— 用 ref/v-model
- 禁止在 template 里写业务逻辑（if 判断超过3层请提取 computed）
- 禁止在 component 里直接 fetch，必须走 store 或 api 层
- 禁止全局 CSS（用 scoped 或 CSS 变量）
- 禁止用旧字段别名（详见 data.md）

## 构建与部署
```bash
npm run dev      # 开发（Vite dev server，port 5173）
npm run build    # 构建到 dist/
npm run preview  # 预览 dist/
```
Express server.js 在生产环境 serve dist/ 目录：
```js
app.use(express.static(path.join(__dirname, 'dist')))
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist/index.html')))
```

## CSS 变量（全局主题）
```css
:root {
  --color-bg:      #232F3E;
  --color-surface: #1a2332;
  --color-orange:  #FF9900;
  --color-text:    #ffffff;
  --color-muted:   #879596;
  --color-border:  rgba(255,255,255,0.1);
  --color-success: #2e7d32;
  --color-danger:  #d32f2f;
}
```
