// ─── iCal (RFC 5545) Import / Export ─────────────────────────────────────────
// Provides two capabilities:
//   exportToIcal  – converts CalEvent[] to a .ics string (RFC 5545)
//   parseIcal     – parses a .ics string back to plain event objects
//   downloadIcal  – triggers a browser download of the .ics file
//
// Only a subset of the spec is implemented (single-occurrence events, basic
// recurrence rules). Exotic iCal features like VTIMEZONE or VALARM are ignored
// on import and not emitted on export.

import type { CalEvent, User } from '../types'

// ── Export ────────────────────────────────────────────────────────────────────

// Format a local date+hour as an iCal datetime string (floating, no TZ suffix).
// e.g. date="2024-04-15", hour=9  →  "20240415T090000"
function toIcalDateTime(isoDate: string, hour: number): string {
  const [y, m, d] = isoDate.split('-')
  const hh = String(hour).padStart(2, '0')
  return `${y}${m}${d}T${hh}0000`
}

// Fold long lines at 75 octets as required by RFC 5545 §3.1.
function fold(line: string): string {
  if (line.length <= 75) return line
  const out: string[] = [line.slice(0, 75)]
  let i = 75
  while (i < line.length) {
    out.push(' ' + line.slice(i, i + 74))
    i += 74
  }
  return out.join('\r\n')
}

// Escape TEXT values per RFC 5545: backslash, semicolon, comma, newline.
function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

// Build a .ics string from an array of CalEvents.
export function exportToIcal(events: CalEvent[], users: User[]): string {
  const userMap = new Map(users.map(u => [u.id, u]))
  const stamp   = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CalSync//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:CalSync',
  ]

  for (const ev of events) {
    const user = userMap.get(ev.userId)
    lines.push('BEGIN:VEVENT')
    lines.push(fold(`UID:${ev.id}@calsync`))
    lines.push(fold(`DTSTAMP:${stamp}`))
    lines.push(fold(`DTSTART:${toIcalDateTime(ev.date, ev.startHour)}`))
    lines.push(fold(`DTEND:${toIcalDateTime(ev.date, ev.endHour)}`))
    lines.push(fold(`SUMMARY:${esc(ev.title)}`))
    if (ev.description)        lines.push(fold(`DESCRIPTION:${esc(ev.description)}`))
    if (ev.location?.address)  lines.push(fold(`LOCATION:${esc(ev.location.address)}`))
    if (ev.location?.mapsUrl)  lines.push(fold(`X-APPLE-STRUCTURED-LOCATION:${ev.location.mapsUrl}`))
    if (ev.eventUrl)           lines.push(fold(`URL:${ev.eventUrl}`))
    if (ev.tags.length)        lines.push(fold(`CATEGORIES:${ev.tags.map(esc).join(',')}`))
    if (user)                  lines.push(fold(`ORGANIZER;CN="${esc(user.name)}":MAILTO:noreply@calsync`))

    // Emit RRULE for recurring events
    if (ev.recurring.frequency !== 'none') {
      const freq = ev.recurring.frequency.toUpperCase()
      const parts = [`FREQ=${freq}`]
      if (ev.recurring.endDate)
        parts.push(`UNTIL=${toIcalDateTime(ev.recurring.endDate, 23)}`)
      if (ev.recurring.frequency === 'weekly' && ev.recurring.daysOfWeek?.length) {
        const names = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
        parts.push(`BYDAY=${ev.recurring.daysOfWeek.map(d => names[d]).join(',')}`)
      }
      lines.push(fold(`RRULE:${parts.join(';')}`))
    }

    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// Trigger a browser download of the generated .ics file.
export function downloadIcal(events: CalEvent[], users: User[], filename = 'calsync.ics') {
  const content = exportToIcal(events, users)
  const blob    = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url     = URL.createObjectURL(blob)
  const a       = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Import ────────────────────────────────────────────────────────────────────

export interface ParsedIcalEvent {
  uid?:        string
  title:       string
  date:        string   // YYYY-MM-DD
  startHour:   number
  endHour:     number
  description?: string
  location?:   string
  tags:        string[]
  eventUrl?:   string
}

// Parse VEVENT blocks from a .ics string. Returns an array of plain objects.
// userId / recurring are intentionally omitted – the caller decides those.
export function parseIcal(icsText: string): ParsedIcalEvent[] {
  // RFC 5545 §3.1: unfold continuation lines (lines starting with SPACE or TAB)
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '')
  const results:  ParsedIcalEvent[] = []

  // Split on BEGIN:VEVENT; index 0 is everything before the first event
  const blocks = unfolded.split(/BEGIN:VEVENT/i)
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i]

    // Grab a property value by name (handles parameter syntax: NAME;PARAM=X:value)
    function get(name: string): string | undefined {
      const re = new RegExp(`^${name}(?:;[^:]*)?:([^\r\n]*)`, 'im')
      const m  = block.match(re)
      if (!m) return undefined
      return m[1]
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\n/gi, '\n')
        .replace(/\\\\/g, '\\')
    }

    const summary = get('SUMMARY')
    if (!summary) continue

    const dtstart = get('DTSTART')
    if (!dtstart) continue

    // Parse iCal datetime: 20240415T090000[Z] or 20240415
    const m = dtstart.replace(/[TZ]/g, '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?/)
    if (!m) continue
    const date      = `${m[1]}-${m[2]}-${m[3]}`
    const startHour = m[4] ? parseInt(m[4], 10) : 9

    const dtend    = get('DTEND')
    const me = dtend?.replace(/[TZ]/g, '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?/)
    const endHour  = me?.[4] ? parseInt(me[4], 10) : startHour + 1

    const cats = get('CATEGORIES')
    const tags = cats ? cats.split(',').map(t => t.trim()).filter(Boolean) : []

    results.push({
      uid:         get('UID'),
      title:       summary,
      date,
      startHour,
      endHour:     Math.max(endHour, startHour + 1),
      description: get('DESCRIPTION'),
      location:    get('LOCATION'),
      tags,
      eventUrl:    get('URL'),
    })
  }

  return results
}
