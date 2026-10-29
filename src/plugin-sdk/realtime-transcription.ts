export type { RealtimeTranscriptionAudioFormat } from "../realtime-transcription/provider-types.js";
export type {
  TranscribeAudioStreamParams,
  TranscribeAudioStreamResult,
} from "../realtime-transcription/utterance-runtime.js";

/** Load selection/auth and execution only when a caller starts transcription. */
export async function transcribeAudioStream(
  params: import("../realtime-transcription/utterance-runtime.js").TranscribeAudioStreamParams,
): Promise<import("../realtime-transcription/utterance-runtime.js").TranscribeAudioStreamResult> {
  const runtime = await import("../realtime-transcription/utterance-runtime.js");
  return runtime.transcribeAudioStream(params);
}
export type { RealtimeTranscriptionProviderPlugin } from "../plugins/types.js";
export type {
  RealtimeTranscriptionProviderConfig,
  RealtimeTranscriptionSession,
  RealtimeTranscriptionSessionCreateRequest,
} from "../realtime-transcription/provider-types.js";
export {
  getRealtimeTranscriptionProvider,
  listRealtimeTranscriptionProviders,
  normalizeRealtimeTranscriptionProviderId,
} from "../realtime-transcription/provider-registry.js";
export {
  createRealtimeTranscriptionWebSocketSession,
  type RealtimeTranscriptionWebSocketTransport,
} from "./realtime-transcription-session.js";
