import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { SignedIn, SignedOut, UserButton, useUser } from '@clerk/clerk-react'
import { useProjects } from '../hooks/useProjects'
import { BuildmanSpinner } from '../components/BuildmanSpinner'
import { ProjectList } from '../components/ProjectList'

export function Apps() {
  const { user } = useUser()
  const navigate = useNavigate()
  const { projects: fetched, loading, fetchProjects } = useProjects(user?.id ?? null)
  const [projects, setProjects] = useState(fetched)

  useEffect(() => {
    if (user?.id) fetchProjects()
  }, [user?.id])

  useEffect(() => {
    setProjects(fetched)
  }, [fetched])

  const handleOpenProject = async (projectId: string) => {
    navigate(`/workspace/${projectId}`)
  }

  const handleDeleteProject = (projectId: string) => {
    setProjects(prev => prev.filter(p => p.project_id !== projectId))
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4">
        <Link
          to="/"
          className="text-sm font-semibold tracking-tight text-muted-foreground hover:text-foreground transition-colors duration-150 no-underline font-heading"
        >
          Buildman
        </Link>

        <div className="flex items-center gap-3">
          <SignedIn>
            <Link
              to="/"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150 no-underline"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              New app
            </Link>
            <UserButton />
          </SignedIn>

          <SignedOut>
            <Link to="/" className="text-xs text-muted-foreground no-underline">Sign in</Link>
          </SignedOut>
        </div>
      </nav>

      {/* Content */}
      <SignedIn>
        <div className="flex-1 flex flex-col items-center pt-12 px-4 pb-20">
          <div className="w-full max-w-[520px]">
            <h2 className="text-xs uppercase tracking-[0.08em] mb-6 text-muted-foreground/50 font-heading font-semibold">
              Apps
            </h2>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <BuildmanSpinner size={24} className="text-muted-foreground/50" />
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center py-20 gap-4">
                <p className="text-sm text-muted-foreground">No apps yet</p>
                <Link
                  to="/"
                  className="text-xs px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-150 no-underline"
                >
                  Build your first app →
                </Link>
              </div>
            ) : (
              <ProjectList
                projects={projects}
                userId={user?.id ?? ''}
                onOpen={handleOpenProject}
                onDelete={handleDeleteProject}
              />
            )}
          </div>
        </div>
      </SignedIn>

      <SignedOut>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Sign in to view your apps</p>
        </div>
      </SignedOut>
    </div>
  )
}
