"""The editor's transcript file: the shape `<captions src>` reads.

Mốc thời gian tính từ giây 0 của FILE mà editor mở (`master.mp4`).
"""

from __future__ import annotations

import json

from ..models import TranscriptSegment


def to_ds_transcript(segments: list[TranscriptSegment]) -> str:
    """Transcript ở hình dạng NATIVE của Diffusion Studio, cho `<captions src>`.

    `[{text, words: [{text, start, end}]}]`, mốc tính bằng GIÂY và gốc 0 là giây
    0 của FILE mà editor mở (`master.mp4`) — cùng thang với `sourceIn` trong TSX.

    Vì sao không dùng `.srt`: parser SRT của DS bịa mốc từng từ theo độ dài ký
    tự, vì cue SRT không mang word timing. Preset cho video dọc hiện TỪNG TỪ,
    nên chỗ bịa đó lệch nhìn thấy được. Ta có word timing thật, và
    `resolveTranscript` nhận `.json` thẳng, không qua parser.

    """
    out = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        words = [
            {"text": word.text, "start": round(max(0.0, word.start), 3),
             "end": round(max(0.0, word.end), 3)}
            for word in (segment.words or [])
            if word.text.strip()
        ]
        # Không có word timing thì dựng MỘT "từ" trải hết câu. Rải đều theo ký
        # tự là chính cái bẫy của parser SRT mà ta đang tránh — một khối chữ
        # hiện trọn câu thì thà thế còn hơn nhấn sai từ.
        out.append({
            "text": text,
            "words": words or [
                {"text": text,
                 "start": round(max(0.0, segment.start), 3),
                 "end": round(max(0.0, segment.end), 3)}
            ],
        })
    return json.dumps(out, ensure_ascii=False)
