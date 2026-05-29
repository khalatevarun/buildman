import { useState, useCallback } from 'react'
import { api } from '../utility/api'

export interface Project {
  project_id: string
  name: string
  created_at: number
  last_used_at: number
  deployed_url: string | null
  deployed_hash: string | null
}

export function useProjects(userId: string | null) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)

  const fetchProjects = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const { data } = await api.get<{ projects: Project[] }>(`/projects?user_id=${userId}`)
      setProjects(data.projects)
    } finally {
      setLoading(false)
    }
  }, [userId])

  return { projects, loading, fetchProjects }
}
