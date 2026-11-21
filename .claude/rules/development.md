# 開発規則(VAE)

対象: `personal-side-projects/video-auto-edit/`(製品)、`docs/autonomous-hq/`(HQ の状態)、`docs/projects/video-auto-edit/`(過去の検証記録)、`.claude/`(HQ 基盤)、`.github/workflows/video-auto-edit-ci.yml`。

1. 作業の前に `git status` と現在のブランチ・HEAD を確認する。他人の未コミット変更を消さない
2. 他プロジェクト(FX Event Analyzer・kashikari・threads・note・moyasuka・bgm-pipeline など)のファイルは変更しない。bgm-pipeline は読み取り専用で呼ぶだけ
3. 設計の中心は「解析 → 編集計画(EditPlan JSON) → 書き出し」の分離。UI・CLI・将来の iOS は EditPlan を通してエンジンを使う
4. 外部プロセス(FFmpeg)は必ず `vae.proc.run` 経由で起動する(タイムアウト・終了コード・メモリ上限・stderr の保存)
5. 一時ファイルはジョブの作業フォルダに置き、成功・失敗のどちらでも後始末する。元動画は読むだけで変更しない
6. 依存の追加は無料・オープンソースに限る。追加したら `pyproject.toml` に版の下限を書き、DECISIONS に理由を残す
7. 同じファイルを2つのエージェントが同時に編集しない。並列作業は担当ファイルを分ける
8. コミットはまとまった単位で。コミットメッセージに理由とテスト結果を書く
