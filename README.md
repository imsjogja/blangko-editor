# Blangko Editor

Editor layout undangan berbasis blangko kosong dengan pemisahan tegas antara **referensi blangko** dan **desain isi yang dicetak**. Proyek ini merupakan vertical slice full-stack yang dapat digunakan: unggah aset, susun desain manual, minta proposal agen melalui AG-UI, tinjau proposal, lakukan preflight, lalu ekspor PDF/PNG pada ukuran fisik yang tepat.

## Alur utama

1. Pengguna membuat proyek dengan dua sisi: **Luar (A)** dan **Dalam (B)**.
2. Ukuran kertas, bleed, safe margin, posisi lipatan, dan resolusi ditetapkan dalam milimeter.
3. Blangko, foto, ornamen, atau denah diunggah ke object storage. Hanya storage key yang disimpan dalam dokumen.
4. Analisis browser membaca EXIF, JPEG JFIF, atau PNG pHYs untuk DPI, mengenali rasio ukuran standar, dan mencari kandidat lipatan melalui proyeksi edge. Smart canvas menyesuaikan ukuran kertas, node, tipografi, dan guides secara proporsional.
5. Pengguna dapat:
   - drag, resize, dan rotate objek;
   - mengatur teks, tipografi, italic, tracking, bentuk, oval clipping, warna, opacity, visibilitas, dan urutan layer;
   - menganalisis ulang blangko serta mengoreksi ukuran/lipatan secara manual;
   - menghapus aset dari proyek beserta node terkait, lalu membatalkannya dengan undo;
   - meminta proposal Modern, Rustic, atau Klasik melalui AG-UI;
   - meninjau lalu menerapkan proposal secara eksplisit.
6. Preflight memeriksa kalibrasi ukuran, objek keluar kertas, safe margin, jarak lipatan, aset hilang, dan teks terlalu kecil. Proposal agen juga membawa QA struktural 100 poin dengan hard gate; skor ini tidak menggantikan inspeksi visual atau mengubah status produksi menjadi print-ready.
7. Output diekspor sebagai:
   - **Cetak isi**: hanya node desain, tanpa blangko dan guides;
   - **Preview komposit**: blangko dan desain isi digabung untuk tinjauan visual;
   - **Master JSON**: dokumen domain tanpa presigned URL;
   - **PhotoCraft handoff**: `.pcraft` raster sisi aktif dan semantic manifest JSON melalui CLI server jika runtime tersedia.

## Stack

- React 19 + TypeScript + Vite
- Hono + tRPC 11
- Drizzle ORM + MySQL
- AG-UI Core event contracts melalui SSE
- AI SDK dengan model yang dipilih melalui `listModels()`
- Platform object storage, dengan aset gambar disalurkan kembali melalui endpoint proyek same-origin agar canvas dapat diekspor tanpa masalah CORS
- `pdf-lib` + Canvas 2D untuk output raster pada halaman berukuran fisik
- PWA dengan auto-update dan navigasi HTML `NetworkOnly`

## Arsitektur

```text
React Workspace
├── Domain Canvas (runtime editor aktif)
├── AG-UI SSE → Agent Orchestrator → proposal → human approval
├── tRPC → Project / Asset API → MySQL
├── Same-origin Asset Route → Object Storage
├── Browser CV → ukuran fisik/estimasi + kandidat lipatan → Smart Canvas
└── PhotoCraft CLI Adapter → raster .pcraft + semantic manifest
```

Sumber kebenaran adalah dokumen undangan ber-Zod di `contracts/invitation.ts`, bukan struktur internal editor. Seluruh posisi dan dimensi node disimpan dalam milimeter.

### Proyeksi cetak

- `composite`: grup `__BLANGKO__`, `__CONTENT__`, dan `__GUIDES__` untuk referensi.
- `content-only`: hanya grup `__CONTENT__` yang printable.

### AG-UI

`POST /api/agent/run` mengirim event:

- `RUN_STARTED`
- `STATE_SNAPSHOT`
- `STEP_STARTED` / `STEP_FINISHED`
- `CUSTOM` untuk progres dan `blangko.design.proposal`
- `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END`
- `RUN_FINISHED` atau `RUN_ERROR`

Proposal tidak pernah langsung menimpa canvas. Pengguna harus memilih **Terapkan proposal**. Nama pasangan, tanggal, dan venue diambil dari data proyek saat node proposal dibentuk sehingga model tidak dapat mengubah fakta acara.

Jika model belum diprovisikan, tersedia generator deterministik berlabel **SKILL**. Gangguan atau kuota AI tidak dicoba ulang otomatis untuk menghindari potensi penagihan ganda.

### Design Director yang diadaptasi

Prinsip paket `blanko-design-director` diterapkan ke arsitektur aplikasi, bukan menggantikan canonical `InvitationDocument` dengan schema upload:

- compiler membentuk peta panel dari lipatan vertikal dan horizontal;
- sisi luar memiliki cover serta panel kutipan/monogram, sedangkan sisi dalam memiliki pembuka serta rincian acara;
- foto oval, frame, date pill, kartu rincian, divider, monogram, dan aksen botanical tetap berupa semantic nodes yang editable;
- nama, tanggal, dan venue selalu dibaca dari dokumen; generator tidak menambahkan waktu, orang tua, akad, resepsi, atau alamat yang tidak tersedia;
- model menerima metadata CV dan peta panel, bukan piksel blangko, sehingga prompt melarang klaim inspeksi gambar yang tidak terjadi;
- `baseNodeIds` membatasi penggantian saat proposal diterapkan sehingga node yang dibuat setelah proposal tetap dipertahankan;
- `approved-for-preview` tidak diberikan otomatis. Proposal baru berstatus `needs-visual-review` jika skor struktur ≥85 dan seluruh hard gate lolos; status produksinya tetap `not-print-ready`.

## Menjalankan proyek

```bash
npm install
npm run db:push
npm run dev
```

Server pengembangan tersedia di `http://localhost:3000`.

Untuk produksi:

```bash
npm run check
npm test
npm run build
npm start
```

Build backend dibundel ke `dist/boot.js`; frontend berada di `dist/public/`.

## Konfigurasi

Gunakan `.env.example` sebagai daftar variabel, lalu sediakan nilai melalui environment deployment. Jangan commit `.env`.

- `DATABASE_URL`: koneksi MySQL.
- `APP_ID`: identitas aplikasi untuk atribusi gateway.
- `APP_SECRET`: secret sesi dari scaffold.
- `KIMI_AGENTGW_BASE_URL` dan `KIMI_AGENTGW_API_KEY`: konfigurasi AI server-side.
- `KIMI_STORAGE_RESOURCE_ID`: resource object storage.
- `PHOTOCRAFT_CLI_BIN`: path opsional ke executable `photocraft-cli` pada server. Jika tidak diisi, adapter mencari `photocraft-cli` di `PATH`. File AppImage otomatis dijalankan dengan prefix `--cli`.

API key gateway tidak pernah dikirim ke browser. Model ID tidak di-hardcode. Jangan menaruh binary PhotoCraft atau file pengguna di repository.

### PhotoCraft CLI

Adapter menyediakan `GET /api/photocraft/status` dan `POST /api/photocraft/handoff`. Handoff menjalankan perintah berikut tanpa shell, dengan timeout 60 detik dan pembersihan direktori sementara:

```bash
photocraft-cli run canvas.png --out document.pcraft
```

Input dibatasi pada PNG 32 MB. Jika binary belum terpasang, status endpoint dan dialog ekspor secara eksplisit melaporkan runtime tidak tersedia; tombol handoff dinonaktifkan. Output saat ini berupa raster `.pcraft` plus semantic manifest, **bukan** rekonstruksi layer editable penuh.

## Pemeriksaan

```bash
npm run check       # TypeScript project references
npm run lint        # ESLint
npm test            # domain, CV/DPI, smart canvas, CLI process, proposal, AI contract
npm run build       # frontend + bundled backend
npm audit --omit=dev
```

Pengujian browser yang telah dilakukan pada vertical slice mencakup create/reload/autosave, optimistic revision conflict, upload/readback storage, AG-UI SSE, AI structured output, human approval, drag/resize/rotate, undo/redo, sidebar desktop dan mobile drawer, analisis blangko bawaan/upload, smart resize, remove/undo aset, serta ekspor PDF/PNG/master. Handoff PhotoCraft juga diuji end-to-end dengan executable tiruan; keberadaan dan kompatibilitas binary PhotoCraft asli tetap harus diverifikasi pada environment deployment.

## Struktur penting

```text
contracts/invitation.ts       Skema dokumen, node, proposal, dan preflight
contracts/smart-canvas.ts     Resize proporsional, analisis, dan remove aset
contracts/photocraft.ts       Compiler semantic command PhotoCraft
api/photocraft/runtime.ts     Process runner CLI dengan timeout dan cleanup
api/routes/photocraft.ts      Status dan handoff PhotoCraft
api/routes/agent.ts           AG-UI SSE dan orkestrasi proposal
api/design.ts                 Design director, panel map, dan compiler layout editable
api/design-quality.ts         QA struktural 100 poin dan hard gate proposal
api/project-router.ts         Project CRUD dan upload aset
api/routes/project-assets.ts  Read-only same-origin asset delivery
api/queries/projects.ts       Drizzle queries dan optimistic revision
src/pages/Home.tsx            State workspace, history, autosave, AG-UI client
src/components/editor/       Canvas, panel proyek, inspector, ekspor
src/lib/blangko-analysis.ts   Metadata DPI dan proyeksi edge untuk lipatan
src/lib/photocraft-runtime.ts Client status/handoff dan unduhan output
src/lib/export.ts             Renderer Canvas 2D, PDF, PNG, master JSON
```

## Batas implementasi saat ini

- **PhotoCraft belum menjadi runtime editor dan binary asli belum dibundel.** Integrasi awal menyediakan CLI handoff raster dan semantic manifest; editable layers penuh serta WASM canvas belum diterapkan.
- **Analisis blangko bersifat decision support.** Metadata DPI menghasilkan ukuran fisik terukur, tetapi rasio standar/aspect-preserved tetap berupa estimasi. Kandidat lipatan dari CV dan fallback heuristic harus diperiksa terhadap blangko fisik sebelum produksi.
- **QA proposal bersifat struktural.** Skor tinggi tidak membuktikan estetika, keterbacaan aktual, kesesuaian warna dengan blangko, atau kesiapan produksi. Tinjau komposit secara visual dan lakukan verifikasi fisik terpisah.
- PDF berisi raster 300/600 ppi pada halaman berukuran tepat. Ini **belum PDF/X**, belum separasi CMYK, dan teks tidak berupa vektor.
- Backend saat ini db-only tanpa autentikasi. Project UUID cocok untuk MVP anonim, tetapi autentikasi, ownership, dan otorisasi perlu ditambahkan sebelum multi-user produksi.
- Runtime AI, object storage, dan situs yang dipublikasikan dapat menggunakan kuota pemilik situs serta menimbulkan biaya sesuai penggunaan.
