"""唯一启动入口：python main.py；Ctrl+C 关闭本次启动的所有服务。"""
import sys

sys.dont_write_bytecode = True

from music_app.launcher import main

if __name__ == "__main__":
    raise SystemExit(main())
