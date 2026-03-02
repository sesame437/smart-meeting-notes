import { defineStore } from 'pinia'
import { api } from '@/api'

export const useGlossaryStore = defineStore('glossary', {
  state: () => ({
    items: [],
    loading: false,
    error: null
  }),

  getters: {
    // 按 term 首字母分组
    itemsByInitial: (state) => {
      const grouped = {}
      state.items.forEach(item => {
        const initial = (item.term?.[0] || '#').toUpperCase()
        if (!grouped[initial]) grouped[initial] = []
        grouped[initial].push(item)
      })
      return grouped
    }
  },

  actions: {
    // 获取所有词条
    async fetchAll() {
      this.loading = true
      this.error = null
      try {
        const data = await api.get('/glossary')
        this.items = data.terms || []
        return data
      } catch (err) {
        this.error = err.message
        throw err
      } finally {
        this.loading = false
      }
    },

    // 创建词条
    async createTerm(term, translation) {
      try {
        const data = await api.post('/glossary', { term, translation })

        // 添加到列表
        this.items.push({ term, translation })

        return data
      } catch (err) {
        this.error = err.message
        throw err
      }
    },

    // 更新词条
    async updateTerm(term, translation) {
      try {
        await api.patch('/glossary', { term, translation })

        // 更新列表中的项
        const index = this.items.findIndex(item => item.term === term)
        if (index !== -1) {
          this.items[index].translation = translation
        }
      } catch (err) {
        this.error = err.message
        throw err
      }
    },

    // 删除词条
    async deleteTerm(term) {
      try {
        await api.delete(`/glossary?term=${encodeURIComponent(term)}`)

        // 从列表中移除
        this.items = this.items.filter(item => item.term !== term)
      } catch (err) {
        this.error = err.message
        throw err
      }
    }
  }
})
