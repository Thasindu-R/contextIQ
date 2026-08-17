"""Evaluation result shapes and reporting.

Single responsibility (NFR-5): hold the per-pair and per-mode result
records, aggregate them, and render the comparison tables (FR-15).
Pure data and formatting -- nothing here touches the database, the
retriever, or Claude, so the aggregation is unit-testable without any
of them.
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field

from evaluation.metrics import mean

# Question kinds from eval_set.json, in the order they are reported.
# Fixed rather than derived from the data so the table keeps the same
# shape when a category happens to be empty.
KINDS = ("lexical", "paraphrase", "mixed", "unanswerable")


@dataclass
class PairResult:
    """What one retrieval mode did with one Q&A pair."""

    pair_id: str
    kind: str
    question: str
    answerable: bool
    retrieved_chunk_ids: list[str]
    hit: bool
    recall: float
    reciprocal_rank: float
    retrieval_ms: float
    # 1-based rank of the first relevant chunk, None if none was
    # retrieved. Kept so hit@1/hit@3 read off the same single run
    # rather than needing a query per cutoff.
    first_relevant_rank: int | None = None
    # None when the run was retrieval-only.
    answer: str | None = None
    answer_f1: float | None = None
    fact_coverage: float | None = None
    refused: bool | None = None
    generation_error: str | None = None


@dataclass
class ModeReport:
    """Every pair's result for one retrieval mode, plus its aggregates."""

    mode: str
    results: list[PairResult] = field(default_factory=list)

    @property
    def answerable(self) -> list[PairResult]:
        return [r for r in self.results if r.answerable]

    @property
    def unanswerable(self) -> list[PairResult]:
        return [r for r in self.results if not r.answerable]

    @property
    def hit_rate(self) -> float:
        """Share of answerable pairs where a ground-truth chunk was retrieved.

        Computed over answerable pairs only. Folding the FR-10 pairs in
        would drag every mode's headline number down by the same
        constant while measuring nothing about retrieval -- there is no
        correct chunk for them to find.
        """
        return mean([float(r.hit) for r in self.answerable])

    def hit_rate_at(self, cutoff: int) -> float:
        """Hit rate if only the first `cutoff` chunks had been kept.

        A corpus of this size saturates hit@5 for every mode, which
        makes the headline column useless for comparing them. The
        tighter cutoffs are where the modes actually separate, and they
        answer the practical question too: could top_k have been
        smaller, and with it the prompt and the token bill?
        """
        return mean(
            [
                float(r.first_relevant_rank is not None and r.first_relevant_rank <= cutoff)
                for r in self.answerable
            ]
        )

    @property
    def recall(self) -> float:
        return mean([r.recall for r in self.answerable])

    @property
    def mrr(self) -> float:
        return mean([r.reciprocal_rank for r in self.answerable])

    @property
    def mean_latency_ms(self) -> float:
        return mean([r.retrieval_ms for r in self.results])

    @property
    def p95_latency_ms(self) -> float:
        """95th-percentile retrieval latency (nearest-rank).

        Reported next to the mean because NFR-10's question is what
        hybrid's second leg costs, and a mean over ~20 queries hides
        the tail where that cost actually shows up.
        """
        if not self.results:
            return 0.0
        ordered = sorted(r.retrieval_ms for r in self.results)
        # Nearest-rank: the smallest value at or above the 95th
        # percentile position, 1-based, clamped into the list.
        index = min(len(ordered), math.ceil(0.95 * len(ordered))) - 1
        return ordered[index]

    def mrr_for_kind(self, kind: str) -> float | None:
        """MRR restricted to one question kind, or None if unscored.

        MRR rather than hit rate, because this breakdown exists to show
        where each leg earns its keep -- keyword on rare tokens,
        semantic on paraphrase -- and a saturated hit rate shows
        nothing. Unanswerable pairs have no retrieval ground truth and
        get None rather than a misleading 0.00.
        """
        scoped = [r for r in self.answerable if r.kind == kind]
        return mean([r.reciprocal_rank for r in scoped]) if scoped else None

    @property
    def generated(self) -> list[PairResult]:
        return [r for r in self.results if r.answer is not None]

    @property
    def mean_answer_f1(self) -> float:
        return mean([r.answer_f1 or 0.0 for r in self.generated if r.answerable])

    @property
    def mean_fact_coverage(self) -> float:
        return mean([r.fact_coverage or 0.0 for r in self.generated if r.answerable])

    @property
    def refusal_accuracy(self) -> float:
        """Share of generated answers that refused exactly when they should.

        Both directions count: refusing an unanswerable question is
        correct (FR-10) and so is *not* refusing an answerable one. A
        system that refuses everything scores well on one half and
        badly on this.
        """
        judged = [r for r in self.generated if r.refused is not None]
        return mean([float(r.refused is not r.answerable) for r in judged])

    @property
    def generation_errors(self) -> int:
        return sum(1 for r in self.results if r.generation_error is not None)


def _fmt(value: float | None, width: int = 8) -> str:
    return f"{'  --  ':<{width}}" if value is None else f"{value:<{width}.2f}"


def render_summary(reports: list[ModeReport], top_k: int, with_answers: bool) -> str:
    """Render the retrieval-mode comparison table (FR-15)."""
    if not reports:
        return "No modes were evaluated."

    answerable = len(reports[0].answerable)
    unanswerable = len(reports[0].unanswerable)

    # Tighter cutoffs than top_k, which is where the modes separate
    # once hit@top_k saturates. Deduplicated so `--top-k 3` doesn't
    # print a hit@3 column twice.
    cutoffs = [cutoff for cutoff in (1, 3) if cutoff < top_k] + [top_k]

    header = f"{'mode':<10}" + "".join(f"{f'hit@{cutoff}':<8}" for cutoff in cutoffs)
    header += f"{'recall':<9}{'MRR':<8}{'ms (mean)':<12}{'ms (p95)':<10}"

    lines = [
        "",
        f"Retrieval-mode comparison  (top_k={top_k}, "
        f"{answerable} answerable + {unanswerable} unanswerable pairs)",
        "",
        header,
        "-" * len(header),
    ]
    for report in reports:
        row = f"{report.mode:<10}"
        row += "".join(f"{report.hit_rate_at(cutoff):<8.2f}" for cutoff in cutoffs)
        row += (
            f"{report.recall:<9.2f}{report.mrr:<8.2f}"
            f"{report.mean_latency_ms:<12.1f}{report.p95_latency_ms:<10.1f}"
        )
        lines.append(row)

    lines += [
        "",
        "MRR by question kind  (how the question is phrased relative to the source)",
        "",
        f"{'kind':<14}{'n':<5}" + "".join(f"{r.mode:<10}" for r in reports),
        "-" * (19 + 10 * len(reports)),
    ]
    for kind in KINDS:
        scoped = [r for r in reports[0].results if r.kind == kind]
        if not scoped:
            continue
        row = f"{kind:<14}{len(scoped):<5}"
        row += "".join(_fmt(report.mrr_for_kind(kind), width=10) for report in reports)
        lines.append(row)

    if with_answers:
        lines += [
            "",
            "answer quality  (grounded generation over each mode's retrieved context)",
            "",
            f"{'mode':<10}{'token F1':<11}{'fact coverage':<16}"
            f"{'refusal accuracy':<19}{'errors':<8}",
            "-" * 64,
        ]
        for report in reports:
            lines.append(
                f"{report.mode:<10}{report.mean_answer_f1:<11.2f}"
                f"{report.mean_fact_coverage:<16.2f}{report.refusal_accuracy:<19.2f}"
                f"{report.generation_errors:<8}"
            )

    lines.append("")
    return "\n".join(lines)


def render_per_question(reports: list[ModeReport]) -> str:
    """Render the per-question rank grid (--verbose).

    Each cell is the rank at which that mode first returned a
    ground-truth chunk -- "x" for a miss, "--" for an unanswerable pair
    that has no ground truth. The summary says which mode won; this
    says on which questions, and is where a surprising aggregate gets
    diagnosed.
    """
    lines = [
        "",
        "per-question rank of first relevant chunk  (x = missed, -- = no ground truth)",
        "",
        f"{'id':<6}{'kind':<14}" + "".join(f"{r.mode:<10}" for r in reports) + "question",
        "-" * (20 + 10 * len(reports) + 46),
    ]
    by_id = {report.mode: {r.pair_id: r for r in report.results} for report in reports}
    for result in reports[0].results:
        cells = ""
        for report in reports:
            other = by_id[report.mode][result.pair_id]
            if not result.answerable:
                cell = "--"
            elif other.first_relevant_rank is None:
                cell = "x"
            else:
                cell = str(other.first_relevant_rank)
            cells += f"{cell:<10}"
        question = result.question if len(result.question) <= 46 else result.question[:43] + "..."
        lines.append(f"{result.pair_id:<6}{result.kind:<14}{cells}{question}")
    lines.append("")
    return "\n".join(lines)


def to_json(reports: list[ModeReport], top_k: int) -> str:
    """Serialize every result for machine consumption (--json)."""
    payload = {
        "top_k": top_k,
        "modes": [
            {
                "mode": report.mode,
                "hit_rate_at_1": report.hit_rate_at(1),
                "hit_rate_at_3": report.hit_rate_at(3),
                "hit_rate": report.hit_rate,
                "recall": report.recall,
                "mrr": report.mrr,
                "mean_latency_ms": report.mean_latency_ms,
                "p95_latency_ms": report.p95_latency_ms,
                "mrr_by_kind": {
                    kind: report.mrr_for_kind(kind)
                    for kind in KINDS
                    if report.mrr_for_kind(kind) is not None
                },
                "mean_answer_f1": report.mean_answer_f1,
                "mean_fact_coverage": report.mean_fact_coverage,
                "refusal_accuracy": report.refusal_accuracy,
                "generation_errors": report.generation_errors,
                "results": [asdict(result) for result in report.results],
            }
            for report in reports
        ],
    }
    return json.dumps(payload, indent=2)
