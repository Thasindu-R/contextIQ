"""Tests for the retrieval layer.

Single responsibility (NFR-5): verify semantic search, keyword
search, RRF fusion, and the retriever's mode dispatch (FR-7, FR-13,
FR-14, FR-15).
"""
from __future__ import annotations


def test_reciprocal_rank_fusion_combines_ranked_lists():
    """FR-14: RRF should score chunks present in both lists higher.

    TODO: implement once retrieval.fusion.reciprocal_rank_fusion is
    implemented; assert fused ordering and score formula
    (1 / (k + rank)).
    """
    raise NotImplementedError


def test_retriever_dispatches_by_mode():
    """FR-15: retriever.retrieve should call the right backend per mode.

    TODO: implement once retrieval.retriever.retrieve is implemented;
    verify SEMANTIC/KEYWORD/HYBRID each invoke the expected search
    function(s).
    """
    raise NotImplementedError
