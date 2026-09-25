#!/usr/bin/env bash
# kashikari 投書箱(feedbackテーブル)の運営用CLI(105回目)。
# 毎日のフィードバック自動対応(docs/feedback-autopilot.md)から使う。
#
# 認証: Claude Code環境のAPI認証情報「kashikari-supabase」がプロキシで
# apikey / Authorization ヘッダーを自動付与するため、このスクリプト自身は
# 鍵を一切扱わない。SUPABASE_URL だけ環境変数から読む。
#
# 使い方:
#   scripts/feedback.sh check                 # 疎通確認(HTTPステータスを表示)
#   scripts/feedback.sh new                   # status=new の投稿をJSONで一覧
#   scripts/feedback.sh mark <id> <status>    # status を triaged / resolved に更新
set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL が未設定です}"
REST="$SUPABASE_URL/rest/v1"

case "${1:-}" in
  check)
    code=$(curl -sS -o /dev/null -w '%{http_code}' "$REST/feedback?select=id&limit=1")
    echo "feedback select: HTTP $code"
    [ "$code" = "200" ]
    ;;
  new)
    curl -sS --fail-with-body \
      "$REST/feedback?select=id,message,app_version,platform,created_at&status=eq.new&order=created_at.asc"
    ;;
  mark)
    id="${2:?id を指定してください}"
    status="${3:?status(triaged/resolved)を指定してください}"
    case "$status" in triaged|resolved) ;; *) echo "status は triaged / resolved のみ" >&2; exit 2 ;; esac
    curl -sS --fail-with-body -X PATCH \
      -H 'Content-Type: application/json' -H 'Prefer: return=minimal' \
      "$REST/feedback?id=eq.$id" -d "{\"status\":\"$status\"}"
    echo "marked $id as $status"
    ;;
  *)
    sed -n '2,13p' "$0"
    exit 2
    ;;
esac
