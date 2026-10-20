"""Cấu hình engine. Đọc từ biến môi trường, có mặc định hợp lý."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class Config:
    # Speech-to-text (ElevenLabs Scribe): an upload's transcript and captions of library media.
    elevenlabs_api_key: str = field(default_factory=lambda: os.getenv("ELEVENLABS_API_KEY", ""))
    scribe_model: str = field(default_factory=lambda: os.getenv("OPENCMO_SCRIBE_MODEL", "scribe_v1"))

    def validate_for_transcribe(self) -> None:
        if not self.elevenlabs_api_key:
            raise RuntimeError("Missing ELEVENLABS_API_KEY — required to transcribe speech.")
