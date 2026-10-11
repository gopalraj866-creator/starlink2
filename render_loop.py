#!/usr/bin/env python3
"""
Render the Three.js scene frame-by-frame (deterministic) in headless Chromium
(software WebGL, no GPU needed) and encode a seamless looping MP4.

  python render_loop.py --out loop.mp4                 # full loop (~118 s)
  python render_loop.py --out test.mp4 --seconds 6     # quick test
Then stream it:  ./stream_loop.sh loop.mp4
"""
import argparse, asyncio, os, subprocess, sys, time
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8765


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="starlink_loop.mp4")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--start", type=float, default=0, help="start time in the camera cycle (seconds)")
    ap.add_argument("--seconds", type=float, default=0, help="0 = one full camera cycle")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--bitrate", default="3000k")
    ap.add_argument("--quality", default="low", help="three.js quality: high|low")
    args = ap.parse_args()

    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "-d", HERE],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=[
            "--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars"])
        page = await browser.new_page(viewport={"width": args.width, "height": args.height})
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        await page.goto(f"http://localhost:{PORT}/index.html?manual=1&q={args.quality}")
        await page.wait_for_function("window.__ready===true", timeout=120000)
        total = args.seconds or await page.evaluate("window.__total")
        n = int(round(total * args.fps))
        fade = 0.8
        vf = f"fade=t=in:st=0:d={fade},fade=t=out:st={max(total - fade, 0):.2f}:d={fade}"
        ff = subprocess.Popen([
            "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
            "-f", "image2pipe", "-framerate", str(args.fps), "-c:v", "mjpeg", "-i", "-",
            "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
            "-b:v", args.bitrate, "-maxrate", args.bitrate, "-bufsize", "7000k",
            "-g", str(args.fps * 2), "-keyint_min", str(args.fps * 2), "-sc_threshold", "0",
            "-movflags", "+faststart", args.out], stdin=subprocess.PIPE)
        t0 = time.time()
        for i in range(n):
            await page.evaluate(f"window.renderAt({args.start + i / args.fps})")
            ff.stdin.write(await page.screenshot(type="jpeg", quality=92))
            if i % 150 == 0:
                el = time.time() - t0
                eta = el / (i + 1) * (n - i - 1)
                print(f"frame {i}/{n}  {(i + 1) / max(el, 1e-6):.1f} fps  ETA {eta / 60:.1f} min", flush=True)
        ff.stdin.close(); ff.wait()
        await browser.close()
    srv.terminate()
    if errs:
        print("page errors:", errs[:3])
    print("wrote", args.out)

asyncio.run(main())
