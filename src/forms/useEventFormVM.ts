// ─── EventForm ViewModel ──────────────────────────────────────────────────────
// All state, validation, and submit logic for the create/edit event form.
// The view (EventForm.view.tsx) is pure markup that binds to these fields.
//
// Create mode: pass `date` only → addEvent on submit.
// Edit mode:   pass `existing`   → updateEvent on submit.
// Sports mode: the activity is the primary field and the title is optional
//              (falls back to the activity's name).

import { useState } from 'react'
import type { CalEvent, RecurringRule } from '../types'
import { useStore }           from '../store/useStore'
import { urlValidationError } from '../utils/safeUrl'
import { IS_SPORTS }          from '../lib/siteConfig'
import { activityById }       from '../sports/activities'

// Preset tag chips differ per site variant.
const CLASSIC_TAGS = ['work', 'personal', 'travel', 'focus', 'flex', 'free']
const SPORT_TAGS   = ['match', 'training', 'tournament', 'casual', 'indoor', 'outdoor']
export const PRESET_TAGS = IS_SPORTS ? SPORT_TAGS : CLASSIC_TAGS

const MAX_TAGS = 10

export interface EventFormVM {
  ready:   boolean          // false → "select a user first" state
  isEdit:  boolean
  userName: string
  headerDate: string

  // Bound field values + setters (grouped for a compact view).
  fields: {
    title: string;           setTitle: (v: string) => void
    activity: string;        setActivity: (v: string) => void
    description: string;     setDescription: (v: string) => void
    startHour: number;       setStartHour: (v: number) => void
    endHour: number;         setEndHour: (v: number) => void
    tags: string[]
    locationName: string;    setLocationName: (v: string) => void
    locationAddress: string; setLocationAddress: (v: string) => void
    locationMapsUrl: string; setLocationMapsUrl: (v: string) => void
    eventUrl: string;        setEventUrl: (v: string) => void
    frequency: RecurringRule['frequency']; setFrequency: (v: RecurringRule['frequency']) => void
    daysOfWeek: number[]
    endDate: string;         setEndDate: (v: string) => void
    customTag: string;       setCustomTag: (v: string) => void
  }

  // Derived helpers for the view.
  presetTags:  string[]
  customTags:  string[]       // active tags not in the preset list
  canAddMoreTags: boolean
  canSubmit:   boolean
  eventUrlError: string | null
  mapsUrlError:  string | null

  // Actions.
  toggleTag:      (tag: string) => void
  commitCustomTag: () => void
  toggleDow:      (i: number) => void
  submit:         () => void
}

export function useEventFormVM(
  { date, existing, onClose }: { date: string; existing?: CalEvent; onClose: () => void },
): EventFormVM {
  const { addEvent, updateEvent, activeUser, activeUserId } = useStore()
  const user   = activeUser()
  const isEdit = !!existing

  const [title,           setTitle]           = useState(existing?.title           ?? '')
  const [activity,        setActivity]        = useState(existing?.activity        ?? '')
  const [description,     setDescription]     = useState(existing?.description     ?? '')
  const [startHour,       setStartHour]       = useState(existing?.startHour       ?? 9)
  const [endHour,         setEndHour]         = useState(existing?.endHour         ?? 17)
  const [tags,            setTags]            = useState<string[]>(existing?.tags  ?? [])
  const [locationName,    setLocationName]    = useState(existing?.location?.name    ?? '')
  const [locationAddress, setLocationAddress] = useState(existing?.location?.address ?? '')
  const [locationMapsUrl, setLocationMapsUrl] = useState(existing?.location?.mapsUrl ?? '')
  const [eventUrl,        setEventUrl]        = useState(existing?.eventUrl         ?? '')
  const [frequency,       setFrequency]       = useState<RecurringRule['frequency']>(
    existing?.recurring?.frequency ?? 'none')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(existing?.recurring?.daysOfWeek ?? [])
  const [endDate,    setEndDate]    = useState(existing?.recurring?.endDate ?? '')
  const [customTag,  setCustomTag]  = useState('')

  function toggleTag(tag: string) {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  function commitCustomTag() {
    // Strip to safe alphanumeric/dash chars; cap length + count.
    const cleaned = customTag.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30)
    if (cleaned && !tags.includes(cleaned) && tags.length < MAX_TAGS) {
      setTags(prev => [...prev, cleaned])
    }
    setCustomTag('')
  }

  function toggleDow(i: number) {
    setDaysOfWeek(prev => prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i])
  }

  // Sports mode: activity OR title is enough. Classic: title required.
  const canSubmit = IS_SPORTS ? (!!activity || !!title.trim()) : !!title.trim()

  function submit() {
    if (!canSubmit || !activeUserId) return
    if (eventUrl        && urlValidationError(eventUrl))        return
    if (locationMapsUrl && urlValidationError(locationMapsUrl)) return

    const fallbackTitle = activityById(activity)?.label ?? ''
    const payload = {
      userId:      activeUserId,
      title:       (title.trim() || fallbackTitle).slice(0, 100),
      activity:    activity || undefined,
      description: description.slice(0, 1000),
      tags,
      date:        existing?.date ?? date,
      startHour,
      endHour:     endHour > startHour ? endHour : startHour + 0.5,
      location:    locationName || locationAddress || locationMapsUrl
        ? {
            name:    locationName    || undefined,
            address: locationAddress || undefined,
            mapsUrl: locationMapsUrl || undefined,
          }
        : undefined,
      eventUrl: eventUrl || undefined,
      recurring: {
        frequency,
        daysOfWeek: frequency === 'weekly' ? daysOfWeek : undefined,
        endDate:    endDate || undefined,
      },
    }

    if (isEdit && existing) updateEvent(existing.id, payload)
    else                    addEvent(payload)
    onClose()
  }

  return {
    ready:   !!user && !!activeUserId,
    isEdit,
    userName:   user?.name ?? '',
    headerDate: existing?.date ?? date,
    fields: {
      title, setTitle, activity, setActivity, description, setDescription,
      startHour, setStartHour, endHour, setEndHour, tags,
      locationName, setLocationName, locationAddress, setLocationAddress,
      locationMapsUrl, setLocationMapsUrl, eventUrl, setEventUrl,
      frequency, setFrequency, daysOfWeek, endDate, setEndDate, customTag, setCustomTag,
    },
    presetTags: PRESET_TAGS,
    customTags: tags.filter(t => !PRESET_TAGS.includes(t)),
    canAddMoreTags: tags.length < MAX_TAGS,
    canSubmit,
    eventUrlError: eventUrl ? urlValidationError(eventUrl) : null,
    mapsUrlError:  locationMapsUrl ? urlValidationError(locationMapsUrl) : null,
    toggleTag,
    commitCustomTag,
    toggleDow,
    submit,
  }
}
