// ─── EventForm ViewModel ──────────────────────────────────────────────────────
// All state, validation, and submit logic for the create/edit event form.
// The view (EventForm.view.tsx) is pure markup that binds to these fields.
//
// Create mode: pass `date` only → addEvent on submit.
// Edit mode:   pass `existing`   → updateEvent on submit.
// Sports mode: the activity is the primary field and the title is optional
//              (falls back to the activity's name).

import { useState } from 'react'
import type { CalEvent, RecurringRule, EventVisibility } from '../types'
import { DEFAULT_VISIBILITY, isSportsCalendar } from '../types'
import { useStore }           from '../store/useStore'
import { urlValidationError } from '../utils/safeUrl'
import { activityById }       from '../sports/activities'

// Preset tag chips differ by what the calendar is FOR. Chosen per calendar now,
// not per build — a sports calendar offers sports tags, a plain one offers the
// general set. Exported for the view, which renders whichever list the VM picked.
const CLASSIC_TAGS = ['work', 'personal', 'travel', 'focus', 'flex', 'free']
const SPORT_TAGS   = ['match', 'training', 'tournament', 'casual', 'indoor', 'outdoor']

const MAX_TAGS = 10

export interface EventFormVM {
  ready:   boolean          // false → "select a user first" state
  isEdit:  boolean
  // True when the open calendar has sports features on. The view uses it to
  // decide whether to draw the activity picker and how to label the title field.
  isSports: boolean
  userName: string
  headerDate: string

  // Bound field values + setters (grouped for a compact view).
  fields: {
    title: string;           setTitle: (v: string) => void
    activity: string;        setActivity: (v: string) => void
    description: string;     setDescription: (v: string) => void
    startHour: number;       setStartHour: (v: number) => void
    endHour: number;         setEndHour: (v: number) => void
    visibility: EventVisibility; setVisibility: (v: EventVisibility) => void
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
  const { addEvent, updateEvent, activeUser, activeUserId, features } = useStore()
  const user   = activeUser()
  const isEdit = !!existing

  // Is the OPEN calendar a sports calendar? Decides three things in this form:
  // whether the activity picker exists, which tag presets are offered, and
  // whether the title is optional (an activity can stand in for it).
  const isSports   = isSportsCalendar(features)
  const presetTags = isSports ? SPORT_TAGS : CLASSIC_TAGS

  const [title,           setTitle]           = useState(existing?.title           ?? '')
  const [activity,        setActivity]        = useState(existing?.activity        ?? '')
  const [description,     setDescription]     = useState(existing?.description     ?? '')
  const [startHour,       setStartHourState]  = useState(existing?.startHour       ?? 9)
  const [endHour,         setEndHour]         = useState(existing?.endHour         ?? 17)
  const [visibility,      setVisibility]      = useState<EventVisibility>(
    existing?.visibility ?? DEFAULT_VISIBILITY)
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

  // Keep the end time after the start time so the field never shows a value
  // the picker no longer offers.
  function setStartHour(v: number) {
    setStartHourState(v)
    setEndHour(prev => (prev > v ? prev : Math.min(v + 0.5, 24)))
  }

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

  // Sports calendar: activity OR title is enough (the activity names the event).
  // Plain calendar: a title is the only thing that identifies it, so it's required.
  const canSubmit = isSports ? (!!activity || !!title.trim()) : !!title.trim()

  function submit() {
    if (!canSubmit || !activeUserId) return
    if (eventUrl        && urlValidationError(eventUrl))        return
    if (locationMapsUrl && urlValidationError(locationMapsUrl)) return

    // The activity is meaningful only in a sports calendar. Preserved as-is on a
    // plain one (where there is no picker to have set it) so that turning features
    // off and editing an old event does not quietly strip the activity it was
    // recorded with — the data outlives the flag, which is what makes the flag
    // safe to toggle.
    const keptActivity = isSports ? activity : (existing?.activity ?? '')
    const fallbackTitle = activityById(keptActivity)?.label ?? ''
    const payload = {
      userId:      activeUserId,
      title:       (title.trim() || fallbackTitle).slice(0, 100),
      activity:    keptActivity || undefined,
      description: description.slice(0, 1000),
      tags,
      date:        existing?.date ?? date,
      startHour,
      endHour:     endHour > startHour ? endHour : startHour + 0.5,
      visibility,
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
      startHour, setStartHour, endHour, setEndHour,
      visibility, setVisibility, tags,
      locationName, setLocationName, locationAddress, setLocationAddress,
      locationMapsUrl, setLocationMapsUrl, eventUrl, setEventUrl,
      frequency, setFrequency, daysOfWeek, endDate, setEndDate, customTag, setCustomTag,
    },
    isSports,
    presetTags,
    customTags: tags.filter(t => !presetTags.includes(t)),
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
