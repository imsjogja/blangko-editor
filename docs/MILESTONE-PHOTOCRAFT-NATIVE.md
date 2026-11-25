# Milestone: AG-UI dan PhotoCraft Native Canvas

Tanggal checkpoint: 2026-11-25

Repository tujuan: `https://github.com/imsjogja/blangko-editor.git`

Commit integrasi lokal: `6b2e106` (`feat: integrate AG-UI proposals and PhotoCraft native canvas`)

## 1. Tujuan milestone

Melanjutkan implementasi pada mesin dengan kapasitas memori lebih besar tanpa kehilangan konteks, tanpa mengulang riset, dan tanpa menganggap artefak yang belum lulus QA sebagai selesai.

Target akhir tetap:

- Blangko menjadi referensi visual immutable dan tidak ikut tercetak.
- Desain isi menjadi satu-satunya layer yang dicetak di atas blangko fisik.
- PhotoCraft fork menjadi main canvas/workspace, menggantikan canvas React lama.
- AG-UI menyediakan agentic chat, attachment, riwayat pesan, cancel, runtime events, dan generative UI.
- Proposal desain dan ornamen hanya masuk dokumen setelah persetujuan pengguna.
- Native Type, Shape, Smart Object, ekspor `.pcraft`, PNG, dan runtime glibc publik tetap dipertahankan.

## 2. Yang sudah masuk commit

### AG-UI dan generative UI

- Route agent untuk `welcome`, `design`, dan `ornament`.
- `HttpAgent` AG-UI 1.0 dan `UserMessage` dengan `ContentPart[]` untuk teks/gambar.
- `ACTIVITY_SNAPSHOT` dirender sebagai UI aplikasi.
- Enam preset desain: Editorial Minimal, Retro Modern, Botanical Fine Art, Organic Arch, Heritage Crest, dan Neutral Greenery.
- Ornament Studio menghasilkan structured vector direction yang dikompilasi menjadi SVG pasif.
- Approval wajib melalui `Terapkan proposal` atau `Sisipkan`.
- Attachment PNG/JPEG/WebP, maksimal empat file per prompt.
- Persistent run error dan penghentian spinner setelah error.
- Model AI dipilih melalui `listModels()`; tidak ada model ID atau gateway URL hardcoded.

### PhotoCraft fork

- Upstream: `storytold/photocraft` versi `0.23.1`.
- Upstream commit: `e56522780f4e00722703775862dd3fca8bd30a78`.
- Overlay fork berada di `vendor/photocraft-fork/apps/photocraft-web`.
- Metadata fork berada di `vendor/photocraft-fork/source.json`.
- Iframe same-origin `/photocraft/index.html` menjadi main canvas.
- Bridge memakai `postMessage` dan `CustomEvent` dengan channel `blangko-photocraft`.
- Native document open, `Session.execute()`, selection/revision event, PNG export, dan `.pcraft` export sudah diimplementasikan pada source.
- Revision membawa `(DocId, revision)` dan `pixel_revision` agar pergantian dokumen dan edit konten tidak tertukar dengan seleksi/view revision.
- `egui::Context::request_repaint()` memproses pesan host tanpa menunggu mouse event.
- Native dirty state dan canonical-pending guard mencegah edit WASM tertimpa diam-diam.
- Fitur HEIF tidak diaktifkan pada build web; input aplikasi dibatasi PNG/JPEG/WebP.
- Canvas React/native lama sudah dinonaktifkan sebagai workspace utama; dependency `react-moveable` dihapus.

### Validasi yang sudah lulus

- `npm run check`.
- `npm run lint`.
- `git diff --check`.
- `npm test`: 7 test files, 41 tests.
- Real AI design run dan ornament run sebelumnya berhasil.
- Proposal berisi objek editable dan tidak diterapkan sebelum approval.
- Attachment tersimpan sebagai asset dan dapat dipakai pada prompt desain.
- Undo ornamen berhasil; Redo tersedia.

Catatan: skor structural QA bukan bukti estetika, die-cut readiness, atau print readiness. Organic Arch adalah struktur visual, bukan klaim bentuk potong fisik.

## 3. Yang belum selesai dan tidak boleh dianggap berhasil

- `public/photocraft/index.html`, JS loader, WASM final, dan `fork.json` belum dikemas lengkap.
- Main canvas WASM belum lulus browser QA.
- Native open/select/edit/export belum dibuktikan end-to-end pada browser dengan paket final.
- Native edit belum memiliki semantic read-back penuh ke `InvitationDocument`.
- `npm run build`, production smoke test, MIME WASM, dan fresh-browser zero-console-error belum diverifikasi pada tree final.
- Versi website belum disimpan melalui version manager pada kondisi final.
- Situs belum dipublikasikan dari milestone ini.
- Push ke GitHub masih memerlukan autentikasi repository yang valid.

## 4. Checkpoint build di luar Git

File berikut berada di `/mnt/agents/.work/photocraft-artifacts/` dan **tidak ikut commit**:

| File | Ukuran byte | Fungsi |
| --- | ---: | --- |
| `photocraft-web-raw.wasm` | 155953023 | Hasil Cargo `wasm-release`, sebelum optimasi |
| `photocraft-web-preopt.wasm` | 79742966 | Hasil `wasm-opt -O1` |
| `photocraft-web-bindgen.wasm` | 69843536 | Hasil `wasm-opt -Oz`, input bindgen terkecil saat ini |

Toolchain cache juga berada di luar Git:

```text
/mnt/agents/.work/toolchain-cache/
```

Isinya mencakup Rust host yang dipecah menjadi tiga bagian, Rust WASM standard library, Trunk, Binaryen 131, wasm-bindgen 0.2.128, dan wasm-bindgen 0.2.130. Cache besar tidak boleh di-commit ke repository.

Jika berpindah mesin, pilihan yang paling bersih adalah membangun ulang dari source. Jika ingin memakai checkpoint WASM, salin direktori artefak secara terpisah ke storage mesin baru. Jangan menganggap folder `.work` ikut dalam `git clone`.

Integritas checkpoint dapat diverifikasi dengan file `SHA256SUMS` di direktori artefak:

```bash
cd /mnt/agents/.work/photocraft-artifacts
sha256sum -c SHA256SUMS
```

## 5. Blocker resource dan diagnosis

Sandbox saat ini memiliki sekitar 3941 MiB RAM dan tidak memiliki swap.

Yang sudah terbukti:

1. Cargo release selesai dalam 18 menit 18 detik.
2. Raw WASM berukuran sekitar 156 MB berhasil dibuat.
3. `wasm-opt -O1` berhasil dan menurunkan ukuran menjadi sekitar 79,7 MB.
4. `wasm-opt -Oz` berhasil dan menurunkan ukuran menjadi sekitar 69,8 MB.
5. `wasm-bindgen` x86_64 pada input 79,7 MB mendapat `SIGKILL`.
6. Bindgen langsung pada input 69,8 MB juga menyebabkan restart sandbox/OOM; tidak ada output bindgen yang valid.
7. Opsi `--no-demangle` tidak menyelesaikan masalah memori.
8. Percobaan membangun bindgen 32-bit berhasil melewati dependency setelah `--no-default-features`, tetapi link akhir gagal dengan `rust-lld: error: unknown emulation: 32`. Jalur ini hanya eksperimen untuk resource kecil dan tidak perlu dilanjutkan pada runner 16 GB.

Trunk membaca versi internal artefak sebagai wasm-bindgen `0.2.128`. `Cargo.lock` source saat ini juga harus diperiksa pada mesin lanjutan karena sebelumnya menunjukkan `0.2.130`; jangan mengganti versi CLI secara paksa tanpa memverifikasi WASM yang benar-benar dibangun.

## 6. Resource yang disarankan

Untuk melanjutkan tanpa eksperimen pengurangan memori:

- RAM: **16 GB disarankan**; 8 GB sebagai minimum percobaan.
- CPU: 4 core atau lebih.
- Disk bebas: 30 GB atau lebih untuk Cargo registry, Git checkout, target release, dan artefak.
- Node.js 20.
- Rust 1.100.0 dengan target `wasm32-unknown-unknown`.
- Trunk 0.22.2.
- Binaryen/wasm-opt 131.
- wasm-bindgen yang cocok dengan metadata WASM hasil build.

Jangan menjalankan browser QA bersamaan dengan bindgen pada mesin 4 GB. Pada mesin 16 GB, gunakan pipeline normal x86_64 terlebih dahulu.

## 7. Cara melanjutkan dengan GitHub Actions

Commit `6b2e106` sudah memuat `.github/workflows/photocraft-fork.yml`.

Workflow tersebut:

- Berjalan pada `ubuntu-latest`.
- Memasang Rust 1.100.0 dan target WASM.
- Memasang Node 20 dan Trunk 0.22.2.
- Menjalankan `npm ci` dan `npm run photocraft:fork`.
- Meng-commit hasil `public/photocraft` hanya ke branch `build/photocraft-fork` dengan marker `[skip ci]`.

Setelah autentikasi tersedia:

```bash
git push -u origin build/photocraft-fork
```

Push branch tersebut akan memicu workflow. Workflow juga dapat dijalankan manual melalui `workflow_dispatch` setelah branch tersedia di GitHub.

Setelah workflow selesai:

```bash
git fetch origin
git switch build/photocraft-fork
git pull --ff-only
```

Periksa commit bot terbaru, salin/merge hasil ke workspace QA, lalu jalankan seluruh kriteria pada bagian 9. Jangan merge ke `main` hanya karena workflow hijau; browser QA tetap wajib.

## 8. Cara melanjutkan pada mesin self-hosted yang lebih besar

```bash
git clone https://github.com/imsjogja/blangko-editor.git
cd blangko-editor
git switch build/photocraft-fork
npm ci

rustup toolchain install 1.100.0
rustup target add wasm32-unknown-unknown --toolchain 1.100.0

mkdir -p .tools
curl -fL --retry 5 --retry-all-errors \
  https://github.com/trunk-rs/trunk/releases/download/v0.22.2/trunk-x86_64-unknown-linux-gnu.tar.gz \
  -o .tools/trunk.tar.gz
tar -xzf .tools/trunk.tar.gz -C .tools

export TRUNK="$PWD/.tools/trunk"
export RAYON_NUM_THREADS=1
npm run photocraft:fork
```

`scripts/build-photocraft-fork.mjs` melakukan pre-optimasi O1 sebelum bindgen. Pada mesin 16 GB, biarkan Trunk mengunduh wasm-bindgen yang sesuai dengan metadata WASM. Jika registry crates.io lambat, mirror sparse dapat dikonfigurasi tanpa mengubah source aplikasi.

## 9. Kriteria QA kelulusan berikutnya

### Paket fork

Pastikan tersedia dan valid:

- `public/photocraft/index.html`.
- JS loader dan JS glue wasm-bindgen.
- WASM final non-kosong.
- `fork.json`.
- `LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE`, dan `ATTRIBUTION.md`.
- `public/photocraft/fonts/manifest.txt` dan font WASM.
- Tidak ada `.trunk-lock` tersisa.

### Browser native

Jalankan development preview dan QA `scripts/qa-photocraft-native.js` dengan Playwright. Buktikan:

1. Project dan `.pcraft` aktif terbuka.
2. Loading overlay hilang dan canvas siap.
3. Seleksi layer melalui Inspector menghasilkan native revision dengan `selected`.
4. Seleksi tidak membuat status `belum diekspor`.
5. Edit opacity melalui `layer.layerStyle.blendingOptions` berhasil.
6. `pixelRevision` berubah dan native dirty tampil.
7. Toggle `Blangko` menampilkan `Versi proyek tertunda · Muat` tanpa mengganti native dirty document.
8. Ekspor `.pcraft` berhasil dan file berisi data native non-kosong.
9. Ekspor PNG berhasil, memiliki PNG magic, dan dimensi valid.
10. Versi project dapat dimuat setelah ekspor.
11. Tidak ada console error atau page error yang tidak dijelaskan.

Unduhan QA dapat diarahkan dengan environment `PHOTOCRAFT_QA_DIR`; default-nya `/mnt/agents/.work`.

### Finalisasi

```bash
npm run check
npm run lint
npm test
git diff --check
npm run build
```

Setelah itu:

- Verifikasi `dist/public/photocraft` dan MIME `application/wasm`.
- Jalankan `npm start` pada port terpisah.
- Ulangi smoke test dengan fresh browser.
- Simpan versi melalui website version manager.
- Publish hanya setelah QA final; jangan menyatakan situs live sebelum aksi Publish berhasil.

## 10. Batasan yang harus tetap didokumentasikan

- Native edit diekspor melalui toolbar native.
- Native edit belum dikonversi kembali menjadi semantic `InvitationDocument` penuh.
- Versi canonical yang lebih baru tidak boleh menimpa native dirty state secara diam-diam.
- Blangko referensi tidak ikut tercetak pada proyeksi `content-only`.
- Struktur valid tidak sama dengan desain estetis atau print-ready.

## 11. Keamanan dan data

- Jangan menampilkan, menyalin, atau meng-commit nilai dari `.env`, environment, atau process listing.
- `KIMI_AGENTGW_API_KEY` hanya boleh berada di server.
- Jangan meminta API key Kimi dari pengguna.
- Jangan menulis gateway URL atau model ID hardcoded.
- Jangan mengubah nilai `.env` hasil scaffold.
- Jangan menyimpan file pengguna di repo, database blob, atau `localStorage`.
- Simpan storage key, bukan presigned URL.
- Jangan menambahkan endpoint delete storage publik.
- Jangan mengekspor secret ke browser atau log.
- Runtime AI, object storage, dan published site dapat memakai kuota pemilik situs; jangan menyebutnya gratis.
- Jangan menjalankan `npm audit fix --force` atau destructive database operation secara membabi buta.

## 12. Posisi Git saat checkpoint

Branch lokal `main` dan `build/photocraft-fork` sama-sama menunjuk commit integrasi `6b2e106` sebelum dokumen milestone ini ditambahkan.

Push sebelumnya gagal karena Git tidak memiliki kredensial dan terminal prompt dinonaktifkan. Ini adalah blocker autentikasi, bukan konflik Git atau kegagalan test.

Setelah dokumen dan helper QA masuk commit baru, push yang perlu dilakukan:

```bash
git push -u origin main
git push -u origin build/photocraft-fork
```

Jika hanya ingin memicu build runner terlebih dahulu, push branch build saja. Jangan mengubah remote agar memuat token di URL.
