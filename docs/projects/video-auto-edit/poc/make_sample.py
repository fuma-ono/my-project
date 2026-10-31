# テスト入力の生成: 日本語TTS音声 + 意図的な無音 + 言い淀み、映像は ffmpeg の testsrc2
import numpy as np, pyopenjtalk, soundfile as sf, subprocess
SR = 48000
parts = [
  ("こんにちは。今日は、動画の自動編集を試してみます。", 1.5),
  ("えーと、", 1.2),
  ("まず、音声を文字に起こして、話している部分だけを残します。", 2.5),
  ("次に、無音の部分を自動でカットします。", 3.0),
  ("あのー、", 1.0),
  ("最後に、テロップとBGMを付けて書き出します。", 1.5),
  ("ご視聴ありがとうございました。", 1.0),
]
chunks = [np.zeros(int(SR*0.8))]
for text, gap in parts:
    x, sr = pyopenjtalk.tts(text); assert sr == SR
    chunks += [x/32768*0.6, np.zeros(int(SR*gap))]
a = np.concatenate(chunks).astype("float32")
a += (np.random.randn(len(a))*0.002).astype("float32")  # 室内ノイズ相当
sf.write("samples/speech.wav", a, SR)
dur = len(a)/SR; print("duration", round(dur,2))
subprocess.run(["ffmpeg","-y","-loglevel","error","-f","lavfi","-i",f"testsrc2=size=1280x720:rate=30:duration={dur}",
  "-i","samples/speech.wav","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-shortest","samples/input.mp4"], check=True)
