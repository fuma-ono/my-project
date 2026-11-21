# RELEASE_STATUS

| 環境 | 状態 | 備考 |
|---|---|---|
| main | **統合済み**(PR #6 を squash マージ、f497d68、2026-11-21) | CI 成功(f50bb54)・独立レビュー合格(blocker・major 0) |
| 開発ブランチ | `claude/video-autoedit-followup-1`(main f497d68 から作成、PR #16) | 統合後の作業。旧ブランチ `claude/video-autoedit-tech-verification` は f50bb54(統合済みの履歴)のまま残す(強制 push は行わない) |
| CI | `video-auto-edit-ci`(VAE のパスが変わったときだけ動く) | 結果は PROJECT_STATE.md に記録 |
| DEV | **ローカル起動のみ**(`make web` → http://127.0.0.1:8765)。main で確認済み(2026-11-21: 速いテスト 82 passed、ui_smoke PASS、CLI で実動画 IMG_4217 の検証合格) | ホスティング先は未契約(BLOCKERS B-2) |
| 本番 | **未公開**。公開には人間の承認が必要 | — |

## リリース前に人間の承認が必要なこと
1. 本番環境への公開(ホスティング先・公開範囲)
2. 課金が発生する操作(有料ホスティング、有料の計算資源)
3. 有料サービスの契約・有料 API の導入(決済サービスなど)
