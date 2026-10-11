# Starlink Constellation – 3D (Three.js + real textures)

A real 3D scene: ~10,000 Starlink satellites (moved on the GPU from orbital
elements), a lit Earth with real day / night-lights / specular / cloud maps,
atmosphere glow, the Moon at **true distance and size**, a Milky-Way star
field, and a cinematic "game director" that cuts between four cameras:

1. Orbital view  2. Satellite chase cam  3. Earth–Moon (real scale)  4. Low-orbit flyby

HUD: live stats, highlighted satellite tag, rotating facts, camera name.

## Two ways to use it

### A) Real time on a PC with a GPU (best quality, 60 fps)
```bash
python3 -m http.server 8000      # in this folder
```
Open http://localhost:8000 in Chrome, press F11, and capture it with OBS
(Window/Browser capture) -> YouTube. URL options:
`?q=low` lighter globe, `?speed=120` faster orbits, `?exag=1` real orbit height.

### B) 24/7 from GitHub Actions (no GPU on the runner)
GitHub runners have no GPU, so WebGL runs in software at ~5 fps – too slow to
stream live. Instead the scene is rendered **frame by frame** into a seamless
~2 minute MP4 loop, and that loop is streamed with almost no CPU:

1. Push this folder to a GitHub repo.
2. Actions -> **Render Starlink 3D loop** -> Run workflow (~15–30 min).
   It publishes `starlink_loop.mp4` to the release `starlink-loop`.
3. Add repo secret `YOUTUBE_RTMP_URL` = `rtmp://a.rtmp.youtube.com/live2/YOUR_KEY`
   (optional: `AUDIO_URL` = direct .mp3 link for looped music,
   `VIDEO_URL` = use your own mp4 instead of the release asset).
4. Actions -> **Starlink 3D Live Stream** -> Run workflow. It restarts every 5 h.

Local test of the renderer:
```bash
pip install playwright && playwright install chromium
python render_loop.py --out test.mp4 --seconds 6
RTMP_URL=rtmp://... ./stream_loop.sh test.mp4
```

Notes: orbit heights are exaggerated 2.6x by default so shells are visible
(HUD still shows real altitudes). Textures: three.js example planet maps (MIT).
