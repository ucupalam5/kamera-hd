# Kamera HD 📷 — simpel ala APK + Timemark Jalan

Tampilan disederhanakan seperti aplikasi kamera biasa: bidik full, tombol shutter besar, pengaturan disembunyikan di ⚙️.

- **Auto-izin saat dibuka**: splash `Izinkan & Buka Kamera` langsung meminta Kamera + Mikrofon + Lokasi + Motion. Di APK (Capacitor) izin `CAMERA, RECORD_AUDIO, ACCESS_FINE_LOCATION` sudah ditanam di `AndroidManifest` via workflow.
- **Timemark nama jalan**: watermark bawah ala Timestamp Camera:
  ```
  Jl. Malioboro No. 10, Sosromenduran, Yogyakarta
  Senin, 15 September 2026 14.30.22
  -7.792800, 110.365800
  ```

## Upload ke GitHub + aktifkan Workflow

```bash
cd /root/kamera-hd-app
git init -b main
git add .
git commit -m "kamera hd v2 simpel + workflow"
git remote add origin https://github.com/USERNAME/kamera-hd.git
git push -u origin main
```

1. **Website otomatis** (`web.yml`): tiap push ke `main` → deploy ke GitHub Pages. Aktifkan di repo: Settings → Pages → Source: `GitHub Actions`. URL jadi `https://USERNAME.github.io/kamera-hd/`.
2. **APK otomatis** (`apk.yml`): tiap push → build `app-debug.apk`. Ambil di tab Actions → APK Build → Artifacts `kamera-hd-apk`. Install di HP.
3. Lokal: `python3 -m http.server 8000` → buka `http://localhost:8000`.
