import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { userInput } from './inputs.ts';

const run = promisify(execFile);

export type Probe = {
  duration: number;
  /**
   * `width`/`height` are the size frames come out of the decoder: upright, as the browser shows
   * them (ffmpeg applies the rotation tag). `vfr`: frames are not evenly spaced, decode them
   * resampled to `fps` or counting frames runs ahead of the clock.
   */
  video: { width: number; height: number; fps: number; frames: number; matrix: string | null; vfr: boolean } | null;
  /** Số kênh của luồng tiếng đầu; 0 = không có tiếng. */
  channels: number;
};

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    // File của người dùng: chỉ demuxer media thường (inputs.ts).
    ...userInput(file),
    '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,r_frame_rate,color_space,channels:stream_side_data=rotation:stream_tags=rotate:format=duration',
    '-of', 'json',
    file,
  ]);
  const json = JSON.parse(stdout) as {
    streams: {
      codec_type: string;
      channels?: number;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      color_space?: string;
      side_data_list?: { rotation?: number }[];
      tags?: { rotate?: string };
    }[];
    format: { duration?: string };
  };
  const duration = Number(json.format.duration ?? 0);
  const video = json.streams.find((stream) => stream.codec_type === 'video');
  const rate = (text?: string) => {
    const [num, den] = (text ?? '0/1').split('/').map(Number);
    return den ? num! / den : 0;
  };
  const nominal = rate(video?.r_frame_rate);
  const average = rate(video?.avg_frame_rate);
  // A phone or screen recording drops frames: the nominal rate overstates it, and counting decoded
  // frames at that rate plays the clip too fast. Those are resampled to their average rate.
  const vfr = nominal > 0 && average > 0 && Math.abs(nominal - average) / nominal > 0.01;
  const fps = (vfr ? average : nominal || average) || 30;
  // Portrait phone video is often coded landscape with a rotation tag.
  const rotation = Number(video?.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0);
  const sideways = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  return {
    duration,
    video: video
      ? {
          width: (sideways ? video.height : video.width) ?? 0,
          height: (sideways ? video.width : video.height) ?? 0,
          fps,
          frames: Math.max(1, Math.floor(duration * fps)),
          // Luồng không ghi ma trận màu: Chromium (thứ người dùng nhìn khi sửa) giải
          // theo BT.709, ffmpeg mặc định BT.601 — đỏ lệch thành cam. Theo Chromium.
          matrix: !video.color_space || video.color_space === 'unknown' ? 'bt709' : null,
          vfr,
        }
      : null,
    channels: json.streams.find((stream) => stream.codec_type === 'audio')?.channels ?? 0,
  };
}
