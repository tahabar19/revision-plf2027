#!/usr/bin/env python3
"""
Génère un MP3 par épisode (voix neuronale arabe de Microsoft Edge, via edge-tts)
et audio/manifest.json (durée + début de chaque paragraphe, pour le surlignage).

Usage :
    pip install edge-tts      # ffmpeg doit aussi être installé
    python scripts/generate_audio.py                  # voix par défaut
    python scripts/generate_audio.py --voice ar-MA-MounaNeural --rate "+5%"
    python scripts/generate_audio.py --only road-2    # un seul épisode
    python scripts/generate_audio.py --engine dummy   # test sans réseau (silence)

Les épisodes déjà générés avec le même texte et la même voix sont ignorés.
"""
import argparse
import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(ROOT, "audio")
MANIFEST = os.path.join(AUDIO_DIR, "manifest.json")
RATE_HZ = 24000

# ---------------------------------------------------------------- texte -> parole
ARABIC = re.compile("[؀-ۿ]")


def _paren(m):
    inner = m.group(1)
    # On supprime les parenthèses qui ne contiennent que du latin (sigles : TMCA, PORTNET...)
    return m.group(0) if ARABIC.search(inner.replace("و", "")) else ""


def _num(m):
    s = m.group(0)
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
        return s.replace(".", "")            # 4.786 -> 4786
    if "," in s:
        return s.replace(",", " فاصلة ")      # 18,9 -> 18 فاصلة 9
    if "." in s:
        return s.replace(".", " نقطة ")       # 52.05 -> 52 نقطة 05
    return s


def normalize(t):
    """Doit rester identique à normalize() dans app.js."""
    t = re.sub(r"\s*\(([^()]*)\)", _paren, t)
    t = re.sub(r"\S*[A-Za-z]\S*\.[A-Za-z]{2,}\S*", "", t)   # adresses web
    t = t.replace("«", "").replace("»", "").replace("ـ", "")
    t = t.replace("≈", " حوالي ")
    t = re.sub(r"(\d{4})\s*[-–]\s*(\d{4})", r"\1 إلى \2", t)
    t = re.sub(r"(^|[\s(])−\s*(\d)", r"\1ناقص \2", t)
    t = re.sub(r"(^|[\s(])\+\s*(\d)", r"\1زائد \2", t)
    t = re.sub(r"\d+(?:[.,]\d+)*", _num, t)
    t = re.sub(r"\s*%", " في المائة", t)
    t = re.sub(r"(^|\s)و(\d)", r"\1و \2", t)
    t = re.sub(r"\s*[–—]\s*", "، ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def segments(track):
    return [track.get("spokenTitle") or track["title"]] + list(track["paras"])


def gap_after(track, i):
    """Silence (s) après le segment i. Quiz : pause de réflexion après chaque question."""
    if i == 0:
        return 0.9
    if track.get("kind") == "quiz" and (i - 1) % 2 == 0:
        return 3.5
    return 0.6


# ---------------------------------------------------------------- utilitaires
def load_data():
    txt = open(os.path.join(ROOT, "data.js"), encoding="utf-8").read()
    start = txt.index("{", txt.index("window.DATA"))
    return json.loads(txt[start: txt.rindex("}") + 1])


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def to_wav(src, dst):
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", str(RATE_HZ),
         "-sample_fmt", "s16", dst])


def wav_frames(path):
    with wave.open(path, "rb") as w:
        return w.readframes(w.getnframes())


async def tts_edge(text, voice, rate, out_mp3):
    import edge_tts  # import tardif : inutile en mode dummy
    last = None
    for attempt in range(4):
        try:
            await edge_tts.Communicate(text, voice, rate=rate).save(out_mp3)
            if os.path.getsize(out_mp3) > 0:
                return
        except Exception as e:  # réseau, quota...
            last = e
        await asyncio.sleep(2 * (attempt + 1))
    raise RuntimeError(f"edge-tts a échoué : {last}")


def tts_dummy(text, out_wav):
    secs = max(0.5, len(text) / 14.0)
    n = int(secs * RATE_HZ)
    with wave.open(out_wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE_HZ)
        w.writeframes(b"\x00\x00" * n)


# ---------------------------------------------------------------- génération
async def build_track(track, args, tmp):
    segs = [normalize(s) for s in segments(track)]
    pcm = bytearray()
    starts = []
    for i, text in enumerate(segs):
        wav = os.path.join(tmp, f"{track['id']}_{i}.wav")
        if args.engine == "dummy":
            tts_dummy(text, wav)
        else:
            mp3 = os.path.join(tmp, f"{track['id']}_{i}.mp3")
            await tts_edge(text, args.voice, args.rate, mp3)
            to_wav(mp3, wav)
        starts.append(round(len(pcm) / 2 / RATE_HZ, 3))
        pcm += wav_frames(wav)
        pcm += b"\x00\x00" * int(gap_after(track, i) * RATE_HZ)
    full = os.path.join(tmp, f"{track['id']}.wav")
    with wave.open(full, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE_HZ)
        w.writeframes(bytes(pcm))
    out = os.path.join(AUDIO_DIR, f"{track['id']}.mp3")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", full, "-codec:a", "libmp3lame",
         "-b:a", "64k", "-ac", "1", out])
    return {"file": f"audio/{track['id']}.mp3",
            "duration": round(len(pcm) / 2 / RATE_HZ, 2),
            "starts": starts}


def track_hash(track, args):
    h = hashlib.sha1()
    h.update(json.dumps([args.engine, args.voice, args.rate, [normalize(s) for s in segments(track)],
                         [gap_after(track, i) for i in range(len(segments(track)))]],
                        ensure_ascii=False).encode())
    return h.hexdigest()[:16]


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--voice", default=os.environ.get("TTS_VOICE", "ar-MA-JamalNeural"),
                   help="ex. ar-MA-JamalNeural, ar-MA-MounaNeural, ar-SA-HamedNeural")
    p.add_argument("--rate", default=os.environ.get("TTS_RATE", "+0%"))
    p.add_argument("--engine", choices=["edge", "dummy"], default="edge")
    p.add_argument("--only", help="identifiant d'un épisode (ex. road-2)")
    p.add_argument("--strict", action="store_true", help="échouer si un épisode échoue")
    args = p.parse_args()

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg est introuvable : installez-le d'abord.")
    os.makedirs(AUDIO_DIR, exist_ok=True)
    manifest = {"tracks": {}}
    if os.path.exists(MANIFEST):
        try:
            manifest = json.load(open(MANIFEST, encoding="utf-8"))
        except Exception:
            pass
    manifest.setdefault("tracks", {})

    data = load_data()
    tracks = [t for th in data["themes"] for t in th["tracks"]]
    valid_ids = {t["id"] for t in tracks}
    for tid in list(manifest["tracks"]):          # nettoie les épisodes supprimés
        if tid not in valid_ids:
            manifest["tracks"].pop(tid)
    if args.only:
        tracks = [t for t in tracks if t["id"] == args.only]

    ok = fail = skip = 0
    with tempfile.TemporaryDirectory() as tmp:
        for t in tracks:
            h = track_hash(t, args)
            prev = manifest["tracks"].get(t["id"])
            if prev and prev.get("hash") == h and os.path.exists(os.path.join(ROOT, prev["file"])):
                skip += 1
                continue
            print(f"→ {t['id']} : {t['title']}", flush=True)
            try:
                info = await build_track(t, args, tmp)
                info["hash"] = h
                manifest["tracks"][t["id"]] = info
                ok += 1
                print(f"   {info['duration']:.0f} s", flush=True)
            except Exception as e:
                fail += 1
                print(f"   ÉCHEC : {e}", flush=True)
            json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    manifest["voice"] = args.voice if args.engine == "edge" else "dummy"
    json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"Terminé : {ok} générés, {skip} inchangés, {fail} en échec.")
    if fail and args.strict:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
