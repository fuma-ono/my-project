"""利用者に見せるエラー(原因と対処を日本語で持つ)"""


class VAEError(Exception):
    """利用者に表示してよいエラー。code は UI やテストで判定に使う短い識別子"""

    def __init__(self, code: str, message: str, hint: str = ""):
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message
        self.hint = hint

    def to_dict(self):
        return {"code": self.code, "message": self.message, "hint": self.hint}


def unsupported(detail=""):
    return VAEError("unsupported_format", "この形式の動画には対応していません。" + detail,
                    "MP4・MOV・M4V・MKV・WEBM の動画を選んでください。スマートフォンで撮影した動画はそのまま使えます。")


def broken(detail=""):
    return VAEError("broken_file", "動画ファイルを読み込めませんでした(壊れているか、動画ではない可能性があります)。" + detail,
                    "別の動画を選ぶか、撮影アプリで再保存してから試してください。")


def no_audio():
    return VAEError("no_audio", "この動画には音声が入っていません。",
                    "話し声が入った動画を選んでください。自動カットと字幕は音声をもとに作ります。")


def too_short(sec):
    return VAEError("too_short", f"動画が短すぎます({sec:.1f}秒)。",
                    "1秒以上の動画を選んでください。")


def over_plan_limit(sec, limit, plan):
    return VAEError("over_plan_limit", f"動画の長さ({sec:.1f}秒)が、{plan}プランの上限({limit:.0f}秒)を超えています。",
                    f"{limit:.0f}秒以内に切り出した動画を選んでください。長い動画は今後の有料プランで対応予定です。")


def no_speech():
    return VAEError("no_speech", "話し声が見つかりませんでした。",
                    "声がはっきり入った動画を選んでください。BGM だけの動画は自動編集できません。")


def disk_full(free_gb):
    return VAEError("disk_full", f"保存領域の空きが足りません(残り {free_gb:.1f}GB)。",
                    "古いジョブを削除してから、もう一度試してください。")


def internal(detail=""):
    return VAEError("internal", "処理中に予期しないエラーが起きました。" + detail,
                    "もう一度試してください。続く場合は、エラーの詳細を開発者に伝えてください。")
