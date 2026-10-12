/** True for audio recordings the transcriber can read. */
export function isAudioFile(f: File): boolean {
  return f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm)$/i.test(f.name);
}
