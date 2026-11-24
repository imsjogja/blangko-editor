# Blangko Editor

Editor layout undangan berbasis blangko kosong dengan pemisahan tegas antara **referensi blangko** dan **desain isi yang dicetak**. Proyek ini merupakan vertical slice full-stack yang dapat digunakan: unggah aset, susun desain manual, minta proposal agen melalui AG-UI, tinjau proposal, lakukan preflight, lalu ekspor PDF/PNG pada ukuran fisik yang tepat.

## Alur utama

1. Pengguna membuat proyek dengan dua sisi: **Luar (A)** dan **Dalam (B)**.
2. Ukuran kertas, bleed, safe margin, posisi lipatan, dan resolusi ditetapkan dalam milimeter.
3. Blangko, foto, ornamen, atau denah diunggah ke object storage. Hanya storage key yang disimpan dalam dokumen.
4. Pengguna dapat:
   - drag, resize, dan rotate objek;
   - mengatur teks, tipografi, warna, opacity, visibilitas, dan urutan layer;
   - meminta proposal Modern, Rustic, atau Klasik melalui AG-UI;
   - meninjau lalu menerapkan proposal secara eksplisit.
5. Preflight memeriksa kalibrasi ukuran, objek keluar kertas, safe margin, jarak lipatan, aset hilang, dan teks terlalu kecil.
6. Output diekspor sebagai:
   - **Cetak isi**: hanya node desain, tanpa blangko dan guides;
   - **Preview komposit**: blangko dan desain isi digabung untuk tinjauan visual;
   - **Master JSON**: dokumen domain tanpa presigned URL.

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
└── Semantic PhotoCraft Adapter → integrasi WASM/CLI berikutnya
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

API key gateway tidak pernah dikirim ke browser. Model ID tidak di-hardcode.

## Pemeriksaan

```bash
npm run check       # TypeScript project references
npm run lint        # ESLint
npm test            # domain, preflight, proposal, PhotoCraft projection, AI SDK contract
npm run build       # frontend + bundled backend
npm audit --omit=dev
```

Pengujian browser yang telah dilakukan pada vertical slice mencakup create/reload/autosave, optimistic revision conflict, upload/readback storage, AG-UI SSE, AI structured output, human approval, drag/resize/rotate, undo/redo, mobile drawer, serta ekspor PDF/PNG/master.

## Struktur penting

```text
contracts/invitation.ts       Skema dokumen, node, proposal, dan preflight
contracts/photocraft.ts       Compiler semantic command PhotoCraft
api/routes/agent.ts           AG-UI SSE dan orkestrasi proposal
api/design.ts                 Skill deterministik dan sanitasi arahan AI
api/project-router.ts         Project CRUD dan upload aset
api/routes/project-assets.ts  Read-only same-origin asset delivery
api/queries/projects.ts       Drizzle queries dan optimistic revision
src/pages/Home.tsx            State workspace, history, autosave, AG-UI client
src/components/editor/       Canvas, panel proyek, inspector, ekspor
src/lib/export.ts             Renderer Canvas 2D, PDF, PNG, master JSON
```

## Batas implementasi saat ini

- **PhotoCraft belum menjadi runtime editor.** `contracts/photocraft.ts` baru menyediakan semantic adapter; runtime WASM/CLI PhotoCraft yang dipin belum dihubungkan.
- **Analisis blangko berbasis computer vision belum tersedia.** Deteksi otomatis ukuran fisik, lipatan, dan sisi masih memerlukan kalibrasi/konfirmasi pengguna.
- PDF berisi raster 300/600 ppi pada halaman berukuran tepat. Ini **belum PDF/X**, belum separasi CMYK, dan teks tidak berupa vektor.
- Backend saat ini db-only tanpa autentikasi. Project UUID cocok untuk MVP anonim, tetapi autentikasi, ownership, dan otorisasi perlu ditambahkan sebelum multi-user produksi.
- Runtime AI, object storage, dan situs yang dipublikasikan dapat menggunakan kuota pemilik situs serta menimbulkan biaya sesuai penggunaan.
