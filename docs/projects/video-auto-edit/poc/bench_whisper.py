import sys, time, resource, soundfile as sf
from faster_whisper import WhisperModel
m = sys.argv[1]
a, _ = sf.read("work/a16k.wav", dtype="float32")
t = time.time(); model = WhisperModel(m, device="cpu", compute_type="int8"); lt = time.time() - t
t = time.time(); segs, _ = model.transcribe(a, language="ja", word_timestamps=True, beam_size=5); txt = "".join(s.text for s in segs); tt = time.time() - t
print(f"{m}\tload={lt:.1f}s\ttranscribe={tt:.1f}s\taudio={len(a)/16000:.1f}s\tRTF={tt/(len(a)/16000):.2f}\tpeakRSS={resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024:.0f}MB\t{txt}")
