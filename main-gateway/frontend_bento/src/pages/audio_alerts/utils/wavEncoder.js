// Encodes a decoded AudioBuffer as a 16-bit PCM mono WAV Blob. Used to turn a
// MediaRecorder recording (webm/ogg — not accepted by the clip player's
// hardcoded wav/mp3 mimetype logic) into a format the backend already knows
// how to store and serve back correctly, with no backend changes needed.
export function audioBufferToWavBlob(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const samples = downmixToMono(audioBuffer);

  const dataSize = samples.length * 2; // 16-bit samples
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function downmixToMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) return audioBuffer.getChannelData(0);
  const out = new Float32Array(audioBuffer.length);
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / audioBuffer.numberOfChannels;
  }
  return out;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
