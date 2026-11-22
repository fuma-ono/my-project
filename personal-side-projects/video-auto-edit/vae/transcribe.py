"""文字起こし(faster-whisper、CPU、int8)。テストでは Transcriber を差し替える"""
from dataclasses import dataclass

_MODELS = {}


@dataclass
class Transcript:
    words: list          # dict(s, e, w, p)
    segments: list       # dict(s, e, text)
    language: str


class WhisperTranscriber:
    def __init__(self, model="medium", compute_type="int8", beam_size=5, deterministic=False):
        self.model_name, self.compute_type, self.beam_size = model, compute_type, beam_size
        self.deterministic = deterministic
        # deterministic: 毎回同じ結果にする(ランダムな再試行を切り、直前の文に引きずられず、無音を飛ばす)。ハイライト用

    def _model(self):
        key = (self.model_name, self.compute_type)
        if key not in _MODELS:                     # 1プロセスで使い回す(読み込みは初回のみ)
            from faster_whisper import WhisperModel
            _MODELS[key] = WhisperModel(self.model_name, device="cpu", compute_type=self.compute_type)
        return _MODELS[key]

    def __call__(self, audio16k) -> Transcript:
        extra = dict(temperature=0.0, condition_on_previous_text=False, vad_filter=True,
                     vad_parameters=dict(min_silence_duration_ms=500)) if self.deterministic else {}
        segs, info = self._model().transcribe(audio16k, language="ja", word_timestamps=True, beam_size=self.beam_size, **extra)
        segs = list(segs)
        words = [dict(s=float(w.start), e=float(w.end), w=w.word, p=round(float(w.probability), 3))
                 for s in segs for w in (s.words or [])]
        return Transcript(words=words, segments=[dict(s=float(s.start), e=float(s.end), text=s.text) for s in segs],
                          language=info.language)
