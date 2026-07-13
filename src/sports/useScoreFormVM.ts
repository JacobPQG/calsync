// ─── ScoreForm ViewModel ──────────────────────────────────────────────────────
// State + validation for recording a match result on an event: 2–4 sides, each
// with a name, members, and a score. The view binds to `teams` and calls the
// actions. Result is written to CalEvent.result (see store.updateEvent).

import { useState } from 'react'
import type { CalEvent, TeamScore, User } from '../types'
import { useStore } from '../store/useStore'

export const MAX_TEAMS = 4
const DEFAULT_NAMES = ['Team A', 'Team B', 'Team C', 'Team D']

export interface DraftTeam {
  name:      string
  memberIds: string[]
  score:     string   // free text while editing; validated on save
}

function emptyTeam(i: number): DraftTeam {
  return { name: DEFAULT_NAMES[i] ?? `Team ${i + 1}`, memberIds: [], score: '' }
}

export interface ScoreFormVM {
  users:   User[]
  teams:   DraftTeam[]
  error:   string | null
  hasExistingResult: boolean
  canAddTeam: boolean

  patchTeam:    (i: number, patch: Partial<DraftTeam>) => void
  toggleMember: (i: number, userId: string) => void
  addTeam:      () => void
  removeTeam:   (i: number) => void
  save:         () => void
  removeResult: () => void
}

export function useScoreFormVM(
  { event, onClose }: { event: CalEvent; onClose: () => void },
): ScoreFormVM {
  const { users, updateEvent } = useStore()

  const [teams, setTeams] = useState<DraftTeam[]>(() =>
    event.result
      ? event.result.teams.map(t => ({ name: t.name, memberIds: t.memberIds, score: String(t.score) }))
      : [emptyTeam(0), emptyTeam(1)])
  const [error, setError] = useState<string | null>(null)

  function patchTeam(i: number, patch: Partial<DraftTeam>) {
    setTeams(prev => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  }

  function toggleMember(i: number, userId: string) {
    setTeams(prev => prev.map((t, j) => {
      if (j !== i) return t
      const on = t.memberIds.includes(userId)
      return { ...t, memberIds: on ? t.memberIds.filter(id => id !== userId) : [...t.memberIds, userId] }
    }))
  }

  function save() {
    const parsed: TeamScore[] = []
    for (const t of teams) {
      const score = Number(t.score)
      if (t.score.trim() === '' || !Number.isFinite(score) || score < 0) {
        setError('Every side needs a score (0 or higher).'); return
      }
      if (t.memberIds.length === 0) {
        setError('Every side needs at least one player.'); return
      }
      parsed.push({ name: t.name.trim().slice(0, 40) || 'Team', memberIds: t.memberIds, score })
    }
    updateEvent(event.id, { result: { teams: parsed, recordedAt: new Date().toISOString() } })
    onClose()
  }

  function removeResult() {
    updateEvent(event.id, { result: undefined })
    onClose()
  }

  return {
    users,
    teams,
    error,
    hasExistingResult: !!event.result,
    canAddTeam: teams.length < MAX_TEAMS,
    patchTeam,
    toggleMember,
    addTeam:    () => setTeams(prev => [...prev, emptyTeam(prev.length)]),
    removeTeam: (i) => setTeams(prev => prev.filter((_, j) => j !== i)),
    save,
    removeResult,
  }
}
