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
        const items = await api.get('/glossary')
        this.items = items || []
        return items
      } catch (err) {
        this.error = err.message
        throw err
      } finally {
        this.loading = false
      }
    },

    // 获取人员分类词条
    async fetchPersonnel() {
      try {
        const items = await api.get('/glossary?category=人员')
        return items || []
      } catch (err) {
        this.error = err.message
        return []
      }
    },

    // 创建词条
    async createTerm(term, definition, category) {
      try {
        const body = { term, definition }
        if (category !== undefined) body.category = category

        const newItem = await api.post('/glossary', body)

        // 添加到列表
        this.items.push(newItem)

        return newItem
      } catch (err) {
        this.error = err.message
        throw err
      }
    },

    // 更新词条
    async updateTerm(termId, term, definition, category) {
      try {
        const body = { term, definition }
        if (category !== undefined) body.category = category

        const updatedItem = await api.put(`/glossary/${termId}`, body)

        // 更新列表中的项
        const index = this.items.findIndex(item => item.termId === termId)
        if (index !== -1) {
          this.items[index] = updatedItem
        }

        return updatedItem
      } catch (err) {
        this.error = err.message
        throw err
      }
    },

    // 删除词条
    async deleteTerm(termId) {
      try {
        await api.delete(`/glossary/${termId}`)

        // 从列表中移除
        this.items = this.items.filter(item => item.termId !== termId)
      } catch (err) {
        this.error = err.message
        throw err
      }
    }
  }
})
