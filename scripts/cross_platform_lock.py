from __future__ import annotations

import os
from typing import BinaryIO


if os.name == "nt":
    import msvcrt

    def try_exclusive_lock(stream: BinaryIO) -> bool:
        stream.seek(0)
        try:
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            return True
        except OSError as exc:
            if exc.errno in {13, 36} or getattr(exc, "winerror", None) in {33, 36}:
                return False
            raise

    def unlock(stream: BinaryIO) -> None:
        stream.seek(0)
        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)

else:
    import fcntl

    def try_exclusive_lock(stream: BinaryIO) -> bool:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            return False

    def unlock(stream: BinaryIO) -> None:
        fcntl.flock(stream, fcntl.LOCK_UN)
