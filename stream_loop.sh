#!/usr/bin/env bash
# Stream a pre-rendered loop to YouTube with almost no CPU (video is copied, not re-encoded).
# Usage: RTMP_URL=rtmp://a.rtmp.youtube.com/live2/KEY [AUDIO_URL=...] ./stream_loop.sh starlink_loop.mp4
set -euo pipefail
VIDEO="${1:-starlink_loop.mp4}"
: "${RTMP_URL:?set RTMP_URL}"
if [ -n "${AUDIO_URL:-}" ]; then
  AUDIO_IN=(-stream_loop -1 -i "$AUDIO_URL")
else
  AUDIO_IN=(-f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100")
fi
exec ffmpeg -hide_banner -loglevel warning -re -stream_loop -1 -i "$VIDEO" "${AUDIO_IN[@]}" \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 128k -ar 44100 -f flv "$RTMP_URL"
