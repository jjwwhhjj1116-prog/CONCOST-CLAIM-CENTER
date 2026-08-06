import hashlib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = REPO_ROOT / "docs" / "보고서 템플릿"
ALLOWED_EXTENSIONS = {".hwp", ".hwpx", ".pdf", ".xlsx"}


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    if not SOURCE_ROOT.is_dir():
        raise FileNotFoundError(f"Reference source directory not found: {SOURCE_ROOT}")

    source_files = sorted(
        (item for item in SOURCE_ROOT.rglob("*") if item.is_file() and item.suffix.lower() in ALLOWED_EXTENSIONS),
        key=lambda item: item.relative_to(SOURCE_ROOT).as_posix(),
    )
    for index, file_path in enumerate(source_files, start=1):
        file_id = f"TPL-REF-{index:03d}"
        print(f"{file_id} extension={file_path.suffix.lower()} size={file_path.stat().st_size} sha256={sha256_file(file_path)}")
    print(f"Total scanned reference files: {len(source_files)}")
