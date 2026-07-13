// ─── StatsPanel ViewModel(s) ──────────────────────────────────────────────────
// Logic for the leaderboard/challenges overlay, split by sub-view so each
// renders from a plain data object. All derivations run over the events the
// viewer is allowed to see (RLS-filtered in Supabase mode) → private by design.

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useStore }   from '../store/useStore'
import { FEATURES }   from '../lib/siteConfig'
import { ACTIVITIES, activityLabel, type Activity } from './activities'
import { buildStandings, recordedMatches, type Standing, type RecordedMatch } from './standings'
import { buildChallenges, type ChallengeResult } from './challenges'

export type Tab = 'leaderboard' | 'challenges'

// Which tabs are enabled (admin feature flags) + selection state.
export function useStatsTabs() {
  const tabs: Tab[] = [
    ...(FEATURES.leaderboard ? ['leaderboard' as const] : []),
    ...(FEATURES.challenges  ? ['challenges'  as const] : []),
  ]
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'leaderboard')
  return { tabs, tab, setTab }
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

export interface RecentRow {
  match:   RecordedMatch
  label:   string          // activity label or the event title
  dateText: string         // "MMM d"
  isDraw:  boolean
}

export interface LeaderboardVM {
  activity:      string | null
  setActivity:  (id: string | null) => void
  usedActivities: Activity[]     // activities that actually have results (for filter chips)
  standings:     Standing[]
  recent:        RecentRow[]
}

const RECENT_LIMIT = 8

export function useLeaderboardVM(): LeaderboardVM {
  const { events, users } = useStore()
  const [activity, setActivity] = useState<string | null>(null)

  const standings = useMemo(
    () => buildStandings(events, users, activity), [events, users, activity])

  const recent = useMemo<RecentRow[]>(() =>
    recordedMatches(events)
      .filter(m => !activity || m.event.activity === activity)
      .slice(0, RECENT_LIMIT)
      .map(match => ({
        match,
        label:    activityLabel(match.event.activity) ?? match.event.title,
        dateText: format(new Date(match.event.date + 'T00:00:00'), 'MMM d'),
        isDraw:   match.winners.length > 1,
      })),
    [events, activity])

  const usedActivities = useMemo(() => {
    const used = new Set(recordedMatches(events).map(m => m.event.activity).filter(Boolean))
    return ACTIVITIES.filter(a => used.has(a.id))
  }, [events])

  return { activity, setActivity, usedActivities, standings, recent }
}

// ── Challenges ────────────────────────────────────────────────────────────────

export interface ChallengesVM {
  monthLabel: string
  challenges: ChallengeResult[]
  hasAny:     boolean
}

export function useChallengesVM(): ChallengesVM {
  const { events, users, currentMonth } = useStore()
  const challenges = useMemo(
    () => buildChallenges(events, users, currentMonth), [events, users, currentMonth])
  return {
    monthLabel: format(currentMonth, 'MMMM yyyy'),
    challenges,
    hasAny:     challenges.some(c => c.entries.length > 0),
  }
}
