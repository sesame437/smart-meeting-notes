import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomeView
  },
  {
    path: '/meetings/:id',
    name: 'meeting',
    component: () => import('../views/MeetingView.vue')
  },
  {
    path: '/glossary',
    name: 'glossary',
    component: () => import('../views/GlossaryView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
