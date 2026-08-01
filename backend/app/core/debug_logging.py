"""
Debug logging helpers for optimiser/flow diagnostic output.
"""
import builtins
import sys

from app.core.config import settings


def debug_print(*args, **kwargs) -> None:
    """Print debug text without failing on legacy console encodings."""
    if not settings.DEBUG_OPTIMIZER_LOGS:
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
