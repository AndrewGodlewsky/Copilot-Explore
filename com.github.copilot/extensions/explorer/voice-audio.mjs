export function microphoneIndex(name, devices) {
  if (!name) return -1;
  const matches = devices.flatMap((device, index) => device === name ? [index] : []);
  if (matches.length !== 1) throw Object.assign(new Error(matches.length
    ? 'Multiple microphones have the same name. Rename them in Windows or choose System default.'
    : 'Selected microphone is unavailable. Reconnect it or choose another in Voice settings.'), { code: 'VOICE_DEVICE' });
  return matches[0];
}

export function audioLevel(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += (sample / 32768) ** 2;
  const rms = Math.sqrt(sum / samples.length);
  return rms === 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
}
