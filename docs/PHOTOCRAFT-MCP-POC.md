# Desain teknis POC PhotoCraft MCP

## Tujuan dan batas

POC membuktikan bahwa sinkronisasi headless Blangko Editor dapat memakai MCP resmi PhotoCraft 0.23.1 tanpa mengubah `InvitationDocument`, compiler semantic, format manifest, API HTTP, atau iframe canvas.

- Transport `rpc` tetap menjadi default.
- Transport `mcp` dipilih secara opt-in melalui `PHOTOCRAFT_HEADLESS_TRANSPORT=mcp`.
- POC mencakup create, command execution, Smart Object placement, inspect, PNG preview, native `.pcraft`, dan close.
- VectorCraft, UI automation, desktop bridge, serta eksposur generic MCP tools kepada model berada di luar cakupan.

## Arsitektur

```text
HTTP /api/photocraft/sync
          │
          ▼
syncPhotoCraftRuntime (tidak berubah secara kontrak)
          │
          ▼
PhotoCraftHeadlessSession (request/getRoot/dispose)
       ┌──┴───┐
       │      │
       ▼      ▼
 RPC session  MCP session (opt-in)
  `serve`     `mcp --no-gpu`
       │      │
       └──────┴── resolvePhotoCraftLaunch + pinned glibc
```

`runtimeQueue` tetap mengunci seluruh transaksi dokumen. Setiap sesi memperoleh direktori sementara sendiri; read/write root dibatasi ke direktori tersebut. Asset ber-hash, staging dokumen baru, verifikasi hasil, dan `doc.close` pada `finally` tetap dipertahankan.

## Pemetaan operasi

| Operasi runtime | MCP |
| --- | --- |
| `doc.new` | `doc_new`, lalu `image.imageSize` dengan `resample: "none"` untuk PPI |
| `batch` / `engine.execute` | Kelompok contiguous `command_batch` dengan `stop_on_error: true` |
| `batch` / `doc.place` | `doc_place` pada posisi langkah yang sama |
| `doc.inspect` | `doc_inspect` |
| `doc.render` | `render_preview` dengan `max_side` |
| `doc.save` | `doc_save`, termasuk `pcraftFullComposite: false` |
| `doc.close` | `doc_close` |

PPI memerlukan langkah tambahan karena `doc_new` pada 0.23.1 tidak memiliki parameter `resolution`. Command `image.imageSize` dipanggil dengan ukuran piksel yang sama sehingga tidak terjadi resampling.

MCP `command_batch` tidak atomik. Adapter mengembalikan hasil per langkah kepada runtime; runtime menolak seluruh hasil bila ada langkah gagal dan menutup dokumen staging. Tidak ada dokumen parsial yang dipublikasikan.

## Konfigurasi dan kompatibilitas

```sh
PHOTOCRAFT_HEADLESS_TRANSPORT=rpc  # default
PHOTOCRAFT_HEADLESS_TRANSPORT=mcp  # POC
```

Nilai selain `rpc` dan `mcp` ditolak. Resolver binary, checksum, bundled glibc, font configuration, batas ukuran canvas/aset, dan batas waktu digunakan bersama oleh kedua transport.

Rollback cukup dengan mengembalikan konfigurasi ke `rpc`; tidak ada migrasi dokumen atau database.

## Kriteria penerimaan POC

1. Unit test membuktikan handshake MCP, pemetaan PPI, urutan command/Smart Object, render, save, dan close.
2. Kegagalan langkah batch tetap menghasilkan penolakan dan close.
3. `npm run check`, lint terarah, serta runtime tests tetap lulus.
4. Image produksi AMD64 dapat menjalankan `/api/photocraft/status` dan `/api/photocraft/sync` dengan `PHOTOCRAFT_HEADLESS_TRANSPORT=mcp`.
5. Hasil MCP berisi PNG valid, `.pcraft` non-trivial, native layer yang diharapkan, dan manifest `blangko.photocraft.semantic.v2`.
6. RPC tetap default; iframe canvas dan `InvitationDocument` tidak berubah.

## Hasil validasi

- Image produksi yang sebelumnya terbangun sebagai ARM64 sekarang terkunci pada AMD64.
- Transport RPC pada image produksi berhasil membuat PNG 11.036 byte dan `.pcraft` 39.230 byte dengan native layer.
- Transport MCP pada image yang sama berhasil membuat PNG komposit 12.349 byte dan `.pcraft` 82.199 byte yang mengandung Type, Shape, Smart Object, serta blangko.
- Seluruh 43 test pada 8 test files lulus; type-check dan lint terarah juga lulus.
- Semua kontainer pengujian dibersihkan setelah validasi.

## Setelah POC

Sebelum menjadikan MCP default, bandingkan RPC dan MCP pada fixture kaya yang sama: Type, Shape, Smart Object, clipping, opacity, rotation, lock, SVG, PNG, dan kedua pilihan PPI. Progress/cancellation dapat dipetakan kemudian melalui `jobs_list`, `jobs_cancel`, dan cancellation MCP setelah parity dasar terbukti.
