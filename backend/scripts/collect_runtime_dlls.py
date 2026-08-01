"""Collect native runtime DLLs required by packaged Windows backend builds.

PyInstaller normally discovers most Python dependencies itself. Conda based
Python installations, however, often keep native DLL dependencies in
``Library/bin`` instead of next to the ``.pyd`` extension module. This helper
analyses the import table of Python extension modules and copies those runtime
DLLs into a staging directory so the local desktop build can pass them to
PyInstaller explicitly.
"""

from __future__ import annotations

import shutil
import site
import struct
import sys
from pathlib import Path


PE_SIGNATURE = b"PE\0\0"
IMPORT_DIRECTORY_INDEX = 1
SECTION_HEADER_SIZE = 40

IGNORED_DLL_NAMES = {
    "advapi32.dll",
    "bcrypt.dll",
    "bcryptprimitives.dll",
    "cabinet.dll",
    "comctl32.dll",
    "comdlg32.dll",
    "crypt32.dll",
    "dbghelp.dll",
    "dnsapi.dll",
    "gdi32.dll",
    "imm32.dll",
    "iphlpapi.dll",
    "kernel32.dll",
    "msi.dll",
    "msvcrt.dll",
    "netapi32.dll",
    "ntdll.dll",
    "ole32.dll",
    "oleaut32.dll",
    "python3.dll",
    f"python{sys.version_info.major}{sys.version_info.minor}.dll",
    "rpcrt4.dll",
    "secur32.dll",
    "shell32.dll",
    "shlwapi.dll",
    "user32.dll",
    "userenv.dll",
    "version.dll",
    "winmm.dll",
    "ws2_32.dll",
}


def _read_c_string(data: bytes, offset: int) -> str | None:
    """Read a null-terminated ASCII string from a PE file byte buffer."""
    if offset < 0 or offset >= len(data):
        return None
    end = data.find(b"\0", offset)
    if end == -1:
        return None
    try:
        return data[offset:end].decode("ascii")
    except UnicodeDecodeError:
        return None


def _rva_to_offset(rva: int, sections: list[dict[str, int]]) -> int | None:
    """Map a PE relative virtual address to a file offset."""
    for section in sections:
        start = section["virtual_address"]
        size = max(section["virtual_size"], section["raw_size"])
        end = start + size
        if start <= rva < end:
            return section["raw_pointer"] + (rva - start)
    return None


def read_imported_dll_names(binary_path: Path) -> set[str]:
    """Return DLL names imported by a Windows PE binary."""
    try:
        data = binary_path.read_bytes()
    except OSError:
        return set()

    if len(data) < 0x40 or data[:2] != b"MZ":
        return set()

    try:
        pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
        if data[pe_offset : pe_offset + 4] != PE_SIGNATURE:
            return set()

        coff_offset = pe_offset + 4
        section_count = struct.unpack_from("<H", data, coff_offset + 2)[0]
        optional_header_size = struct.unpack_from("<H", data, coff_offset + 16)[0]
        optional_offset = coff_offset + 20
        optional_magic = struct.unpack_from("<H", data, optional_offset)[0]

        if optional_magic == 0x10B:
            data_directory_offset = optional_offset + 96
        elif optional_magic == 0x20B:
            data_directory_offset = optional_offset + 112
        else:
            return set()

        import_directory_offset = data_directory_offset + IMPORT_DIRECTORY_INDEX * 8
        import_rva, _import_size = struct.unpack_from("<II", data, import_directory_offset)
        if import_rva == 0:
            return set()

        sections_offset = optional_offset + optional_header_size
        sections: list[dict[str, int]] = []
        for index in range(section_count):
            section_offset = sections_offset + index * SECTION_HEADER_SIZE
            virtual_size, virtual_address, raw_size, raw_pointer = struct.unpack_from(
                "<IIII", data, section_offset + 8
            )
            sections.append(
                {
                    "virtual_size": virtual_size,
                    "virtual_address": virtual_address,
                    "raw_size": raw_size,
                    "raw_pointer": raw_pointer,
                }
            )

        descriptor_offset = _rva_to_offset(import_rva, sections)
        if descriptor_offset is None:
            return set()

        imports: set[str] = set()
        while descriptor_offset + 20 <= len(data):
            descriptor = struct.unpack_from("<IIIII", data, descriptor_offset)
            if descriptor == (0, 0, 0, 0, 0):
                break
            name_rva = descriptor[3]
            name_offset = _rva_to_offset(name_rva, sections)
            if name_offset is not None:
                name = _read_c_string(data, name_offset)
                if name:
                    imports.add(name)
            descriptor_offset += 20

        return imports
    except (struct.error, IndexError):
        return set()


def _is_relative_to(path: Path, root: Path) -> bool:
    """Return true when ``path`` is inside ``root``."""
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _python_environment_roots() -> list[Path]:
    """Return Python installation roots that may contain native DLLs."""
    raw_roots = {
        Path(sys.prefix),
        Path(sys.base_prefix),
        Path(sys.exec_prefix),
        Path(sys.base_exec_prefix),
    }
    roots: list[Path] = []
    seen: set[Path] = set()
    for root in raw_roots:
        resolved = root.resolve()
        if resolved not in seen and resolved.exists():
            roots.append(resolved)
            seen.add(resolved)
    return roots


def _site_package_roots() -> list[Path]:
    """Return in-environment site-package roots with native package binaries."""
    candidates: list[str] = []
    try:
        candidates.extend(site.getsitepackages())
    except AttributeError:
        pass

    roots: list[Path] = []
    seen: set[Path] = set()
    environment_roots = _python_environment_roots()
    for candidate in candidates:
        path = Path(candidate)
        if not path.exists():
            continue
        resolved = path.resolve()
        if resolved in seen:
            continue
        if not any(_is_relative_to(resolved, root) for root in environment_roots):
            continue
        roots.append(resolved)
        seen.add(resolved)
    return roots


def _iter_binary_seeds() -> list[Path]:
    """Find native Python binaries whose imports should be analysed."""
    seeds: list[Path] = []
    seen: set[Path] = set()

    for root in _python_environment_roots():
        directory = root / "DLLs"
        if not directory.exists():
            continue
        for path in directory.glob("*.pyd"):
            resolved = path.resolve()
            if resolved not in seen:
                seeds.append(resolved)
                seen.add(resolved)

    for root in _site_package_roots():
        for pattern in ("*.pyd", "*.dll"):
            for path in root.rglob(pattern):
                resolved = path.resolve()
                if resolved not in seen:
                    seeds.append(resolved)
                    seen.add(resolved)

    return seeds


def _build_dll_index() -> dict[str, Path]:
    """Index DLLs available in the active Python environment."""
    index: dict[str, Path] = {}

    search_roots: list[tuple[Path, bool]] = []
    for root in _python_environment_roots():
        search_roots.extend(
            [
                (root / "Library" / "bin", False),
                (root / "DLLs", False),
                (root, False),
            ]
        )
    search_roots.extend((root, True) for root in _site_package_roots())

    for root, recursive in search_roots:
        if not root.exists():
            continue
        iterator = root.rglob("*.dll") if recursive else root.glob("*.dll")
        for path in iterator:
            if path.name.lower().endswith(".conda_trash"):
                continue
            index.setdefault(path.name.lower(), path.resolve())

    return index


def _is_system_dll(dll_name: str) -> bool:
    """Return true for Windows system DLLs that should not be bundled."""
    normalised = dll_name.lower()
    return (
        normalised in IGNORED_DLL_NAMES
        or normalised.startswith("api-ms-win-")
        or normalised.startswith("ext-ms-win-")
    )


def collect_runtime_dlls(output_dir: Path) -> tuple[list[Path], list[str]]:
    """Copy runtime DLLs needed by native Python binaries into ``output_dir``."""
    output_dir.mkdir(parents=True, exist_ok=True)
    dll_index = _build_dll_index()
    queue = _iter_binary_seeds()
    visited: set[Path] = set()
    copied: dict[str, Path] = {}
    missing: set[str] = set()

    while queue:
        binary = queue.pop()
        resolved_binary = binary.resolve()
        if resolved_binary in visited:
            continue
        visited.add(resolved_binary)

        for imported_name in sorted(read_imported_dll_names(resolved_binary)):
            key = imported_name.lower()
            if _is_system_dll(key):
                continue

            dependency = dll_index.get(key)
            if dependency is None:
                missing.add(imported_name)
                continue

            if key not in copied:
                target = output_dir / dependency.name
                if dependency.resolve() != target.resolve():
                    shutil.copy2(dependency, target)
                copied[key] = dependency
                queue.append(dependency)

    return [copied[key] for key in sorted(copied)], sorted(missing)


def main(argv: list[str] | None = None) -> int:
    """Collect DLLs into the output directory passed on the command line."""
    args = argv if argv is not None else sys.argv[1:]
    output_dir = Path(args[0] if args else ".build-runtime-dlls")

    copied, missing = collect_runtime_dlls(output_dir)

    if copied:
        print("Copied runtime DLLs:")
        for path in copied:
            print(f"  {path}")
    else:
        print("No external runtime DLLs were copied.")

    if missing:
        print("Unresolved non-system DLL imports:")
        for name in missing:
            print(f"  {name}")
        print("These may still be provided by PyInstaller or Windows.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
