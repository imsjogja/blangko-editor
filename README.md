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
   - **PhotoCraft native**: `.pcraft` sisi aktif dengan Type, Shape, dan Smart Object yang tetap editable, disertai semantic manifest v2.

## Stack

- React 19 + TypeScript + Vite
- Hono + tRPC 11
- Drizzle ORM + MySQL
- AG-UI Core event contracts melalui SSE
- AI SDK dengan model yang dipilih melalui `listModels()`
- Platform object storage, dengan aset gambar disalurkan kembali melalui endpoint proyek same-origin agar canvas dapat diekspor tanpa masalah CORS
- `pdf-lib` + Canvas 2D untuk output PNG/PDF umum pada halaman berukuran fisik
- PhotoCraft CLI resmi 0.23.1 sebagai headless editing/render engine melalui persistent JSON-lines RPC
- PWA dengan auto-update dan navigasi HTML `NetworkOnly`

## Arsitektur

```text
React Workspace
├── PhotoCraft engine render + semantic node proxies → drag / resize / rotate
├── Local Domain Canvas → fallback yang diberi label saat engine nonaktif/gagal
├── AG-UI SSE → Agent Orchestrator → proposal → human approval
├── tRPC → Project / Asset API → MySQL
├── Same-origin Asset Route → Object Storage
├── Browser CV → ukuran fisik/estimasi + kandidat lipatan → Smart Canvas
└── Canonical document → native command compiler → persistent PhotoCraft RPC
    ├── PNG preview otoritatif untuk canvas
    └── Native .pcraft + semantic manifest v2
```

Sumber kebenaran adalah dokumen undangan ber-Zod di `contracts/invitation.ts`, bukan struktur internal editor. Seluruh posisi dan dimensi node disimpan dalam milimeter.

### Proyeksi cetak

- `composite`: frame `__BLANGKO__` terkunci dirender di belakang node konten; guides tetap berupa overlay DOM yang tidak dicetak.
- `content-only`: hanya node konten native yang dibuat, tanpa layer blangko maupun guides.
- Semantic manifest mempertahankan pengelompokan `__BLANGKO__`, `__CONTENT__`, dan `__GUIDES__` untuk interoperabilitas domain.

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

Build backend dibundel ke `dist/boot.js`, frontend berada di `dist/public/`, dan runtime resmi disalin ke `dist/vendor/photocraft/`. `Dockerfile` menyediakan cold build berbasis Node 22 Bookworm tanpa kebutuhan `node_modules` pada tahap runtime.

## Konfigurasi

Gunakan `.env.example` sebagai daftar variabel, lalu sediakan nilai melalui environment deployment. Jangan commit `.env`.

- `DATABASE_URL`: koneksi MySQL.
- `APP_ID`: identitas aplikasi untuk atribusi gateway.
- `APP_SECRET`: secret sesi dari scaffold.
- `KIMI_AGENTGW_BASE_URL` dan `KIMI_AGENTGW_API_KEY`: konfigurasi AI server-side.
- `KIMI_STORAGE_RESOURCE_ID`: resource object storage.
- `PHOTOCRAFT_CLI_BIN`: path opsional ke executable `photocraft-cli` atau AppImage pada server. Tanpa variabel ini, Linux x86_64 memakai runtime resmi yang sudah dipin di `vendor/photocraft/`; platform lain harus menyediakan binary kompatibel melalui variabel ini.

API key gateway tidak pernah dikirim ke browser dan model ID tidak di-hardcode. File pengguna tetap berada di object storage, bukan repository. Runtime PhotoCraft bawaan disertai checksum SHA-256, provenance rilis, serta lisensi MIT/Apache-2.0.

### PhotoCraft sebagai editor runtime

Canonical `InvitationDocument` dikompilasi ke command resmi PhotoCraft, bukan ke raster perantara:

- text menjadi native Type layer;
- shape menjadi native Shape layer;
- gambar menjadi frame berisi Smart Object, dengan dukungan ellipse dan rounded clipping;
- opacity, rotation, visibility, ordering, dan locking diterjemahkan ke engine command;
- blangko hanya dibuat pada proyeksi komposit sebagai frame `__BLANGKO__` terkunci.

Server menyediakan:

- `GET /api/photocraft/status` untuk capability dan versi runtime;
- `POST /api/photocraft/sync` untuk membuat preview PNG dari engine;
- `POST /api/photocraft/handoff` untuk membuat native `.pcraft` dan semantic manifest v2.

`photocraft-cli serve --no-gpu` berjalan sebagai persistent session melalui stdio JSON-lines dengan `shell:false`. Seluruh transaksi dokumen dieksekusi eksklusif agar dokumen aktif tidak tertukar oleh request bersamaan. Aset dibatasi 32 MB per file, canvas 40 juta piksel, dan preview maksimum 2400 px. Workspace sementara dibersihkan saat session ditutup.

Frontend menampilkan PNG dari engine sebagai visual otoritatif, sedangkan semantic nodes transparan mempertahankan seleksi serta Moveable. Sinkronisasi memakai debounce 450 ms, pembatalan request lama, dan sequence guard. Jika engine dimatikan atau gagal, editor kembali ke canvas lokal dengan status yang terlihat jelas.

Paket WebAssembly resmi juga sudah diaudit. Paket tersebut menjalankan aplikasi egui penuh, tetapi tidak menyediakan JavaScript bridge untuk sinkronisasi dokumen, command, dan seleksi dari host React. Karena itu integrasi ini memakai headless engine resmi, bukan iframe WASM yang tidak dapat disinkronkan.

## Pemeriksaan

```bash
npm run check       # TypeScript project references
npm run lint        # ESLint
npm test            # domain, CV/DPI, compiler, RPC, real engine, proposal, AI contract
npm run build       # frontend + bundled backend + pinned PhotoCraft runtime
npm audit --omit=dev
```

Pengujian browser mencakup create/reload/autosave, optimistic revision conflict, upload/readback storage, AG-UI SSE, AI structured output, human approval, drag/resize/rotate, undo/redo, sidebar desktop dan mobile drawer, analisis blangko bawaan/upload, smart resize, remove/undo aset, serta ekspor PDF/PNG/master. Integrasi runtime juga diverifikasi dengan binary resmi: render komposit dan content-only, transformasi melalui node proxy, native download, serta read-back `.pcraft` untuk memastikan Type/Shape/Smart Object dan manifest v2. Test suite mencakup fake RPC untuk kegagalan/konkurensi dan regresi engine nyata untuk komposisi kaya.

## Struktur penting

```text
contracts/invitation.ts       Skema dokumen, node, proposal, dan preflight
contracts/smart-canvas.ts     Resize proporsional, analisis, dan remove aset
contracts/photocraft.ts       Compiler semantic manifest dan native engine commands
api/photocraft/session.ts     Persistent RPC, antrean request, binary checksum, cleanup
api/photocraft/runtime.ts     Transaksi dokumen, render, native save, concurrency guard
api/routes/photocraft.ts      Status, sinkronisasi canvas, dan native handoff
api/routes/agent.ts           AG-UI SSE dan orkestrasi proposal
api/design.ts                 Design director, panel map, dan compiler layout editable
api/design-quality.ts         QA struktural 100 poin dan hard gate proposal
api/project-router.ts         Project CRUD dan upload aset
api/routes/project-assets.ts  Read-only same-origin asset delivery
api/queries/projects.ts       Drizzle queries dan optimistic revision
src/pages/Home.tsx            State workspace, history, autosave, AG-UI client
src/components/editor/       Canvas, panel proyek, inspector, ekspor
src/lib/blangko-analysis.ts   Metadata DPI dan proyeksi edge untuk lipatan
src/lib/photocraft-runtime.ts Asset collection, sync client, native download
src/lib/export.ts             Renderer Canvas 2D, PDF, PNG, master JSON
vendor/photocraft/           Runtime resmi ter-pin, checksum, lisensi, atribusi
```

## Batas implementasi saat ini

- **Runtime editor menggunakan headless PhotoCraft resmi, bukan WASM canvas yang di-embed.** Sinkronisasi saat ini membangun ulang dokumen per perubahan, belum incremental command diff. Binary bawaan khusus Linux x86_64; platform lain memerlukan `PHOTOCRAFT_CLI_BIN`.
- **Font harus tersedia pada host runtime.** PhotoCraft melaporkan warning dan memakai fallback jika font dokumen tidak terpasang; native `.pcraft` tetap menyimpan nama font semantik.
- **PNG/PDF umum masih memakai exporter lokal.** Native `.pcraft` memakai PhotoCraft, sedangkan PNG/PDF pada dialog umum belum dirender melalui engine.
- **Analisis blangko bersifat decision support.** Metadata DPI menghasilkan ukuran fisik terukur, tetapi rasio standar/aspect-preserved tetap berupa estimasi. Kandidat lipatan dari CV dan fallback heuristic harus diperiksa terhadap blangko fisik sebelum produksi.
- **QA proposal bersifat struktural.** Skor tinggi tidak membuktikan estetika, keterbacaan aktual, kesesuaian warna dengan blangko, atau kesiapan produksi. Tinjau komposit secara visual dan lakukan verifikasi fisik terpisah.
- PDF berisi raster 300/600 ppi pada halaman berukuran tepat. Ini **belum PDF/X**, belum separasi CMYK, dan teks tidak berupa vektor.
- Backend saat ini db-only tanpa autentikasi. Project UUID cocok untuk MVP anonim, tetapi autentikasi, ownership, dan otorisasi perlu ditambahkan sebelum multi-user produksi.
- Runtime AI, object storage, dan situs yang dipublikasikan dapat menggunakan kuota pemilik situs serta menimbulkan biaya sesuai penggunaan.
