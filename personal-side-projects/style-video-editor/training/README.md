# training/

GPU学習環境の「ソフトウェア側の準備」として作成。`docs/gpu-environment.md`参照。

## 何を作ったか

`train_style_model.py` — `tools/analyze_style.py`が出力するカット割りの時系列データを学習データに、「このスタイルなら次のカットは何秒後に来そうか」を予測する小さなLSTMモデル。GPUが利用可能な環境ではコード変更なしに自動でGPUを使う(`torch.cuda.is_available()`で自動判定)。

## 今回、実際に動作確認したこと

**このサンドボックスにはGPUがないため、CPU上・合成データ(乱数)で学習ループそのものが正しく動くことを確認した。**

```
$ python3 train_style_model.py --synthetic --epochs 20
使用デバイス: cpu
学習サンプル数: 3000 / スタイル数: 3 (['fast_cut', 'slow_vlog', 'medium_explainer'])
epoch   1/20  loss=5.3626
epoch  20/20  loss=0.9253
モデルを保存しました: style_rhythm_model.pt
```

lossが5.36→0.93まで下がっており、3つの架空スタイル(fast_cut/slow_vlog/medium_explainer、いずれも乱数生成)のリズムの違いを学習できていることを確認した。**実在クリエイターのデータは一切使用していない**(`docs/legal-policy.md`の方針通り)。

## 実データに切り替える方法

1. `tools/analyze_style.py`で複数の参考動画(自作・許諾済みのもの)を解析し、`--out`でJSONを`tools/profiles/`等に出力する
2. `python3 train_style_model.py --profiles-dir ../tools/profiles --epochs 100` で実データを使った学習に切り替わる(コード変更不要)
3. GPU環境(`docs/gpu-environment.md`)が用意できれば、同じコードがそのままGPUを使う

## 現状の位置づけ

まだ「動くことを確認しただけ」の段階。意味のある学習をさせるには、①実際の参考動画からのスタイルプロファイル(複数)②検証で需要が確認できていること、の両方が必要。詳細は`../docs/validation-plan.md`。
