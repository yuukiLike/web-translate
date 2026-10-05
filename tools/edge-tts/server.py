"""Edge TTS MP3 bridge. Bind to loopback only; never log selected text."""

import argparse
import asyncio
import hmac
import json
import math
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import edge_tts

MAX_BODY_BYTES = 32_768
MAX_AUDIO_BYTES = 8_000_000
VOICES = frozenset((
    "en-US-AriaNeural", "en-US-GuyNeural", "en-GB-SoniaNeural", "en-GB-RyanNeural",
))


async def synthesize(text, voice, rate):
    """The upstream library owns SSML escaping, DRM and WebSocket recovery."""
    audio = bytearray()
    percentage = f"{round((rate - 1) * 100):+d}%"
    async with asyncio.timeout(23):
        speech = edge_tts.Communicate(text, voice, rate=percentage)
        async for chunk in speech.stream():
            if chunk["type"] != "audio":
                continue
            audio.extend(chunk["data"])
            if len(audio) > MAX_AUDIO_BYTES:
                raise ValueError("Audio too large; select less text")
    if not audio:
        raise ValueError("Edge TTS returned no audio")
    return bytes(audio)


def parse_request(body):
    value = json.loads(body.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    text = value.get("text")
    voice = value.get("voice", "en-US-AriaNeural")
    rate = value.get("rate", 1)
    if not isinstance(text, str) or not text.strip() or len(text) > 6_000:
        raise ValueError("Text must contain 1 to 6,000 characters")
    if not isinstance(voice, str) or voice not in VOICES:
        raise ValueError("Unsupported English voice")
    if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate) or not 0.5 <= rate <= 2:
        raise ValueError("Rate must be between 0.5 and 2")
    return text.strip(), voice, rate


def create_handler(token, port, slots):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_arguments):
            pass

        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def reply(self, status, body, content_type="application/json"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass  # The user cancelled playback; no text or audio is retained.

        def fail(self, status, message):
            self.reply(status, json.dumps({"error": message}).encode("utf-8"))

        def do_POST(self):
            if self.path != "/tts":
                self.fail(404, "Not found")
                return
            if self.headers.get("Host") not in (f"127.0.0.1:{port}", f"localhost:{port}"):
                self.fail(403, "Invalid host")
                return
            authorization = self.headers.get("Authorization", "").encode("utf-8")
            expected = f"Bearer {token}".encode("utf-8")
            if not hmac.compare_digest(authorization, expected):
                self.fail(401, "Invalid access token")
                return
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                self.fail(415, "Expected application/json")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY_BYTES:
                    raise ValueError("Request too large or missing Content-Length")
                if self.headers.get("Transfer-Encoding"):
                    raise ValueError("Chunked requests are not supported")
                text, voice, rate = parse_request(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError, TimeoutError):
                self.fail(400, "Invalid request; check text, voice and rate")
                return
            if not slots.acquire(blocking=False):
                self.fail(429, "Speech service is busy; try again shortly")
                return
            try:
                audio = asyncio.run(synthesize(text, voice, rate))
            except (TimeoutError, asyncio.TimeoutError):
                self.fail(504, "Edge TTS timed out")
            except Exception:
                # Upstream errors can contain service URLs. Return a stable message.
                self.fail(502, "Edge TTS is unavailable; check network access")
            else:
                self.reply(200, audio, "audio/mpeg")
            finally:
                slots.release()

        def do_GET(self):
            self.fail(405, "Use authenticated POST /tts")

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    arguments = parser.parse_args()
    if not 1 <= arguments.port <= 65_535:
        parser.error("port must be between 1 and 65535")
    token = secrets.token_urlsafe(32)
    handler = create_handler(token, arguments.port, threading.BoundedSemaphore(2))
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), handler)
    server.daemon_threads = True
    print(f"Edge TTS: http://127.0.0.1:{arguments.port}/tts", flush=True)
    print(f"Access token: {token}", flush=True)
    print("Copy the address and token into the extension's reading preferences. Ctrl+C stops the service.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
