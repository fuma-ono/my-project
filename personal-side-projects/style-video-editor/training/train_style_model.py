#!/usr/bin/env python3
"""
スタイル別カットリズム学習モデル(第二段階向け、GPU環境の雛形)

`tools/analyze_style.py`が出力する「スタイルプロファイル」(カット割りの
時系列データ)を学習データとして、「このスタイルなら次のカットは何秒後に
来そうか」を予測する小さなモデル。第一段階のルールベース編集エンジンを
実際のデータで裏付け・精緻化するための土台。

**現時点で実在クリエイターの動画由来のデータは一切使っていない。**
参考動画が集まるまでは合成データ(--synthetic)で学習ループの動作確認のみ
行う。docs/legal-policy.mdの方針(自社制作/許諾済み素材限定)に従い、
実データに差し替える際も出所を確認すること。

GPUが利用可能な環境で実行すれば自動的にGPUを使う(コード変更不要)。
現状のサンドボックスにはGPUがないためCPUで動作確認済み。

使い方:
    # 合成データでの動作確認(今すぐ実行できる)
    python3 train_style_model.py --synthetic --epochs 20

    # 実データでの学習(analyze_style.pyの出力が複数集まってから)
    python3 train_style_model.py --profiles-dir ../tools/profiles --epochs 100
"""
import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

STYLE_NAMES = ["fast_cut", "slow_vlog", "medium_explainer"]


class ShotSequenceDataset(Dataset):
    """(スタイルID, これまでのショット長の並び) -> 次のショット長 のデータセット。"""

    def __init__(self, sequences_by_style: dict[str, list[list[float]]], seq_len: int = 5):
        self.samples = []
        self.style_to_id = {name: i for i, name in enumerate(sequences_by_style)}
        for style_name, sequences in sequences_by_style.items():
            style_id = self.style_to_id[style_name]
            for seq in sequences:
                for i in range(len(seq) - seq_len):
                    window = seq[i : i + seq_len]
                    target = seq[i + seq_len]
                    self.samples.append((style_id, window, target))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        style_id, window, target = self.samples[idx]
        return (
            torch.tensor(style_id, dtype=torch.long),
            torch.tensor(window, dtype=torch.float32).unsqueeze(-1),  # (seq_len, 1)
            torch.tensor(target, dtype=torch.float32),
        )


class StyleRhythmModel(nn.Module):
    """スタイル埋め込み + LSTM で次のショット長を予測する小さなモデル。"""

    def __init__(self, n_styles: int, style_dim: int = 8, hidden_dim: int = 16):
        super().__init__()
        self.style_embed = nn.Embedding(n_styles, style_dim)
        self.lstm = nn.LSTM(input_size=1 + style_dim, hidden_size=hidden_dim, batch_first=True)
        self.head = nn.Linear(hidden_dim, 1)

    def forward(self, style_id, shot_seq):
        # shot_seq: (batch, seq_len, 1)
        batch, seq_len, _ = shot_seq.shape
        style_vec = self.style_embed(style_id).unsqueeze(1).expand(-1, seq_len, -1)
        x = torch.cat([shot_seq, style_vec], dim=-1)
        _, (h_n, _) = self.lstm(x)
        return self.head(h_n[-1]).squeeze(-1)


def make_synthetic_sequences(n_sequences_per_style: int = 40, seq_length: int = 30, seed: int = 0):
    """
    合成データ生成。実在クリエイターのデータは一切使わない。
    3つの架空スタイルそれぞれについて、平均・ばらつきの異なる
    ショット長(カットの長さ)の時系列を乱数で作る。
    """
    rng = random.Random(seed)
    style_params = {
        "fast_cut": (0.8, 0.3),         # 平均0.8秒、ばらつき小(テンポの速い編集)
        "slow_vlog": (4.0, 1.5),        # 平均4秒、ばらつき大(ゆったりした編集)
        "medium_explainer": (2.0, 0.6),  # 平均2秒、中間
    }
    sequences_by_style = {}
    for style_name, (mean, std) in style_params.items():
        seqs = []
        for _ in range(n_sequences_per_style):
            seq = [max(0.2, rng.gauss(mean, std)) for _ in range(seq_length)]
            seqs.append(seq)
        sequences_by_style[style_name] = seqs
    return sequences_by_style


def load_real_profiles(profiles_dir: str) -> dict[str, list[list[float]]]:
    """tools/analyze_style.py が出力したJSON群からショット長の時系列を読み込む。"""
    sequences_by_style = {}
    for path in Path(profiles_dir).glob("*.json"):
        profile = json.loads(path.read_text(encoding="utf-8"))
        style_name = profile.get("style_name", "unnamed_style")
        lengths = [shot["length_sec"] for shot in profile.get("shots", [])]
        if len(lengths) < 6:
            continue
        sequences_by_style.setdefault(style_name, []).append(lengths)
    return sequences_by_style


def train(sequences_by_style: dict[str, list[list[float]]], epochs: int, seq_len: int = 5):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"使用デバイス: {device}")

    dataset = ShotSequenceDataset(sequences_by_style, seq_len=seq_len)
    if len(dataset) == 0:
        raise SystemExit("学習サンプルが0件です。シーケンスが短すぎるか、データが足りません。")
    loader = DataLoader(dataset, batch_size=32, shuffle=True)

    model = StyleRhythmModel(n_styles=len(dataset.style_to_id)).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.MSELoss()

    print(f"学習サンプル数: {len(dataset)} / スタイル数: {len(dataset.style_to_id)} ({list(dataset.style_to_id)})")

    for epoch in range(1, epochs + 1):
        total_loss = 0.0
        for style_id, window, target in loader:
            style_id, window, target = style_id.to(device), window.to(device), target.to(device)
            optimizer.zero_grad()
            pred = model(style_id, window)
            loss = loss_fn(pred, target)
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(style_id)
        avg_loss = total_loss / len(dataset)
        if epoch == 1 or epoch % max(1, epochs // 10) == 0 or epoch == epochs:
            print(f"epoch {epoch:3d}/{epochs}  loss={avg_loss:.4f}")

    return model, dataset.style_to_id


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--synthetic", action="store_true", help="合成データで学習ループの動作確認をする")
    parser.add_argument("--profiles-dir", default=None, help="analyze_style.py出力JSONが入ったディレクトリ")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--save", default="style_rhythm_model.pt")
    args = parser.parse_args()

    if args.synthetic:
        print("[synthetic] 実在クリエイターのデータは使用していません。動作確認用の乱数データです。")
        sequences_by_style = make_synthetic_sequences()
    elif args.profiles_dir:
        sequences_by_style = load_real_profiles(args.profiles_dir)
        if not sequences_by_style:
            raise SystemExit(f"{args.profiles_dir} に有効なプロファイルが見つかりませんでした。")
    else:
        raise SystemExit("--synthetic か --profiles-dir のどちらかを指定してください。")

    model, style_to_id = train(sequences_by_style, epochs=args.epochs)

    torch.save({"model_state": model.state_dict(), "style_to_id": style_to_id}, args.save)
    print(f"モデルを保存しました: {args.save}")


if __name__ == "__main__":
    main()
