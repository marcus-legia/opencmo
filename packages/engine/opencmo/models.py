"""Kiểu dữ liệu dùng chung trong pipeline.

Cố ý dùng dataclass thuần thay vì pydantic ở tầng lõi: nhẹ, dễ serialize,
và không ràng buộc engine vào một framework nào.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass
class Word:
    """Một từ kèm mốc thời gian, dùng để nhấn từng từ trên phụ đề."""

    start: float
    end: float
    text: str


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str
    # Mốc từng từ. None nghĩa là nguồn không cho biết — phụ đề khi đó rơi về
    # cách cũ (một dòng cho cả câu). Để tuỳ chọn chứ không bắt buộc là điều kiện
    # để mọi nguồn transcript cũ vẫn chạy nguyên như trước.
    words: list[Word] | None = None


@dataclass
class Transcript:
    segments: list[TranscriptSegment]
    language: str = "en"
    # The source decides the cost: 'subs' is free, speech-to-text is paid. 'whisper' marks
    # transcripts saved before the switch to ElevenLabs Scribe.
    source: Literal["subs", "scribe", "whisper"] = "scribe"

    @property
    def full_text(self) -> str:
        return " ".join(s.text for s in self.segments)

    def slice(self, start: float, end: float) -> list[TranscriptSegment]:
        """Các segment giao với khoảng [start, end], thời gian đã dời về gốc 0."""
        out = []
        for s in self.segments:
            if s.end <= start or s.start >= end:
                continue
            # Mốc từng từ phải dời gốc GIỐNG segment, nếu không phần nhấn sẽ lệch
            # đúng bằng `start`. Từ nằm ngoài cửa sổ bị loại luôn.
            words: list[Word] | None = None
            if s.words:
                words = [
                    Word(
                        start=max(0.0, w.start - start),
                        end=min(end - start, w.end - start),
                        text=w.text,
                    )
                    for w in s.words
                    if w.end > start and w.start < end
                ] or None
            out.append(
                TranscriptSegment(
                    start=max(0.0, s.start - start),
                    end=min(end - start, s.end - start),
                    text=s.text,
                    words=words,
                )
            )
        return out
