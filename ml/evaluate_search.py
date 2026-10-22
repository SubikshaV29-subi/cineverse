"""Evaluate CineVerse /api/plot-search using manually labelled queries.
Run from project root: python ml/evaluate_search.py
Edit ml/test_queries.json and verify each relevant_titles label first.
"""
import json
import math
import os
import sys
import requests

BASE_URL = os.getenv("CINEVERSE_URL", "http://127.0.0.1:5000")
DATA_PATH = os.path.join(os.path.dirname(__file__), "test_queries.json")


def norm(value):
    return " ".join((value or "").casefold().replace(":", " ").split())


def precision_at_k(results, relevant, k=5):
    top = results[:k]
    if not top:
        return 0.0
    hits = sum(1 for item in top if norm(item.get("title")) in relevant)
    return hits / k


def recall_at_k(results, relevant, k=5):
    if not relevant:
        return 0.0
    top = results[:k]
    hits = sum(1 for item in top if norm(item.get("title")) in relevant)
    return hits / len(relevant)


def ndcg_at_k(results, relevant, k=5):
    def dcg(items):
        total = 0.0
        for rank, item in enumerate(items[:k], start=1):
            rel = 1.0 if norm(item.get("title")) in relevant else 0.0
            total += (2**rel - 1) / math.log2(rank + 1)
        return total
    ideal_count = min(len(relevant), k)
    ideal = sum(1.0 / math.log2(rank + 1) for rank in range(1, ideal_count + 1))
    return dcg(results) / ideal if ideal else 0.0


def main():
    with open(DATA_PATH, encoding="utf-8") as file:
        cases = json.load(file)
    if not cases:
        print("No test queries found.")
        return 1

    scores = {"precision@5": [], "recall@5": [], "ndcg@5": []}
    for case in cases:
        query = case["query"]
        relevant = {norm(title) for title in case.get("relevant_titles", [])}
        if not relevant:
            print(f"SKIP (no labels): {query}")
            continue
        try:
            response = requests.get(f"{BASE_URL}/api/plot-search", params={"q": query}, timeout=180)
            response.raise_for_status()
            results = response.json().get("results", [])
        except Exception as exc:
            print(f"ERROR for {query!r}: {exc}")
            return 2

        p = precision_at_k(results, relevant)
        r = recall_at_k(results, relevant)
        n = ndcg_at_k(results, relevant)
        scores["precision@5"].append(p)
        scores["recall@5"].append(r)
        scores["ndcg@5"].append(n)
        top_titles = [item.get("title", "?") for item in results[:5]]
        print(f"Query: {query}\n  Relevant: {sorted(relevant)}\n  Top 5: {top_titles}\n  P@5={p:.3f} R@5={r:.3f} nDCG@5={n:.3f}\n")

    print("AVERAGE METRICS")
    for name, values in scores.items():
        print(f"{name}: {sum(values)/len(values):.3f}" if values else f"{name}: N/A")
    print("Reminder: these numbers are meaningful only after you manually verify the relevant-title labels and test cases.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
