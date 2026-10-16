"""Provider fal (plan Palmier P1): endpoint theo chế độ, tham số, vòng hàng đợi, giá theo
độ phân giải — không mạng (httpx.MockTransport)."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from opencmo.ai.catalog import AiModel, SpecError, price_of, validate_spec
from opencmo.ai.catalog import get_model as catalog_model
from opencmo.ai.providers.fal import FalProvider, build_payload, endpoint_for

UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

# The catalog sends ElevenLabs audio to ElevenLabs directly; the fal endpoints stay as a fallback
# (switching back is a catalog row), and these tests pin them.
ON_FAL = {
    "elevenlabs-voice": "fal-ai/elevenlabs/tts/multilingual-v2",
    "elevenlabs-sfx": "fal-ai/elevenlabs/sound-effects/v2",
    "elevenlabs-music": "fal-ai/elevenlabs/music",
}


def get_model(model_id: str) -> AiModel:
    model = catalog_model(model_id)
    return replace(model, provider="fal", provider_model=ON_FAL[model_id]) if model_id in ON_FAL else model


def _png(path: Path) -> Path:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=red:s=64x64", "-frames:v", "1", str(path)], check=True)
    return path


def test_gia_nhan_he_so_do_phan_giai_lam_tron_len():
    seedance = get_model("fal-seedance")
    assert price_of(seedance, {"prompt": "x", "aspectRatio": "9:16", "duration": 5, "resolution": "720p"}) == 10
    assert price_of(seedance, {"prompt": "x", "aspectRatio": "9:16", "duration": 10, "resolution": "480p"}) == 10
    assert price_of(seedance, {"prompt": "x", "aspectRatio": "9:16", "duration": 5}) == 5, "thiếu độ phân giải = hệ số 1"
    assert price_of(get_model("fal-kling"), {"prompt": "x", "aspectRatio": "9:16", "duration": 5}) == 30


@pytest.mark.parametrize(
    ("model", "spec", "message"),
    [
        ("fal-kling", {"prompt": "x", "aspectRatio": "9:16", "duration": 5, "endImage": f"{UID}/a.png"}, "settings the model does not take"),
        ("fal-seedance", {"prompt": "x", "aspectRatio": "9:16", "duration": 5, "resolution": "1080p"}, "does not support that resolution"),
        ("fal-seedance", {"prompt": "x", "aspectRatio": "9:16", "duration": 5, "startImage": "../etc/passwd"}, "not found in your library"),
        ("fal-nano-banana", {"prompt": "x", "aspectRatio": "1:1", "references": [f"{UID}/{i}.png" for i in range(5)]}, "up to 4 reference images"),
    ],
)
def test_spec_sai_theo_kha_nang_model(model, spec, message):
    with pytest.raises(SpecError, match=message):
        validate_spec(get_model(model), spec)


def test_endpoint_va_tham_so_theo_che_do(tmp_path):
    image = str(_png(tmp_path / "a.png"))
    seedance = get_model("fal-seedance")
    spec = {"prompt": "a fox", "aspectRatio": "9:16", "duration": 5, "resolution": "720p", "startImage": image, "endImage": image, "seed": 7}
    assert endpoint_for(seedance, spec).endswith("/image-to-video")
    payload = build_payload(seedance, spec)
    assert payload["duration"] == "5" and payload["resolution"] == "720p" and payload["aspect_ratio"] == "9:16"
    assert payload["image_url"].startswith("data:image/png;base64,") and payload["end_image_url"].startswith("data:")
    assert endpoint_for(seedance, {"prompt": "a fox", "aspectRatio": "9:16", "duration": 5}).endswith("/text-to-video")

    seedream = build_payload(get_model("fal-seedream"), {"prompt": "x", "aspectRatio": "9:16"})
    assert seedream["image_size"] == "portrait_16_9" and "aspect_ratio" not in seedream
    banana = get_model("fal-nano-banana")
    assert endpoint_for(banana, {"prompt": "x", "aspectRatio": "1:1", "references": [image]}).endswith("/edit")
    assert len(build_payload(banana, {"prompt": "x", "aspectRatio": "1:1", "references": [image, image]})["image_urls"]) == 2


def test_vong_hang_doi_tai_ket_qua_ve_png(tmp_path):
    png = _png(tmp_path / "out.png").read_bytes()
    seen: list[str] = []

    def api(request: httpx.Request) -> httpx.Response:
        seen.append(f"{request.method} {request.url}")
        if request.method == "POST":
            assert request.headers["Authorization"] == "Key k"
            assert json.loads(request.content)["prompt"] == "a fox"
            return httpx.Response(200, json={"request_id": "r1", "status_url": "https://queue.fal.run/x/requests/r1/status", "response_url": "https://queue.fal.run/x/requests/r1"})
        if request.url.path.endswith("/status"):
            return httpx.Response(200, json={"status": "COMPLETED"})
        return httpx.Response(200, json={"images": [{"url": "https://v3.fal.media/files/out.png"}]})

    def cdn(request: httpx.Request) -> httpx.Response:
        assert "Authorization" not in request.headers, "khoá không được đi tới host CDN"
        return httpx.Response(200, content=png, headers={"content-type": "image/png"})

    provider = FalProvider(
        "k",
        client=httpx.Client(transport=httpx.MockTransport(api), headers={"Authorization": "Key k"}),
        download=httpx.Client(transport=httpx.MockTransport(cdn)),
    )
    result = provider.run(get_model("fal-nano-banana"), {"prompt": "a fox", "aspectRatio": "1:1"}, tmp_path, sleep=lambda _s: None)
    assert result is not None and result.extension == "png" and result.path.exists()
    assert seen[0].startswith("POST https://queue.fal.run/fal-ai/nano-banana")


def test_bi_tu_choi_4xx_khong_retry_429_thi_retry(tmp_path):
    from opencmo.ai.providers.base import ProviderError

    for status, retryable in ((422, False), (429, True)):
        provider = FalProvider("k", client=httpx.Client(transport=httpx.MockTransport(lambda _r, s=status: httpx.Response(s, json={}))))
        with pytest.raises(ProviderError) as info:
            provider.submit(get_model("fal-hailuo"), {"prompt": "x", "aspectRatio": "9:16", "duration": 6}, tmp_path)
        assert info.value.retryable is retryable


def _mp3(path: Path, seconds: int) -> Path:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:a", "libmp3lame", str(path)],
        check=True,
    )
    return path


def _queue(result: dict, audio: bytes) -> FalProvider:
    def api(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"status_url": "https://queue.fal.run/x/requests/r1/status", "response_url": "https://queue.fal.run/x/requests/r1"})
        if request.url.path.endswith("/status"):
            return httpx.Response(200, json={"status": "COMPLETED"})
        return httpx.Response(200, json=result)

    return FalProvider(
        "k",
        client=httpx.Client(transport=httpx.MockTransport(api)),
        download=httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(200, content=audio, headers={"content-type": "audio/mpeg"}))),
    )


def test_media_moved_from_gemini_and_elevenlabs_keeps_its_parameters(tmp_path):
    voice = build_payload(get_model("elevenlabs-voice"), {"prompt": "Get paid on day three.", "voice": "Aria"})
    assert voice == {"text": "Get paid on day three.", "voice": "Aria", "timestamps": True}
    assert build_payload(get_model("gemini-voice"), {"prompt": "Welcome back", "voice": "Kore"})["prompt"] == "Welcome back"
    sfx = build_payload(get_model("elevenlabs-sfx"), {"prompt": "a whoosh", "duration": 3})
    assert sfx == {"text": "a whoosh", "duration_seconds": 3, "prompt_influence": 0.3}
    music = build_payload(get_model("elevenlabs-music"), {"prompt": "calm lo-fi", "duration": 15})
    assert music == {"prompt": "calm lo-fi", "music_length_ms": 15000, "force_instrumental": True}

    veo = get_model("gemini-video")
    assert build_payload(veo, {"prompt": "waves", "aspectRatio": "9:16", "duration": 8})["duration"] == "8s"
    image = str(_png(tmp_path / "a.png"))
    assert endpoint_for(veo, {"prompt": "waves", "aspectRatio": "9:16", "duration": 4, "startImage": image}).endswith("/fast/image-to-video")


def test_voice_returns_word_timings_for_captions(tmp_path):
    # The shape fal returned for "Get paid on day three." (one alignment chunk, per character).
    text = " Get paid on day three. "
    starts = [round(i * 0.1, 3) for i in range(len(text))]
    timestamps = [{"characters": list(text), "character_start_times_seconds": starts, "character_end_times_seconds": [s + 0.1 for s in starts]}]
    provider = _queue({"audio": {"url": "https://v3.fal.media/files/voice.mp3"}, "timestamps": timestamps}, _mp3(tmp_path / "v.mp3", 2).read_bytes())

    result = provider.run(get_model("elevenlabs-voice"), {"prompt": "Get paid on day three.", "voice": "Aria"}, tmp_path, sleep=lambda _s: None)

    assert result is not None and result.extension == "m4a"
    assert [w["text"] for w in result.words] == ["Get", "paid", "on", "day", "three."]
    assert result.words[0]["start"] == 0.1


def test_sound_is_trimmed_to_the_seconds_paid_for(tmp_path):
    provider = _queue({"audio": {"url": "https://v3.fal.media/files/sfx.mp3"}}, _mp3(tmp_path / "s.mp3", 5).read_bytes())

    result = provider.run(get_model("elevenlabs-sfx"), {"prompt": "a whoosh", "duration": 2}, tmp_path, sleep=lambda _s: None)

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(result.path)], check=True, capture_output=True, text=True
    )
    assert float(json.loads(probe.stdout)["format"]["duration"]) <= 2.1
    assert result.words is None


def test_429_or_5xx_after_submit_never_submits_the_paid_job_again(tmp_path):
    """A busy status or result URL keeps waiting; the job is submitted once."""
    png = _png(tmp_path / "out.png").read_bytes()
    calls = {"POST": 0, "status": 0, "result": 0, "cdn": 0}

    def api(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            calls["POST"] += 1
            return httpx.Response(200, json={"status_url": "https://queue.fal.run/x/requests/r1/status", "response_url": "https://queue.fal.run/x/requests/r1"})
        if request.url.path.endswith("/status"):
            calls["status"] += 1
            return httpx.Response(429 if calls["status"] == 1 else 200, json={"status": "COMPLETED"})
        calls["result"] += 1
        return httpx.Response(503 if calls["result"] == 1 else 200, json={"images": [{"url": "https://v3.fal.media/files/out.png"}]})

    def cdn(_request: httpx.Request) -> httpx.Response:
        calls["cdn"] += 1
        return httpx.Response(502 if calls["cdn"] == 1 else 200, content=png, headers={"content-type": "image/png"})

    waits: list[float] = []
    provider = FalProvider(
        "k",
        client=httpx.Client(transport=httpx.MockTransport(api)),
        download=httpx.Client(transport=httpx.MockTransport(cdn)),
        sleep=waits.append,
    )
    result = provider.run(get_model("fal-nano-banana"), {"prompt": "a fox", "aspectRatio": "1:1"}, tmp_path, sleep=lambda _s: None)
    assert result is not None and result.path.exists()
    assert calls["POST"] == 1, "never resubmitted"
    assert waits == [2.0, 2.0]


def test_result_still_busy_after_retries_fails_for_good(tmp_path):
    from opencmo.ai.providers.base import ProviderError

    provider = FalProvider("k", client=httpx.Client(transport=httpx.MockTransport(lambda _r: httpx.Response(503, json={}))), sleep=lambda _s: None)
    ref = json.dumps({"status_url": "https://queue.fal.run/x/status", "response_url": "https://queue.fal.run/x"})
    with pytest.raises(ProviderError) as info:
        provider.fetch(ref, tmp_path)
    assert info.value.retryable is False, "a retry would submit the paid job again"


def test_video_input_is_uploaded_to_fal_storage_not_sent_as_a_data_url(tmp_path):
    clip = tmp_path / "source.mp4"
    clip.write_bytes(b"mp4-bytes")
    seen: list[tuple[str, str]] = []

    def api(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, str(request.url)))
        if "storage/auth/token" in str(request.url):
            return httpx.Response(200, json={"token": "t", "token_type": "Bearer", "base_url": "https://v3b.fal.media", "expires_at": "x"})
        if str(request.url) == "https://v3b.fal.media/files/upload":
            assert request.headers["Authorization"] == "Bearer t" and request.content == b"mp4-bytes"
            assert "expiration_duration_seconds" in request.headers["X-Fal-Object-Lifecycle"]
            return httpx.Response(200, json={"access_url": "https://v3b.fal.media/files/b/x/source.mp4", "uploaded": True})
        assert json.loads(request.content)["video_url"] == "https://v3b.fal.media/files/b/x/source.mp4"
        return httpx.Response(200, json={"status_url": "https://queue.fal.run/x/status", "response_url": "https://queue.fal.run/x"})

    provider = FalProvider("k", client=httpx.Client(transport=httpx.MockTransport(api)))
    spec = {"prompt": "Remove background", "aspectRatio": "9:16", "duration": 2, "sourceVideo": str(clip), "sourceStart": 0}
    ref = json.loads(provider.submit(get_model("fal-veed-cutout"), spec, tmp_path))
    assert ref["cutout"] is True
    assert [method for method, _url in seen] == ["POST", "POST", "POST"]
    assert seen[-1][1] == "https://queue.fal.run/veed/video-background-removal"


def _ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")
def test_provider_output_is_read_as_untrusted_media(tmp_path):
    """Engine rule 7: a provider's file is untrusted like an upload. A real song and image still
    convert; an HLS playlist served as audio (it could make ffmpeg read files on the worker) does not."""
    from opencmo.ai.providers.base import ProviderError
    from opencmo.ai.providers.fal import _normalize
    from opencmo.media.ffmpeg import FFmpegError

    song = tmp_path / "song"
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-f", "mp3", str(song))
    out = tmp_path / "a"
    out.mkdir()
    assert _normalize(song, "audio/mpeg", out).path.name == "result.m4a"

    image = tmp_path / "image"
    _ffmpeg("-f", "lavfi", "-i", "color=c=red:s=32x32", "-frames:v", "1", "-f", "image2", "-c:v", "png", str(image))
    out = tmp_path / "b"
    out.mkdir()
    assert _normalize(image, "image/png", out).path.name == "result.png"

    # A concat list naming a file next to it in the worker's folder: without the allowlist ffmpeg
    # follows it and turns whatever that file holds into the "generated" result.
    local = tmp_path / "local.mp3"
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=1", str(local))
    playlist = tmp_path / "playlist"
    playlist.write_text("ffconcat version 1.0\nfile local.mp3\n")
    out = tmp_path / "c"
    out.mkdir()
    with pytest.raises((FFmpegError, ProviderError, subprocess.CalledProcessError)):
        _normalize(playlist, "audio/mpeg", out)
