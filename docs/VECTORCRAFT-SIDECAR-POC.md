# Sidecar VectorCraft — desain teknis & POC

Tanggal: 2026-11-27
Status: POC terimplementasi dan **tervalidasi terhadap binary asli `vectorcraft-cli` 0.24.1** (macOS universal, checksum SHA256 cocok dengan SHA256SUMS.txt rilis resmi)

## Tujuan dan batas

VectorCraft berperan sebagai **sidecar ornamen vektor**, bukan pengganti canvas utama
(keputusan di `REALTIME-CANVAS-CONSOLIDATION.md` §3). Alur yang difasilitasi:

```text
SVG ornamen (unggahan aset / hasil agen)
        │  POST /api/vectorcraft/ornament
        ▼
VectorCraft MCP (headless): open_file → command_batch → export SVG → render_preview
        │
        ▼
SVG ter-refine → dokumen kanonik → Smart Object di PhotoCraft (jalur runtime yang ada)
```

Batas POC: transport, orkestrasi refine, ekspor SVG, pratinjau PNG, status.
Integrasi UI/agen AG-UI (pemanggilan dari chat) adalah langkah berikutnya.

## Mengapa pola MCP yang sama

Konvensi `vectorcraft-cli mcp` identik dengan `photocraft-cli mcp` (dok resmi
craft.wiki/apps/vectorcraft/ai-agents): stdio JSON-RPC, `tools/call`,
`command_batch` (maks. 256 langkah, `stop_on_error`), dan
`--automation-read-root`/`--automation-write-root` yang sekaligus memaksa mode
tanpa jendela. Karena itu plumbing diekstrak ke `api/lib/mcp-stdio.ts`
(`McpStdioClient`) dan kini dipakai bersama:

| Berkas | Peran |
| --- | --- |
| `api/lib/mcp-stdio.ts` | Transport generik: spawn, handshake `initialize`, antrean serial `tools/call`, timeout, teardown |
| `api/photocraft/mcp-session.ts` | Adapter operasi runtime PhotoCraft (direfactor ke transport generik, perilaku tidak berubah) |
| `api/vectorcraft/session.ts` | Sesi sidecar: `openSvg`, `refine` (batch), `exportDocument`, `renderPreview`, `inspect` |
| `api/vectorcraft/ornament.ts` | `probeVectorCraft` + `refineOrnament` (validasi SVG ≤ 8 MB, batch stop-on-error, ekspor, pratinjau best-effort) |
| `api/routes/vectorcraft.ts` | `GET /api/vectorcraft/status`, `POST /api/vectorcraft/ornament` |

## Konfigurasi

```sh
VECTORCRAFT_CLI_BIN=/path/ke/vectorcraft-cli   # wajib; fitur nonaktif (503) bila kosong
```

Tidak ada runtime ter-bundle (berbeda dengan PhotoCraft): macOS memakai unduhan
`vectorcraft-cli-<ver>-macos-universal.zip`, Linux memakai paket rilis. Resolver
memeriksa keberadaan binary dan menyimpan satu sesi MCP per path binary.

## Kontrak POST /api/vectorcraft/ornament

```json
{
  "name": "ornamen.svg",
  "svgBase64": "PHN2Zy...",
  "commands": [{ "id": "select.all" }, { "id": "set.paint", "params": { "fill": "#0c0" } }],
  "maxSide": 1024
}
```

Respons: `{ svgBase64, previewPngBase64?, completed, warnings }`. Kegagalan langkah
batch menolak seluruh permintaan (tidak ada ekspor parsial) dengan nomor langkah
penyebab. `set.paint` dan id perintah lain mengikuti katalog perintah VectorCraft
(`list_commands`) — diberikan oleh pemanggil (agen), bukan di-hardcode di sisi
server, agar POC tidak bergantung pada id yang belum diverifikasi terhadap binary
asli.

## Hasil validasi

- 5 test baru (`api/vectorcraft/ornament.test.ts`, fake CLI): urutan
  open → batch → export → preview, pemetaan langkah batch, penolakan saat langkah
  gagal (tanpa ekspor), penolakan payload non-SVG, status tersedia/tidak.
- Refactor `PhotoCraftMcpSession` ke transport generik: test MCP + parity lulus
  tanpa perubahan perilaku.
- Suite penuh: **66/66 test lulus** (13 file); `tsc -b` dan ESLint bersih.

### Validasi terhadap binary asli (0.24.1)

- Binary diunduh dari rilis resmi `storytold/vectorcraft` v0.24.1
  (`vectorcraft-cli-0.24.1-macos-universal.zip`); SHA256 cocok dengan
  `SHA256SUMS.txt` resmi, tersimpan di `vendor/vectorcraft/` dan diaktifkan lewat
  `VECTORCRAFT_CLI_BIN` di `.env`.
- `tools/list` mengonfirmasi seluruh tool yang dipakai POC: `open_file`
  (wajib `path`), `command_batch` (`steps`, `stop_on_error`, `atomic`),
  `export` (`path`, `format`), `render_preview` (`max_side`), `inspect_document`.
- **Koreksi kontrak**: langkah `command_batch` VectorCraft hanya menerima
  `{id, params}` — flag `wait` ala PhotoCraft ditolak ("unknown step argument")
  dan sudah dihapus dari `api/vectorcraft/session.ts`.
- Perintah nyata terkonfirmasi: `select.all` (menu Select), `paint.setFill`
  (`color: "#rrggbb"`), keluarga `recolor.*`; katalog lengkap bisa digali lewat
  `command_list` dan resource `vectorcraft://command/{id}`.
- Round-trip E2E (`scripts/vc-e2e.ts`): probe status → open SVG fixture →
  `select.all` + `paint.setFill #2c3e50` → ekspor SVG → pratinjau PNG. Hasil:
  warna lama hilang, warna baru ada, PNG preview 572 byte — **recolor benar-benar
  terjadi di engine asli**.
- Catatan operasional: start-up pertama lambat (±2–3 menit, indeks font);
  berikutnya < 2 detik. Binary path harus absolut karena sesi spawn dengan `cwd`
  kustom (sudah ditangani `resolveVectorCraftBinary`).

## Sebelum produksi

1. Image Docker perlu memaketkan vectorcraft-cli Linux (`.tar.gz` x86_64 dari
   rilis yang sama) bila sidecar ingin aktif di container; pola verifikasi
   checksum + pinned glibc milik PhotoCraft bisa ditiru.
2. ~~Integrasi agen AG-UI~~ ✅ Terimplementasi: intent baru `ornament-refine` di
   tab Agen (tombol "Refine VC"). Agen menerjemahkan instruksi bebas menjadi
   perintah VectorCraft terverifikasi (maks. 8 langkah, katalog dibatasi pada
   `select.all`, `select.none`, `paint.setFill`, `paint.swap`, `recolor.*`), lalu
   memanggil `refineOrnament` dan mengembalikan proposal kartu yang sama seperti
   ornamen AI — aset asli tidak berubah, hasil masuk sebagai satu revisi dengan
   undo utuh. Fallback deterministik (warna hex pada instruksi → recolor) aktif
   bila model AI belum diprovisikan; bila sidecar belum dikonfigurasi, agen
   menjelaskan cara mengaktifkannya tanpa mengubah dokumen. Teruji pada
   `api/routes/agent-ornament-refine.test.ts` (3 skenario: tanpa aset, tanpa
   binary, dan proposal penuh via fallback + sidecar).
