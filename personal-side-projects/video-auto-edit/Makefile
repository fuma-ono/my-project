# 動画自動編集AI(VAE)
PY ?= .venv/bin/python

setup:            ## 仮想環境と依存を用意する(無料・ローカル)
	python3 -m venv .venv
	$(PY) -m pip install -q -e ".[test,bgm]"

test:             ## 速いテスト
	$(PY) -m pytest -m "not slow" -q

test-all:         ## 実モデルを使うテストを含む
	$(PY) -m pytest -q

web:              ## ローカル Web UI(http://127.0.0.1:8765)
	$(PY) -m vae web
