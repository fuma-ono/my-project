"""映像理解のローカルモデル(無料・CPU)。CLIP(ONNX)と YuNet(顔検出)

モデルは初回にダウンロードして ~/.cache/vae/models に置く(リポジトリには入れない)。
"""
import json
import os
import urllib.request

import numpy as np

CACHE = os.path.expanduser(os.environ.get("VAE_MODEL_DIR", "~/.cache/vae/models"))
CLIP_DIR = os.path.join(CACHE, "clip-vit-b32")
CLIP_FILES = {"vision_model_quantized.onnx": "onnx/vision_model_quantized.onnx",
              "text_model_quantized.onnx": "onnx/text_model_quantized.onnx",
              "tokenizer.json": "tokenizer.json", "preprocessor_config.json": "preprocessor_config.json"}
CLIP_URL = "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/"
YUNET = os.path.join(CACHE, "face_yunet.onnx")
YUNET_URL = ("https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
             "face_detection_yunet/face_detection_yunet_2023mar.onnx")


def ensure_models():
    os.makedirs(CLIP_DIR, exist_ok=True)
    for name, rel in CLIP_FILES.items():
        p = os.path.join(CLIP_DIR, name)
        if not os.path.exists(p):
            urllib.request.urlretrieve(CLIP_URL + rel, p)
    if not os.path.exists(YUNET) or os.path.getsize(YUNET) < 10000:
        urllib.request.urlretrieve(YUNET_URL, YUNET)


class Clip:
    """CLIP ViT-B/32。画像と文の埋め込み(正規化済み)を返す"""

    MEAN = np.array([0.48145466, 0.4578275, 0.40821073], np.float32)
    STD = np.array([0.26862954, 0.26130258, 0.27577711], np.float32)

    def __init__(self):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        ensure_models()
        opt = ort.SessionOptions()
        opt.intra_op_num_threads = max(1, (os.cpu_count() or 2) - 1)
        self.vision = ort.InferenceSession(os.path.join(CLIP_DIR, "vision_model_quantized.onnx"), opt)
        self.text = ort.InferenceSession(os.path.join(CLIP_DIR, "text_model_quantized.onnx"), opt)
        self.tok = Tokenizer.from_file(os.path.join(CLIP_DIR, "tokenizer.json"))
        self.tok.enable_padding(length=77, pad_id=49407)
        self.tok.enable_truncation(77)

    def _prep(self, rgb):
        import cv2
        h, w = rgb.shape[:2]
        s = 224 / min(h, w)
        img = cv2.resize(rgb, (max(224, round(w * s)), max(224, round(h * s))), interpolation=cv2.INTER_AREA)
        y, x = (img.shape[0] - 224) // 2, (img.shape[1] - 224) // 2
        img = img[y:y + 224, x:x + 224].astype(np.float32) / 255.0
        return ((img - self.MEAN) / self.STD).transpose(2, 0, 1)

    def images(self, frames, batch=16):
        out = []
        for i in range(0, len(frames), batch):
            x = np.stack([self._prep(f) for f in frames[i:i + batch]])
            out.append(self.vision.run(None, {"pixel_values": x})[0])
        e = np.concatenate(out) if out else np.zeros((0, 512), np.float32)
        return e / np.maximum(np.linalg.norm(e, axis=1, keepdims=True), 1e-6)

    def texts(self, texts):
        ids = np.array([t.ids for t in self.tok.encode_batch(texts)], np.int64)
        e = self.text.run(None, {"input_ids": ids})[0]
        return e / np.maximum(np.linalg.norm(e, axis=1, keepdims=True), 1e-6)


class Faces:
    def __init__(self):
        import cv2
        ensure_models()
        self.det = cv2.FaceDetectorYN.create(YUNET, "", (320, 320), 0.7, 0.3, 50)

    def __call__(self, rgb):
        """戻り値: [(x, y, w, h, score)]。画像は RGB"""
        import cv2
        h, w = rgb.shape[:2]
        self.det.setInputSize((w, h))
        _, faces = self.det.detect(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        return [] if faces is None else [tuple(map(float, f[:4])) + (float(f[14]),) for f in faces]


def dump(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, default=lambda o: o.tolist() if hasattr(o, "tolist") else str(o))
