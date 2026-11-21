---
paths:
  - "personal-side-projects/video-auto-edit/**"
  - "docs/autonomous-hq/**"
  - "docs/projects/video-auto-edit/**"
  - ".github/workflows/video-auto-edit-ci.yml"
---

# コスト管理規則(VAE)

1. 有料 API・有料サービスを使わない。使う必要が出たら、実行前に停止して HQ が人間に報告する(費用・影響・必要性・無料の代替案)
2. 処理はローカル CPU(faster-whisper、FFmpeg)で行う。1本あたりの外部費用は0円であることを毎回記録する
3. GitHub Actions は動画編集のパスが変わったときだけ動かす。重いテスト(Whisper 実モデル)は手動実行かラベル付きのときだけ
4. 30秒無料枠: 入力動画の長さで判定する。無料枠を超える処理は「有料プラン用の拡張点」で止める(現時点では課金処理を実装しない)
5. ディスク: 作業フォルダは期限で削除。ディスク残量が 2GB 未満のときは新しいジョブを受け付けない
