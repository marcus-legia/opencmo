"""Catalog model sinh media — đọc `packages/contracts/ai-models.json`.

Worker là lớp kiểm THỨ BA (sau zod ở route và `create_generation` trong SQL):
lớp nào cũng có thể là lớp duy nhất còn sống sau một lần refactor, nên spec
được kiểm lại ở đây trước khi gọi provider — gọi provider là tốn tiền thật.
"""

from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path
from typing import Any

# Máy dev: packages/engine/opencmo/ai/catalog.py → packages/contracts.
# Modal: modal_app.py chép file vào /root/contracts.
_CANDIDATES = (
    Path(__file__).resolve().parents[3] / "contracts" / "ai-models.json",
    Path("/root/contracts/ai-models.json"),
)


class SpecError(ValueError):
    """Spec không hợp lệ với model; câu chữ là tiếng Anh, lên thẳng màn hình."""


@dataclass(frozen=True)
class AiModel:
    id: str
    kind: str
    provider: str
    name: str
    price: dict[str, Any]
    limits: dict[str, Any]
    provider_model: str = ""
    #: Endpoint phụ theo chế độ (aggregator): `image` = ảnh→video, `edit` = ảnh có tham chiếu.
    provider_models: dict[str, str] | None = None

    def remote_id(self) -> str:
        """Id model phía provider. `OPENCMO_AI_MODEL_<ID>` ghi đè: provider đổi
        tên model (preview → GA) thì chốt lại bằng env, không phải sửa catalog."""
        key = "OPENCMO_AI_MODEL_" + self.id.upper().replace("-", "_")
        return os.environ.get(key) or self.provider_model or self.id


def catalog_path() -> Path:
    override = os.environ.get("OPENCMO_AI_MODELS")
    if override:
        return Path(override)
    for candidate in _CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("packages/contracts/ai-models.json not found")


@lru_cache(maxsize=1)
def load_models() -> dict[str, AiModel]:
    data = json.loads(catalog_path().read_text(encoding="utf-8"))
    return {
        row["id"]: AiModel(
            id=row["id"], kind=row["kind"], provider=row["provider"],
            name=row["name"], price=row["price"], limits=row["limits"],
            provider_model=row.get("providerModel", ""),
            provider_models=row.get("providerModels"),
        )
        for row in data["models"]
    }


def with_row(model: AiModel, row: dict[str, Any] | None) -> AiModel:
    """Catalog trong DB (G5) đè giá + giới hạn của JSON; hàng tắt = model không dùng được.

    JSON giữ phần chỉ code cần (`providerModel`, endpoint phụ); giá và giới hạn đổi được trong DB
    mà không deploy — và phải khớp `ai_check_spec`/`ai_price` (SQL đọc đúng hàng này)."""
    if row is None:
        return model
    if row.get("enabled") is False:
        raise SpecError("This model is not available.")
    return replace(
        model,
        price=row["price"] if isinstance(row.get("price"), dict) else model.price,
        limits=row["limits"] if isinstance(row.get("limits"), dict) else model.limits,
    )


def get_model(model_id: str) -> AiModel:
    model = load_models().get(model_id)
    if model is None:
        raise SpecError("This model is not available.")
    return model


_ALLOWED = {
    "image": {"prompt", "aspectRatio", "seed"},
    "video": {"prompt", "aspectRatio", "duration", "seed"},
    "voice": {"prompt", "voice", "seed"},
    "audio": {"prompt", "duration", "seed"},
}


#: Same message as `ai_check_spec` (SQL): code_ref missing, malformed, or not the caller's.
EXPLAINER_CODE_NOT_FOUND = "This explainer code was not found. Preview it again."
EXPLAINER_INVALID = "This explainer script is not valid. Write it again."
#: Silent motion clips (`motion-clip`, template "clip"): same words as `ai_check_spec`.
CLIP_INVALID = "This motion clip is not valid. Write it again."
CLIP_TOO_LONG = "This motion clip is longer than 30 seconds. Shorten its beats."
CLIP_OVER_DURATION = "This motion clip's beats last longer than its paid length. Shorten its beats or make it longer."
#: `ClipBeatSchema` / `CLIP_SECONDS` in packages/editor-core/src/explainer.ts.
CLIP_BEATS_MAX, CLIP_MAX_SECONDS, BEAT_MIN_SECONDS = 8, 30, 0.5

#: Size cap of `scene` (JSON) for scene models — same number as `ai_check_spec`.
SCENE_MAX_BYTES = 4000
#: Explainer beats: the bounds of `BeatSchema` in packages/clip-motion/src/job.ts.
BEATS_MIN, BEATS_MAX, SAY_MAX, LABEL_MAX, TITLE_MAX = 3, 16, 240, 40, 60
#: Explainer v2 looks and motion personalities: `THEMES` / `PERSONALITIES` in job.ts, same as SQL.
THEMES = ("blueprint", "paper")
PERSONALITIES = ("premium", "corporate", "playful", "energetic")


def _code_ref_ok(scene: dict[str, Any]) -> bool:
    return isinstance(scene.get("code_ref"), str) and bool(re.fullmatch(r"[0-9a-f]{64}", scene["code_ref"]))


def _check_motion_scene(scene: dict[str, Any], beat_keys: set[str], beats_range: tuple[int, int], invalid: str) -> list[dict[str, Any]]:
    """The rules explainers and silent clips share; returns the beats for the caller's own rules."""
    if not _code_ref_ok(scene):
        raise SpecError(EXPLAINER_CODE_NOT_FOUND)
    title, beats = scene.get("title"), scene.get("beats")
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= TITLE_MAX:
        raise SpecError(invalid)
    if not isinstance(beats, list) or not beats_range[0] <= len(beats) <= beats_range[1]:
        raise SpecError(invalid)
    for beat in beats:
        if not isinstance(beat, dict) or set(beat) - beat_keys:
            raise SpecError(invalid)
        say, label = beat.get("say"), beat.get("label")
        if not isinstance(say, str) or not 1 <= len(say.strip()) <= SAY_MAX:
            raise SpecError(invalid)
        if label is not None and (not isinstance(label, str) or len(label.strip()) > LABEL_MAX):
            raise SpecError(invalid)
    accent = scene.get("accent")
    if accent is not None and not (isinstance(accent, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", accent)):
        raise SpecError(invalid)
    if "theme" in scene and scene["theme"] not in THEMES:
        raise SpecError(invalid)
    if "personality" in scene and scene["personality"] not in PERSONALITIES:
        raise SpecError(invalid)
    return beats


def _check_explainer(scene: dict[str, Any]) -> None:
    """The script the price and the voice are computed from; the renderer re-parses the full job."""
    _check_motion_scene(scene, {"say", "label"}, (BEATS_MIN, BEATS_MAX), EXPLAINER_INVALID)


def _check_clip(scene: dict[str, Any], duration: Any) -> None:
    """A silent clip: 1-8 beats, each with its own seconds, adding up to at most 30 s and the paid duration."""
    beats = _check_motion_scene(scene, {"say", "label", "seconds"}, (1, CLIP_BEATS_MAX), CLIP_INVALID)
    total = 0.0
    for beat in beats:
        seconds = beat.get("seconds")
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not BEAT_MIN_SECONDS <= seconds <= CLIP_MAX_SECONDS:
            raise SpecError(CLIP_INVALID)
        total += float(seconds)
    if total > CLIP_MAX_SECONDS + 1e-9:
        raise SpecError(CLIP_TOO_LONG)
    if isinstance(duration, int) and total > duration + 1e-9:
        raise SpecError(CLIP_OVER_DURATION)


def motion_template(model: AiModel) -> str | None:
    """The scene template a motion model renders: narrated explainers take voices, silent clips do not."""
    if model.provider != "opencmo-motion":
        return None
    return "explainer" if model.limits.get("voices") else "clip"


def narration(scene: dict[str, Any]) -> str:
    """What the voice reads: the beats' `say`, trimmed, joined with one space (same as `ai_price`)."""
    return " ".join(str(beat["say"]).strip() for beat in scene.get("beats") or [])


def _check_scene(model: AiModel, scene: Any, duration: Any = None) -> None:
    """Shape only: the full rules are zod on the route (layer 1) and the renderer itself
    (`clip-motion` re-parses; exit code 3 = invalid spec)."""
    if not isinstance(scene, dict) or not isinstance(scene.get("template"), str):
        raise SpecError("Describe the 3D scene first.")
    # Each motion model takes only its own template (explainer or clip), and only they take them: each
    # renderer knows one shape, and the price of an explainer depends on its script.
    template = motion_template(model)
    # A motion scene's images are capped on their own (6 refs of ≤ 500 chars): they never crowd out the script.
    measured = {k: v for k, v in scene.items() if k != "assets"} if template is not None else scene
    if len(json.dumps(measured, separators=(",", ":"), ensure_ascii=False).encode()) > SCENE_MAX_BYTES:
        raise SpecError("This 3D scene has too much data.")
    # Only motion models take a scene since 3D was removed (same words as `ai_check_spec`).
    if template is None:
        raise SpecError("Describe the 3D scene first.")
    if template is not None and scene["template"] != template:
        raise SpecError(EXPLAINER_INVALID if template == "explainer" else CLIP_INVALID)
    if scene["template"] == "explainer":
        _check_explainer(scene)
    if scene["template"] == "clip":
        _check_clip(scene, duration)


MEDIA_NOT_FOUND = "That image was not found in your media."
VIDEO_NOT_FOUND = "Choose a video from your media to edit."
_MEDIA_REF = re.compile(r"[0-9a-f-]{36}/.+")
_CLIP_VIDEO_REF = re.compile(r"(?:renders|sources):[0-9a-f-]{36}/.+")


def media_ref_ok(ref: Any) -> bool:
    """Hình dạng tên object media (`<uid>/…`); chủ sở hữu kiểm ở SQL và ở worker theo chủ task."""
    return isinstance(ref, str) and len(ref) <= 500 and bool(_MEDIA_REF.fullmatch(ref)) and ".." not in ref


def clip_video_ref_ok(ref: Any) -> bool:
    """`<bucket>:<uid>/…` of the clip's own video (background removal only), same shape as SQL."""
    return isinstance(ref, str) and len(ref) <= 520 and bool(_CLIP_VIDEO_REF.fullmatch(ref)) and ".." not in ref


def split_video_ref(ref: str) -> tuple[str, str]:
    """(bucket, object) of a source video ref: library files live in `media`."""
    bucket, sep, name = ref.partition(":")
    return (bucket, name) if sep and bucket in ("renders", "sources") else ("media", ref)


def capability_keys(model: AiModel) -> set[str]:
    """Trường spec theo khả năng model — cùng bộ với `ai_check_spec` (SQL)."""
    keys: set[str] = set()
    limits = model.limits
    if model.kind in ("image", "video"):
        if limits.get("resolutions"):
            keys.add("resolution")
        if int(limits.get("maxReferences") or 0) > 0:
            keys.add("references")
    if model.kind == "video":
        if limits.get("firstFrame"):
            # `after`: a /video shot that continues the previous one starts from its last frame.
            keys |= {"startImage", "after"}
        if limits.get("lastFrame"):
            keys.add("endImage")
        if limits.get("audio"):
            keys.add("audio")
        if limits.get("sourceVideo"):
            keys |= {"sourceVideo", "sourceStart"}
    return keys


def validate_spec(model: AiModel, spec: dict[str, Any]) -> None:
    """Same rules as `specSchema` (TS) and `ai_check_spec` (SQL)."""
    allowed = _ALLOWED[model.kind] | ({"scene"} if model.limits.get("scene") else set()) | capability_keys(model)
    if model.kind == "video" and model.limits.get("voices"):
        # A narrated video (explainer): the voice is generated inside the render.
        allowed = allowed | {"voice"}
    extra = set(spec) - allowed
    if extra:
        raise SpecError("This request has settings the model does not take.")
    if "after" in spec:
        after = spec["after"]
        if not isinstance(after, str) or not re.fullmatch(r"[0-9a-f]{64}", after):
            raise SpecError("Invalid generation request.")
        if "startImage" in spec:
            raise SpecError("A shot that continues the previous one cannot also start from an image.")
    prompt = spec.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise SpecError("Write a prompt first.")
    if len(prompt) > int(model.limits["maxPromptChars"]):
        raise SpecError(f"Keep the prompt under {model.limits['maxPromptChars']} characters.")
    seed = spec.get("seed")
    if seed is not None and (not isinstance(seed, int) or not 0 <= seed <= 2_147_483_647):
        raise SpecError("Invalid seed.")
    if model.kind in ("image", "video") and spec.get("aspectRatio") not in model.limits.get(
        "aspectRatios", []
    ):
        raise SpecError(f"{model.name} does not support that aspect ratio.")
    if model.kind == "video" and spec.get("duration") not in model.limits.get("durations", []):
        raise SpecError(f"{model.name} does not support that duration.")
    if "resolution" in spec and spec["resolution"] not in model.limits.get("resolutions", []):
        raise SpecError(f"{model.name} does not support that resolution.")
    if "audio" in spec and not isinstance(spec["audio"], bool):
        raise SpecError("Invalid generation request.")
    for key in ("startImage", "endImage"):
        if key in spec and not media_ref_ok(spec[key]):
            raise SpecError(MEDIA_NOT_FOUND)
    if model.limits.get("sourceVideo"):
        source = spec.get("sourceVideo")
        own_clip = model.limits.get("removeBackground") or model.limits.get("clipVideo")
        if not (media_ref_ok(source) or (own_clip and clip_video_ref_ok(source))):
            raise SpecError(VIDEO_NOT_FOUND)
        start = spec.get("sourceStart")
        if isinstance(start, bool) or not isinstance(start, (int, float)) or start < 0:
            raise SpecError("Invalid generation request.")
    if "references" in spec:
        refs, cap = spec["references"], int(model.limits.get("maxReferences") or 0)
        if not isinstance(refs, list) or not 1 <= len(refs) <= cap:
            raise SpecError(f"{model.name} takes up to {cap} reference images.")
        if not all(media_ref_ok(ref) for ref in refs):
            raise SpecError(MEDIA_NOT_FOUND)
    if model.limits.get("scene"):
        _check_scene(model, spec.get("scene"), spec.get("duration"))
    if (model.kind == "voice" or "voice" in allowed) and spec.get("voice") not in model.limits.get("voices", []):
        raise SpecError("Choose one of the listed voices.")
    if model.kind == "audio":
        duration = spec.get("duration")
        low, high = model.limits.get("minSeconds", 1), model.limits.get("maxSeconds", 22)
        if not isinstance(duration, int) or not low <= duration <= high:
            raise SpecError(f"Sounds are {low} to {high} seconds long.")


def price_of(model: AiModel, spec: dict[str, Any]) -> int:
    """Same formula as `priceOf` (TS) and `ai_price` (SQL): base price × resolution factor, rounded up."""
    unit, credits = model.price["unit"], int(model.price["credits"])
    if unit == "generation":
        base = credits
    elif unit == "second":
        base = credits * math.ceil(float(spec.get("duration") or 1))
    elif unit == "kchars":
        base = credits * max(1, math.ceil(len(str(spec["prompt"]).strip()) / 1000))
    elif unit == "explainer":
        # Render per started 10 s, plus the voice per started 1,000 characters of narration.
        chars = len(narration(spec.get("scene") or {}))
        # A silent clip has no `voiceKchars`: it pays for the render only.
        voice = int(model.price.get("voiceKchars") or 0)
        base = credits * math.ceil(int(spec["duration"]) / 10) + voice * max(1, math.ceil(chars / 1000))
    else:
        raise SpecError("This model is not available.")
    factor = (model.price.get("resolution") or {}).get(spec.get("resolution") or "", 1)
    return math.ceil(base * factor)
