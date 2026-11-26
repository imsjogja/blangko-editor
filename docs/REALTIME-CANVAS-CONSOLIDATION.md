# Konsolidasi Canvas Realtime — Analisa & Rencana Perubahan

Tanggal: 2026-11-26
Status: Fase 1, write-back (Opsi A), eliminasi Inspector, Fase 2 (bridge multi-tab, protokol 3), dan sidecar VectorCraft (POC) terimplementasi — seluruh rencana selesai

## Ringkasan eksekutif

1. **Sisi A/B sudah memakai satu instance canvas PhotoCraft** (satu iframe WASM). Yang mahal
   bukan jumlah canvas, melainkan setiap pindah sisi memicu render server penuh (±7–12 detik)
   dan bridge menutup seluruh dokumen native (`file.closeAll`) sebelum membuka sisi baru.
   Padahal aplikasi native mendukung multi-dokumen/tab. Rencana: cache snapshot per sisi +
   hash konten (Fase 1, murni TypeScript), lalu tab native per sisi (Fase 2, ubah bridge Rust).
2. **Sebagian UI React memang redundan** terhadap UI native PhotoCraft (inspector objek, layer,
   undo/redo). Tetapi eliminasi punya prasyarat keras: hari ini canvas native adalah proyeksi
   *read-mostly* — edit native tidak menulis balik ke dokumen kanonik JSON yang menjadi sumber
   kebenaran (simpan tRPC, agen AG-UI, preflight). Write-back harus ada dulu, baru UI React
   boleh dihapus tanpa meninggalkan sampah.
3. **PhotoCraft tetap canvas utama yang tepat**; VectorCraft lebih efisien sebagai *sidecar*
   ornamen vektor melalui MCP, bukan pengganti canvas. Keduanya berbagi konvensi MCP yang
   sama, jadi session layer MCP yang sudah ada bisa dipakai ulang.

---

## 1. Satu canvas PhotoCraft untuk sisi A/B

### Temuan (berbasis kode)

- `CanvasEditor.tsx` memasang **satu** `<iframe src="/photocraft/index.html">` untuk seluruh
  editor; pergantian sisi hanya mengganti prop `sideId` dari `Home.tsx`. Jadi premis "satu
  canvas" sudah tercapai secara arsitektur.
- Yang terjadi saat pindah sisi hari ini:
  1. `usePhotoCraftRuntime` mendeteksi `sideId` baru → debounce 700 ms → **sync server penuh
     baru** (render produksi terukur ±7–12 detik).
  2. Snapshot baru tiba → `bridge.open(...)` → di Rust (`host_bridge.rs`), permintaan `open`
     selalu menjalankan `file.closeAll` terlebih dahulu → dokumen native sisi sebelumnya
     (termasuk edit yang belum dieskpor) **ditutup dan hilang**.
  3. Snapshot sisi lama dibuang dari state; kembali ke sisi A mengulang render dari nol.
- Aplikasi native **sudah mendukung multi-dokumen/tab**: `frame.rs` memakai
  `session.documents().len()`, komentar kode menyebut "Files opening in the background (#210)
  have tabs before they have documents", dan keberadaan perintah `file.closeAll` menyiratkan
  `open` secara default **menambah** tab, bukan mengganti.
- Event revisi native sudah membawa identitas dokumen (`document: DocId`) — host JS sudah bisa
  membedakan revisi milik sisi A atau B tanpa perubahan protokol.

### Rencana Fase 1 — TypeScript saja (tanpa rebuild WASM)

1. **Cache snapshot per sisi** di `usePhotoCraftRuntime`: `Map<SideId, { snapshot, hash }>`
   menggantikan state tunggal. Pindah ke sisi yang snapshot-nya sudah ada = `bridge.open`
   instan dari cache; refresh background tetap berjalan dengan skema
   stale-while-revalidate yang sudah ada.
2. **Hash konten per sisi** (nodes + stock + referensi aset + `includeBlangko`): kembali ke
   sisi yang tidak berubah tidak memicu sync sama sekali; sisi yang berubah hanya di-sync
   untuk sisi itu (payload per sisi sudah demikian).
3. **Pre-warm sisi pasif**: setelah sync awal sisi aktif selesai, jadwalkan sync sisi pasif
   di background (antrean server sudah serial, jadi tidak ada race; dibatalkan bila user
   mulai mengedit).
4. **Guard `nativeDirty` per sisi**: pindah sisi saat dokumen native kotor memunculkan
   konfirmasi (hari ini hilang diam-diam oleh `closeAll`).

Dampak: pindah sisi dari ±7–12 detik menjadi instan pada cache hit, dan tetap *live* saat
refresh berjalan.

### Rencana Fase 2 — bridge Rust multi-tab (rebuild WASM) — **TERIMPLEMENTASI + TERVERIFIKASI BROWSER (protokol 3)**

1. `HostRequest::Open` tanpa `file.closeAll`; open menambah/memakai tab per sisi. ✅
   (`open_automation_bytes` → `session.add_document` memang menambah tab dan mengaktifkannya.)
2. Request baru `activate { document }` dan `close { document }`; `command`/`export`/`inspect`
   menargetkan dokumen aktif, `inspect` juga menerima `document` opsional (by-id) sehingga
   write-back tetap akurat walau pengguna berpindah sisi di tengah debounce. Event revisi
   membawa `DocId`; dirty/baseline/write-back dilacak per dokumen (`NativeDocRecord`). ✅
3. Perilaku `open_automation_bytes` terverifikasi dari sumber: selalu tab baru via
   `session.add_document` (bukan menimpa), dokumen baru langsung aktif. ✅
4. Klik tab native di dalam canvas disinkronkan kembali ke sisi React (`onSideChange`)
   berdasarkan `DocId` pada event revisi. ✅
5. Anggaran memori: dua dokumen 600 ppi (A4 ≈ 4961 × 7016 px, ±140 MB RGBA per dokumen)
   diterima untuk sekarang; bila terbukti berat, dokumen non-aktif dapat di-*hibernate*
   (serialize + drop, reopen dari bytes yang sudah di-cache Fase 1) memakai request `close`.

## 2. Eliminasi UI yang redundan

### Prinsip otoritas (prasyarat keras)

| Lapisan | Peran hari ini |
| --- | --- |
| Dokumen kanonik JSON (`InvitationDocument`) | Sumber kebenaran: simpan tRPC, undo/redo, agen AG-UI, preflight, render server |
| Canvas native PhotoCraft (`.pcraft`) | Proyeksi *read-mostly*: edit native hanya menandai `nativeDirty` dan dieskpor manual; **tidak menulis balik** ke JSON |

Menghapus UI edit React sebelum ada write-back berarti menghapus satu-satunya jalur edit
yang persisten. Karena itu eliminasi dijadwalkan **setelah** mekanisme write-back berjalan.

### Keputusan per komponen

| UI React | Padanan native PhotoCraft | Keputusan |
| --- | --- | --- |
| Inspector tab **Objek** (posisi, ukuran, rotasi, opacity, tipografi, warna, clipping) | Properties panel + options bar native (lebih kaya) | **Eliminasi** setelah write-back |
| Inspector tab **Layer** (z-order, visibilitas, tambah/hapus) | Layers panel native | **Eliminasi** setelah write-back |
| Tombol Tambah teks/bidang | Type tool + shape tools native | **Eliminasi** bersama Inspector |
| Topbar **undo/redo** | Edit ▸ Undo/Redo + History panel native (per langkah engine) | **Eliminasi** setelah write-back |
| Toolbar canvas **PNG / .pcraft** | File ▸ Export native | **Pertahankan** (tipis, naming file terintegrasi; biaya hampir nol) |
| Inspector tab **Cetak** (preflight, proyeksi cetak) | Tidak ada | **Pertahankan** — pindahkan ke status bar / panel kiri agar panel kanan bisa hilang total |
| LeftPanel **Proyek** (stock, bleed, safe margin, lipatan, kalibrasi fisik, PPI, isi undangan) | Tidak ada (metadata domain cetak & input agen) | **Pertahankan** |
| LeftPanel **Aset**: unggah + analisis CV blangko (smart canvas) | Tidak ada | **Pertahankan** (diferensiasi platform) |
| LeftPanel **Aset**: daftar aset manual + tombol Sisipkan | Import gambar native; agen AG-UI sudah menempatkan lampiran lewat `handleUpload` | **Eliminasi bertahap** — sederhanakan menjadi daftar blangko saja |
| Tab **Agen** (AG-UI chat) | Tidak ada (PhotoCraft/VectorCraft tidak membawa AI) | **Pertahankan** (inti platform) |
| `ExportDialog` (PDF/PNG cetak full-PPI, master) | Ekspor native merender dari `.pcraft`, bukan dari kanonik | **Pertahankan** sampai `.pcraft` authoritative |
| Status simpan / tombol Simpan | Tidak ada (persistensi tRPC) | **Pertahankan** |

### Write-back native → kanonik (prasyarat eliminasi)

- **Opsi A (direkomendasikan, inkremental)**: pada event revisi native, minta `doc.inspect`,
  petakan layer `blangko-node:<id>` kembali ke patch `DesignNode` (geometri, opacity,
  visibilitas, properti teks), terapkan sebagai **satu revisi** `changeDocument` (undo utuh).
  Objek baru tanpa id diberi id saat write-back. Cakupan awal dibatasi pada properti yang
  sudah round-trip di parity test.
- **Opsi B (evaluasi lanjutan)**: `.pcraft` per sisi menjadi sumber kebenaran; JSON hanya
  menyimpan metadata cetak + semantik agen. Perubahan lebih besar; dievaluasi setelah
  transport MCP matang.

### Sampah yang wajib ikut dihapus saat eliminasi

- `Home.tsx`: `updateNode`, `deleteNode`, `duplicateNode`, `reorderNode`, `addNode`,
  handler keyboard `Delete`, proyeksi `selectedNodeId` ke native bila seleksi sepenuhnya
  milik native.
- `Inspector.tsx` (atau sisa tab Cetak yang dipindah), state `desktopRight`/`mobileRight`
  dan tombol panel kanan di topbar.
- CSS yatim: `.right-panel`, `.layer-*`, `.field-*`, `.empty-inspector`, `.issue*`, dan
  ikon `lucide-react` yang tidak lagi dipakai.
- Test yang menyentuh komponen tersebut; `git grep` nama komponen wajib nol sebelum commit.

## 3. PhotoCraft vs VectorCraft untuk canvas utama

| Kriteria | PhotoCraft | VectorCraft |
| --- | --- | --- |
| Model dokumen | Raster/photo compositing, PSD-like, Smart Object | Vektor, artboard, path/live effect |
| Kecocokan domain blangko | Foto ber-frame (Smart Object + clipping), latar raster, scan blangko — **pas** | Ornamen/ilustrasi vektor — niche |
| Resolusi cetak | Render penuh 300/600 ppi terbukti (A4 600 ppi ≈ 4961 × 7016 px, di bawah cap 40 MP) | `render_preview` dibatasi 4096 px sisi panjang — **di bawah kebutuhan 600 ppi** |
| Format native editable | `.pcraft` (Type, Shape, Smart Object) — sudah round-trip di parity test | `.vcraft`/SVG — belum ada integrasi |
| Otomatisasi | `photocraft-cli` RPC + MCP (session MCP sudah lulus parity test) | MCP 33 tools, konvensi `command_batch` yang sama |
| Investasi yang sudah ada | Fork WASM + host bridge + headless CLI + 47 test | Nol |

**Kesimpulan**: PhotoCraft tetap canvas utama — secara domain (raster print), secara resolusi,
dan secara biaya (semua infrastruktur sudah terbangun dan teruji). VectorCraft paling efisien
sebagai **sidecar MCP untuk ornamen vektor** (refine SVG ornamen → tempel sebagai Smart
Object), memakai ulang pola `PhotoCraftMcpSession` karena konvensi MCP-nya sama. Mengganti
canvas utama ke VectorCraft berarti mem-port model dokumen, bridge, dan kehilangan Smart
Object raster — biaya tinggi tanpa keuntungan untuk kasus undangan cetak.

## Urutan implementasi yang disarankan

1. Fase 1 cache per sisi + hash konten + pre-warm (TypeScript, risiko rendah).
2. Write-back native → kanonik (Opsi A) untuk properti yang sudah round-trip.
3. Eliminasi Inspector Objek/Layer + undo/redo topbar + pembersihan sampah terkait.
4. Fase 2 bridge multi-tab Rust (setelah eksplorasi `open_automation_bytes`).
5. Sidecar VectorCraft untuk ornamen (opsional, terpisah). ✅ — POC terimplementasi
   (`api/vectorcraft/`, transport MCP generik berbagi dengan PhotoCraft); detail di
   `docs/VECTORCRAFT-SIDECAR-POC.md`.
