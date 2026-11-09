import { describe, it, expect } from 'vitest'
import { sniffFile } from '@/lib/file-sniff'

const bytes = (...n: number[]) => new Uint8Array(n)
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))

describe('sniffFile (lampiran hanya JPG/PNG/WEBP/PDF, diputuskan dari isi berkas)', () => {
  it('mengenali format yang diizinkan', () => {
    expect(sniffFile(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toEqual({ type: 'image/jpeg', ext: 'jpg' })
    expect(sniffFile(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toEqual({ type: 'image/png', ext: 'png' })
    expect(sniffFile(bytes(...ascii('%PDF-1.7')))).toEqual({ type: 'application/pdf', ext: 'pdf' })
    expect(sniffFile(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBPVP8 ')))).toEqual({ type: 'image/webp', ext: 'webp' })
  })

  it('menolak berkas berbahaya atau menyamar, apa pun nama/Content-Type-nya', () => {
    expect(sniffFile(bytes(...ascii('MZ'), 0x90, 0, 3, 0))).toBeNull()                         // .exe
    expect(sniffFile(bytes(...ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBeNull() // SVG bisa memuat script
    expect(sniffFile(bytes(...ascii('<html><script>alert(1)</script>')))).toBeNull()
    expect(sniffFile(bytes(...ascii('GIF89a')))).toBeNull()
    expect(sniffFile(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVEfmt ')))).toBeNull()    // RIFF bukan WEBP
    expect(sniffFile(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0))).toBeNull()                    // PNG dengan tanda tangan rusak
  })

  it('menolak berkas kosong atau terlalu pendek', () => {
    expect(sniffFile(bytes())).toBeNull()
    expect(sniffFile(bytes(0xff, 0xd8))).toBeNull()
    expect(sniffFile(bytes(...ascii('%PDF')))).toBeNull()
  })
})
