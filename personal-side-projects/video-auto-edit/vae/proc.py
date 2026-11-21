"""外部プロセス(FFmpeg など)の実行。必ずこのモジュールを経由する。

- 引数はリストで渡し、シェルを経由しない
- タイムアウトと、常駐メモリ(VmRSS)の上限を見張る。超えたら止める
- stderr はファイルに保存し、エラー時は末尾をエラー文に含める
- 戻り値に最大メモリ(VmHWM, MB)を含める
"""
import os
import subprocess
import tempfile
import time


class ProcError(RuntimeError):
    def __init__(self, cmd, returncode, stderr_tail):
        super().__init__(f"{os.path.basename(cmd[0])} failed ({returncode}): {stderr_tail[-800:]}")
        self.cmd, self.returncode, self.stderr_tail = cmd, returncode, stderr_tail


class MemoryLimitExceeded(ProcError):
    pass


class Timeout(ProcError):
    pass


def run(cmd, timeout=None, mem_limit_mb=None, capture_stdout=False, poll=0.1, cwd=None, env=None):
    """cmd を実行し、dict(returncode, peak_mb, seconds, stdout) を返す。失敗したら ProcError"""
    cmd = [str(c) for c in cmd]
    errf = tempfile.TemporaryFile()
    outf = tempfile.TemporaryFile() if capture_stdout else subprocess.DEVNULL
    t0 = time.time()
    proc = subprocess.Popen(cmd, stdout=outf, stderr=errf, stdin=subprocess.DEVNULL, cwd=cwd, env=env)
    peak = 0

    def tail():
        errf.seek(0)
        return errf.read()[-4000:].decode(errors="replace")

    try:
        while True:
            try:
                with open(f"/proc/{proc.pid}/status") as f:
                    for line in f:
                        if line.startswith("VmHWM:"):
                            peak = max(peak, int(line.split()[1]) // 1024)
                        elif line.startswith("VmRSS:") and mem_limit_mb and int(line.split()[1]) // 1024 > mem_limit_mb:
                            proc.kill()
                            proc.wait()
                            raise MemoryLimitExceeded(cmd, -9, f"memory exceeded {mem_limit_mb}MB")
            except FileNotFoundError:
                pass
            if proc.poll() is not None:
                break
            if timeout and time.time() - t0 > timeout:
                proc.kill()
                proc.wait()
                raise Timeout(cmd, -9, f"timeout after {timeout}s")
            time.sleep(poll)
    finally:
        if proc.poll() is None:          # 例外で抜けたときもプロセスを残さない
            proc.kill()
            proc.wait()
    if proc.returncode != 0:
        raise ProcError(cmd, proc.returncode, tail())
    stdout = b""
    if capture_stdout:
        outf.seek(0)
        stdout = outf.read()
    return {"returncode": proc.returncode, "peak_mb": peak, "seconds": round(time.time() - t0, 3), "stdout": stdout}


def run_text(cmd, timeout=120):
    """短い問い合わせ用(ffprobe など)。stdout を文字列で返す"""
    try:
        r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as e:
        raise Timeout([str(c) for c in cmd], -9, f"timeout after {timeout}s") from e
    if r.returncode != 0:
        raise ProcError(cmd, r.returncode, r.stderr[-2000:])
    return r.stdout


def run_bytes(cmd, timeout=600):
    """stdout をバイト列で受け取る(音声の読み込みなど)"""
    try:
        r = subprocess.run([str(c) for c in cmd], capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as e:
        raise Timeout([str(c) for c in cmd], -9, f"timeout after {timeout}s") from e
    if r.returncode != 0:
        raise ProcError(cmd, r.returncode, r.stderr[-2000:].decode(errors="replace"))
    return r.stdout


def run_stderr(cmd, timeout=600):
    """解析系(ebur128・silencedetect など)用。stderr を文字列で返す。終了コードは問わないが、時間切れは Timeout"""
    try:
        r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, timeout=timeout,
                           stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as e:
        raise Timeout([str(c) for c in cmd], -9, f"timeout after {timeout}s") from e
    return r.stderr


def timeout_for(seconds, factor=10.0, base=300.0):
    """処理対象の長さ(秒)に比例したタイムアウト"""
    return base + factor * max(0.0, float(seconds or 0))
