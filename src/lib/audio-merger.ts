/**
 * Client-side audio merger: combines multiple audio blobs into a single
 * continuous WAV blob for gapless background playback.
 *
 * Returns the merged blob URL and time markers for each page boundary.
 */

/** Silence duration (seconds) between pages for natural pacing */
const PAGE_GAP = 0.4;

/** Decode an audio blob into an AudioBuffer */
async function decodeBlob(
  ctx: AudioContext,
  blob: Blob
): Promise<AudioBuffer> {
  const arrayBuf = await blob.arrayBuffer();
  return ctx.decodeAudioData(arrayBuf);
}

/** Convert an AudioBuffer to a WAV Blob */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  // WAV header
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, headerSize + dataSize - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave channel data
  let offset = headerSize;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = buffer.getChannelData(ch)[i];
      // Clamp to [-1, 1]
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export interface MergeResult {
  /** Object URL for the merged audio */
  blobUrl: string;
  /** Time markers: pageMarkers[i] = start time in seconds for page i */
  pageMarkers: number[];
  /** Total duration in seconds */
  totalDuration: number;
}

export interface MergeProgress {
  phase: "decoding" | "merging" | "encoding";
  current: number;
  total: number;
}

/**
 * Merge multiple audio blobs into a single continuous WAV.
 *
 * @param blobs - Array of audio blobs, one per page
 * @param onProgress - Progress callback
 * @returns MergeResult with blob URL and page time markers
 */
export async function mergeAudioBlobs(
  blobs: Blob[],
  onProgress?: (p: MergeProgress) => void
): Promise<MergeResult> {
  if (blobs.length === 0) {
    throw new Error("No audio blobs to merge");
  }

  // Single page — no merge needed
  if (blobs.length === 1) {
    const url = URL.createObjectURL(blobs[0]);
    const ctx = new AudioContext();
    const buf = await decodeBlob(ctx, blobs[0]);
    await ctx.close();
    return { blobUrl: url, pageMarkers: [0], totalDuration: buf.duration };
  }

  const ctx = new AudioContext();
  const buffers: AudioBuffer[] = [];

  // Phase 1: Decode all blobs
  for (let i = 0; i < blobs.length; i++) {
    onProgress?.({ phase: "decoding", current: i + 1, total: blobs.length });
    const buf = await decodeBlob(ctx, blobs[i]);
    buffers.push(buf);
  }

  // Phase 2: Calculate total length with gaps
  onProgress?.({ phase: "merging", current: 0, total: 1 });

  const sampleRate = buffers[0].sampleRate;
  const numChannels = Math.max(...buffers.map((b) => b.numberOfChannels));
  const gapSamples = Math.round(PAGE_GAP * sampleRate);

  let totalSamples = 0;
  const pageMarkers: number[] = [];

  for (let i = 0; i < buffers.length; i++) {
    pageMarkers.push(totalSamples / sampleRate);
    // Resample if needed (simple: just use channel 0 data)
    totalSamples += buffers[i].length;
    if (i < buffers.length - 1) {
      totalSamples += gapSamples; // silence gap between pages
    }
  }

  // Create merged buffer
  const merged = ctx.createBuffer(numChannels, totalSamples, sampleRate);

  let pos = 0;
  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    for (let ch = 0; ch < numChannels; ch++) {
      const srcCh = ch < buf.numberOfChannels ? ch : 0;
      merged.getChannelData(ch).set(buf.getChannelData(srcCh), pos);
    }
    pos += buf.length;
    if (i < buffers.length - 1) {
      // Gap is already zeros (Float32Array default)
      pos += gapSamples;
    }
  }

  onProgress?.({ phase: "merging", current: 1, total: 1 });

  // Phase 3: Encode to WAV
  onProgress?.({ phase: "encoding", current: 0, total: 1 });
  const wavBlob = audioBufferToWav(merged);
  const blobUrl = URL.createObjectURL(wavBlob);
  onProgress?.({ phase: "encoding", current: 1, total: 1 });

  await ctx.close();

  return {
    blobUrl,
    pageMarkers,
    totalDuration: totalSamples / sampleRate,
  };
}

/**
 * Given a playback time and page markers, find the current page index.
 */
export function getPageAtTime(
  time: number,
  pageMarkers: number[]
): number {
  let page = 0;
  for (let i = pageMarkers.length - 1; i >= 0; i--) {
    if (time >= pageMarkers[i]) {
      page = i;
      break;
    }
  }
  return page;
}
