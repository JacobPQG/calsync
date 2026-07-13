// ─── QrCode View ──────────────────────────────────────────────────────────────
// Renders a string as a QR code, plus a download button for the PNG.
//
// Why a dependency: QR encoding is Reed-Solomon error correction, bit
// interleaving and mask selection. A hand-rolled version that is subtly wrong
// produces a code that scans on the phone you tested and fails on someone
// else's. `qrcode` (MIT) is the standard implementation; we use only its
// browser-safe string/data-URL entry points, so nothing pulls in `fs`/`canvas`.
//
// Error-correction level M tolerates ~15% damage — the usual choice for a code
// that may be shown on a screen or printed small.

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { log } from '../lib/log'

interface Props {
  value: string          // the URL to encode
  size?: number          // px
  filename?: string      // download name (no extension)
}

const DEFAULT_SIZE = 220

export function QrCode({ value, size = DEFAULT_SIZE, filename = 'invite' }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [failed,  setFailed]  = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)

    // Quiet zone (margin) of 2 modules is the practical minimum for reliable
    // scanning; white background so it stays scannable in dark mode, where a
    // theme-coloured QR would invert and confuse some readers.
    QRCode.toDataURL(value, {
      width: size * 2,           // 2× for crisp rendering on retina screens
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(url => { if (!cancelled) setDataUrl(url) })
      .catch(err => {
        if (cancelled) return
        log.error('invite', 'QR render failed', String(err))
        setFailed(true)
      })

    return () => { cancelled = true }
  }, [value, size])

  if (failed) {
    return (
      <p className="text-xs rounded-lg px-3 py-2"
        style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
        Could not render the QR code. The link below still works.
      </p>
    )
  }

  if (!dataUrl) {
    return <div style={{ width: size, height: size, background: 'var(--bg-subtle)', borderRadius: 8 }} />
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Always on white — see the colour note above. */}
      <img src={dataUrl} width={size} height={size} alt="Invite QR code"
        style={{ borderRadius: 8, background: '#fff', padding: 8 }} />
      <a href={dataUrl} download={`${filename}.png`}
        className="text-xs font-medium underline" style={{ color: 'var(--accent)' }}>
        Download PNG
      </a>
    </div>
  )
}
