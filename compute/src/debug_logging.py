"""Safe debug logging helpers for compute modules."""

import builtins
import os
import sys


_TRUE_VALUES = {"1", "true", "yes", "on"}


def debug_enabled() -> bool:
    """Return whether verbose compute diagnostics should be written."""
    return os.getenv("DEBUG_OPTIMIZER_LOGS", "").strip().lower() in _TRUE_VALUES


def debug_print(*args, **kwargs) -> None:
    """Write debug text without failing on legacy console encodings."""
    if not debug_enabled():
        return

    try:
        builtins.print(*args, **kwargs)
    except UnicodeEncodeError:
        sep = kwargs.get("sep", " ")
        end = kwargs.get("end", "\n")
        output = kwargs.get("file", sys.stdout) or sys.stdout
        flush = bool(kwargs.get("flush", False))
        text = sep.join(str(arg) for arg in args) + end
        encoding = getattr(output, "encoding", None) or "utf-8"
        safe_text = text.encode(
            encoding,
            errors="backslashreplace",
        ).decode(encoding, errors="replace")
        output.write(safe_text)
        if flush:
            output.flush()
