"""Cart optimiser.

Given the items a shopper wants and today's prices at each shop, choose where to buy each item:

* **Cheapest cart**: buy every item, at the lowest total cost (prices + travel per shop visited),
  optionally limited to at most N shops.
* **Budget cart**: stay within a budget. Must-have items are always bought; the rest are chosen
  by priority (high > medium > low; the first unit of an item counts double extra units), then
  the cheapest way to buy that selection is found.

Both are solved exactly as small mixed-integer programmes, lexicographically: first maximise
what goes into the cart, then minimise what it costs.
"""
from __future__ import annotations

from dataclasses import dataclass

import pulp

PRIORITY_WEIGHT = {"high": 6, "medium": 4, "low": 2}
PRIORITIES = ("must", "high", "medium", "low")


@dataclass
class Line:
    key: str
    qty: int
    priority: str = "high"


def _solver(time_limit: int = 10):
    avail = pulp.listSolvers(onlyAvailable=True)
    for name in ("HiGHS", "HiGHS_CMD", "PULP_CBC_CMD"):
        if name in avail:
            return pulp.getSolver(name, msg=False, timeLimit=time_limit, gapRel=0)
    raise RuntimeError("No MIP solver found: `pip install highspy`")


def _var(m, name, lo, hi, cat):
    if hasattr(m, "add_variable"):   # PuLP >= 3 creates variables through the problem
        return m.add_variable(name, lowBound=lo, upBound=hi, cat=cat)
    return pulp.LpVariable(name, lo, hi, cat)


def _solve(m) -> bool:
    res = m.solve(_solver())
    if hasattr(res, "has_solution"):
        return bool(res.has_solution)
    return m.sol_status in (pulp.LpSolutionOptimal, pulp.LpSolutionIntegerFeasible)


def _best_per_store(options: list[dict]) -> dict[str, dict]:
    """Cheapest product option at each shop for one line."""
    best: dict[str, dict] = {}
    for o in options:
        cur = best.get(o["store_id"])
        if cur is None or (o["price"], -o["saving"], o["brand"]) < (cur["price"], -cur["saving"], cur["brand"]):
            best[o["store_id"]] = o
    return best


def _model(lines, best, stores, max_stores, trip_cost, budget):
    """Build the MIP. Returns (model, vars) without an objective."""
    m = pulp.LpProblem("cart", pulp.LpMaximize)
    si = {s: k for k, s in enumerate(stores)}
    z = {s: _var(m, f"z_{si[s]}", 0, 1, "Integer") for s in stores}
    y, n, u, f = {}, {}, {}, {}
    for li, ln in enumerate(lines):
        for s in best[ln.key]:
            y[ln.key, s] = _var(m, f"y_{li}_{si[s]}", 0, 1, "Integer")
            m += y[ln.key, s] <= z[s]
        m += pulp.lpSum(y[ln.key, s] for s in best[ln.key]) <= 1
        if budget is None:                      # cheapest cart: always the full quantity
            for s in best[ln.key]:
                n[ln.key, s] = ln.qty * y[ln.key, s]
            u[ln.key] = pulp.lpSum(n[ln.key, s] for s in best[ln.key])
        else:
            for s in best[ln.key]:
                n[ln.key, s] = _var(m, f"n_{li}_{si[s]}", 0, ln.qty, "Integer")
                m += n[ln.key, s] <= ln.qty * y[ln.key, s]
            u[ln.key] = pulp.lpSum(n[ln.key, s] for s in best[ln.key])
            f[ln.key] = _var(m, f"f_{li}", 0, 1, "Integer")
            m += f[ln.key] <= u[ln.key]
            if ln.priority == "must":
                m += u[ln.key] == ln.qty
    cost = pulp.lpSum(best[k][s]["price"] * n[k, s] for (k, s) in n)
    travel = trip_cost * pulp.lpSum(z.values())
    if max_stores:
        m += pulp.lpSum(z.values()) <= max_stores
    if budget is not None:
        m += cost + travel <= budget
    if budget is None:
        value = pulp.lpSum(y.values())
    else:
        value = pulp.lpSum((PRIORITY_WEIGHT.get(ln.priority, 6) // 2) * (u[ln.key] + f[ln.key])
                           for ln in lines if ln.priority != "must")
    return m, {"y": y, "n": n, "z": z, "u": u, "cost": cost, "travel": travel, "value": value}


def _solve_lex(lines, best, stores, max_stores, trip_cost, budget):
    """Maximise the cart's value, then minimise its cost. Returns {(line, store): units} or None."""
    m, v = _model(lines, best, stores, max_stores, trip_cost, budget)
    m.setObjective(v["value"])
    if not _solve(m):
        return None
    target = pulp.value(v["value"]) or 0
    m2, v2 = _model(lines, best, stores, max_stores, trip_cost, budget)
    m2.sense = pulp.LpMinimize
    if target > 0:
        m2 += v2["value"] >= target - 0.5
    m2.setObjective(v2["cost"] + v2["travel"] + 1e-4 * pulp.lpSum(v2["z"].values()))
    if not _solve(m2):
        return None
    units = {}
    for (k, s), expr in v2["n"].items():
        q = int(round(pulp.value(expr) or 0))
        if q > 0:
            units[k, s] = q
    return units


def single_store_totals(lines, options, store_names, budget=None) -> list[dict]:
    """What the whole list would cost at each shop on its own (for comparison)."""
    rows = []
    want = {ln.key: ln.qty for ln in lines}
    for s, name in store_names.items():
        total, found = 0.0, 0
        for ln in lines:
            best = _best_per_store(options.get(ln.key, [])).get(s)
            if best:
                total += best["price"] * ln.qty
                found += 1
        if found:
            rows.append({"store_id": s, "store_name": name, "total": round(total, 2), "found": found,
                         "missing": len(want) - found})
    rows.sort(key=lambda r: (r["missing"], r["total"]))
    return rows


def optimize(info: dict, options: dict, lines: list[Line], store_names: dict[str, str],
             max_stores: int | None = None, trip_cost: float = 0.0, budget: float | None = None) -> dict:
    """Pick the best cart. ``options[key]`` lists price views (see deals.price_view) for each line."""
    trip_cost = max(0.0, float(trip_cost or 0))
    max_stores = int(max_stores) if max_stores else None
    budget = None if budget in (None, "") else max(0.0, float(budget))
    lines = [Line(ln.key, max(1, int(ln.qty)), ln.priority if ln.priority in PRIORITIES else "high")
             for ln in lines]

    best = {ln.key: _best_per_store(options.get(ln.key, [])) for ln in lines}
    unavailable = [ln for ln in lines if not best[ln.key]]
    active = [ln for ln in lines if best[ln.key]]
    stores = sorted({s for ln in active for s in best[ln.key]})
    comparison = single_store_totals(lines, options, store_names)

    result = {"mode": "budget" if budget is not None else "cheapest", "budget": budget,
              "max_stores": max_stores, "trip_cost": trip_cost, "comparison": comparison}

    units = _solve_lex(active, best, stores, max_stores, trip_cost, budget) if active else {}
    if units is None and budget is not None:
        # Must-haves don't fit. Report how much they need on their own.
        musts = [ln for ln in active if ln.priority == "must"]
        mu = _solve_lex(musts, best, stores, max_stores, trip_cost, None) or {}
        must_cost = sum(best[k][s]["price"] * q for (k, s), q in mu.items()) + trip_cost * len({s for _, s in mu})
        result.update(status="over_budget", must_cost=round(must_cost, 2),
                      shortfall=round(must_cost - budget, 2), stores=[], total=0.0, items_total=0.0,
                      travel=0.0, special_savings=0.0, left_out=[], unavailable=_brief(unavailable, info),
                      not_covered=[], budget_left=budget,
                      message=f"Your must-have items alone cost about N${must_cost:,.2f}, which is "
                              f"N${must_cost - budget:,.2f} over your budget. Raise the budget or mark "
                              f"some items as high/medium priority instead of must-have.")
        return result
    if units is None:
        units = {}

    by_store: dict[str, list] = {}
    bought: dict[str, int] = {}
    for (k, s), q in units.items():
        o = best[k][s]
        bought[k] = bought.get(k, 0) + q
        by_store.setdefault(s, []).append({
            "key": k, **info[k], "brand": o["brand"], "product_id": o["product_id"], "qty": q,
            "unit_price": o["price"], "regular_price": o["regular_price"], "on_special": o["on_special"],
            "special_label": o["special_label"], "valid_until": o["valid_until"], "source": o["source"],
            "line_total": round(o["price"] * q, 2), "saving": round(o["saving"] * q, 2)})
    store_rows = []
    for s, items in by_store.items():
        items.sort(key=lambda x: (x["category"], x["name"]))
        store_rows.append({"store_id": s, "store_name": store_names.get(s, s), "items": items,
                           "subtotal": round(sum(x["line_total"] for x in items), 2),
                           "savings": round(sum(x["saving"] for x in items), 2)})
    store_rows.sort(key=lambda r: -r["subtotal"])

    items_total = round(sum(r["subtotal"] for r in store_rows), 2)
    travel = round(trip_cost * len(store_rows), 2)
    total = round(items_total + travel, 2)

    left_out, not_covered = [], []
    for ln in active:
        got = bought.get(ln.key, 0)
        if got >= ln.qty:
            continue
        cheapest = min(o["price"] for o in best[ln.key].values())
        entry = {"key": ln.key, **info[ln.key], "wanted": ln.qty, "bought": got, "priority": ln.priority,
                 "cheapest_price": cheapest, "extra_needed": round(cheapest * (ln.qty - got), 2)}
        (left_out if budget is not None else not_covered).append(entry)

    best_single = next((c for c in comparison if c["missing"] == len(unavailable)), None)
    status = "ok"
    if left_out or not_covered or unavailable:
        status = "partial"
    if not active:
        status = "empty"
    result.update(
        status=status, stores=store_rows, items_total=items_total, travel=travel, total=total,
        special_savings=round(sum(r["savings"] for r in store_rows), 2),
        left_out=left_out, not_covered=not_covered, unavailable=_brief(unavailable, info),
        budget_left=round(budget - total, 2) if budget is not None else None,
        best_single=best_single,
        saving_vs_best_single=(round(best_single["total"] + trip_cost - total, 2)
                               if best_single and not left_out and not not_covered else None),
        items_bought=sum(bought.values()), items_wanted=sum(ln.qty for ln in lines),
    )
    return result


def _brief(lines, info):
    return [{"key": ln.key, **info[ln.key], "wanted": ln.qty} for ln in lines]
