"""
Text -> dense vector.

Primary: fastembed, which runs all-MiniLM-L6-v2 through ONNX Runtime.

Why not sentence-transformers: it pulls in PyTorch, which is ~1.2 GB installed
and needs roughly 700 MB of RAM to hold the model plus its runtime. Render's
free web-service tier gives you 512 MB. fastembed runs the same model in about
150 MB of disk and ~120 MB of RAM. Identical 384-dimension output; the vectors
are interchangeable.

Fallback: if fastembed cannot be imported or the model cannot be fetched (no
network at boot, HuggingFace having a bad day, a locked-down build machine),
we drop to a deterministic hashed bag-of-words vectoriser. It is meaningfully
worse at catching paraphrase -- that is the whole point of the real model --
but it keeps every endpoint answering and the demo running. The /health
endpoint reports which one is live, and the API logs a loud warning.
"""

from __future__ import annotations

import hashlib
import logging
import re
import threading

import numpy as np

from .settings import settings

log = logging.getLogger(__name__)

_FALLBACK_DIM = 384
_TOKEN = re.compile(r"[a-z0-9]+")


class HashingEmbedder:
    """Deterministic hashed bag-of-words with sublinear term weighting.

    Not clever. Catches literal overlap, misses paraphrase entirely. Present
    only so the service degrades instead of failing.
    """

    name = "hashing-fallback"
    dim = _FALLBACK_DIM

    def encode(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            counts: dict[int, float] = {}
            for token in _TOKEN.findall((text or "").lower()):
                if len(token) < 2:
                    continue
                digest = hashlib.blake2b(token.encode(), digest_size=4).digest()
                idx = int.from_bytes(digest, "big") % self.dim
                counts[idx] = counts.get(idx, 0.0) + 1.0
            for idx, count in counts.items():
                out[row, idx] = 1.0 + np.log(count)
        return _l2_normalize(out)


class FastEmbedEmbedder:
    def __init__(self, model_name: str | None):
        from fastembed import TextEmbedding  # imported lazily, may be absent

        # Passing no model_name uses the library default, which is always a
        # valid identifier. Only override when the operator asked for one.
        self._model = TextEmbedding(model_name) if model_name else TextEmbedding()
        self.name = getattr(self._model, "model_name", model_name or "fastembed-default")
        # Probe rather than hardcoding 384, so swapping the model just works.
        self.dim = int(len(next(iter(self._model.embed(["dimension probe"])))))

    def encode(self, texts: list[str]) -> np.ndarray:
        vectors = list(self._model.embed(texts))
        return _l2_normalize(np.asarray(vectors, dtype=np.float32))


def _l2_normalize(matrix: np.ndarray) -> np.ndarray:
    """Unit-length rows, so cosine similarity is a plain dot product."""
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    np.maximum(norms, 1e-9, out=norms)
    return matrix / norms


class Embedder:
    """Thread-safe lazy singleton around whichever backend is available."""

    _instance: "Embedder | None" = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self.degraded = False
        try:
            self._backend = FastEmbedEmbedder(settings.embed_model)
            log.info("embedder ready: %s (dim=%d)", self._backend.name, self._backend.dim)
        except Exception as exc:  # noqa: BLE001 - any failure means fall back
            self.degraded = True
            self._backend = HashingEmbedder()
            log.warning(
                "fastembed unavailable (%s) -- falling back to %s. "
                "Semantic matching will be much weaker. Fix this before demoing.",
                exc,
                self._backend.name,
            )

    @classmethod
    def get(cls) -> "Embedder":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    @property
    def name(self) -> str:
        return self._backend.name

    @property
    def dim(self) -> int:
        return self._backend.dim

    def encode(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)
        cleaned = [(t or "")[: settings.max_chars_per_doc] for t in texts]
        return self._backend.encode(cleaned)

    def encode_one(self, text: str) -> np.ndarray:
        return self.encode([text])[0]
