from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree

from ..common import atomic_write, safe_relative_path

ALLOWED_EXTENSIONS = {".txt", ".md", ".rst", ".json", ".yaml", ".yml", ".pdf", ".docx"}
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024
MAX_ARCHIVE_EXPANDED_BYTES = 40 * 1024 * 1024


@dataclass
class PreparedKnowledgeBase:
    path: Path
    text: str
    sources: list[dict]

    @property
    def digest(self) -> str:
        return hashlib.sha256(json.dumps(self.sources, sort_keys=True).encode()).hexdigest()

    def cleanup(self) -> None:
        return None


def _strict_text(data: bytes) -> str:
    return data.decode("utf-8", errors="strict")


def _pdf_text(data: bytes) -> str:
    if not data.startswith(b"%PDF"):
        raise ValueError("malformed PDF")
    chunks = []
    for raw in re.findall(rb"\((?:\\.|[^\\)])*\)", data, flags=re.S):
        body = raw[1:-1]
        body = re.sub(rb"\\([()\\])", rb"\1", body)
        body = re.sub(rb"\\[nrtbf]", b" ", body)
        try:
            value = body.decode("utf-8")
        except UnicodeDecodeError:
            value = body.decode("latin-1", errors="ignore")
        if any(ch.isalnum() for ch in value):
            chunks.append(value)
    text = "\n".join(chunks).strip()
    if not text:
        raise ValueError("PDF contains no extractable text")
    return text


def _docx_text(data: bytes) -> str:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError("malformed DOCX") from exc
    total = 0
    for info in archive.infolist():
        name = Path(info.filename)
        if name.is_absolute() or ".." in name.parts:
            raise ValueError("DOCX archive path traversal")
        mode = (info.external_attr >> 16) & 0o170000
        if mode == 0o120000:
            raise ValueError("DOCX archive symlink entry")
        total += info.file_size
        if total > MAX_ARCHIVE_EXPANDED_BYTES:
            raise ValueError("DOCX expanded size limit exceeded")
    try:
        xml = archive.read("word/document.xml")
    except KeyError as exc:
        raise ValueError("DOCX document.xml missing") from exc
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as exc:
        raise ValueError("malformed DOCX XML") from exc
    values = [node.text or "" for node in root.iter() if node.tag.endswith("}t")]
    text = "\n".join(v for v in values if v.strip()).strip()
    if not text:
        raise ValueError("DOCX contains no text")
    return text


def _extract(path: Path, data: bytes) -> str:
    ext = path.suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"knowledge-base extension is not allowed: {ext}")
    if ext == ".pdf":
        return _pdf_text(data)
    if ext == ".docx":
        return _docx_text(data)
    text = _strict_text(data)
    if not text.strip():
        raise ValueError(f"knowledge-base file is empty: {path.name}")
    return text


def ingest_knowledge_base(repo_root: str | Path, paths: list[str | Path]) -> PreparedKnowledgeBase:
    repo = Path(repo_root).resolve()
    cache = repo / ".qa-artifacts" / "security-kb-cache"
    cache.mkdir(parents=True, exist_ok=True)
    total = 0
    texts: list[str] = []
    sources: list[dict] = []
    for value in paths:
        raw_path = Path(value)
        lexical = raw_path if raw_path.is_absolute() else repo / raw_path
        if lexical.is_symlink():
            raise ValueError(f"knowledge-base symlink rejected: {value}")
        rel = safe_relative_path(repo, value, require_exists=True)
        path = repo / rel
        if path.is_symlink():
            raise ValueError(f"knowledge-base symlink rejected: {rel}")
        if not path.is_file():
            raise ValueError(f"knowledge-base source is not a file: {rel}")
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            raise ValueError(f"knowledge-base file size limit exceeded: {rel}")
        total += size
        if total > MAX_TOTAL_BYTES:
            raise ValueError("knowledge-base total size limit exceeded")
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        cached = cache / f"{digest}.txt"
        if cached.exists():
            text = cached.read_text(encoding="utf-8")
        else:
            text = _extract(path, data)
            atomic_write(cached, text.encode("utf-8"))
        texts.append(f"## Source: {rel}\n\n{text}")
        sources.append({"path": rel, "sha256": digest, "bytes": size})
    staged = cache / (hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest() + ".staged.txt")
    combined = "\n\n".join(texts)
    atomic_write(staged, combined.encode("utf-8"))
    return PreparedKnowledgeBase(staged, combined, sources)
