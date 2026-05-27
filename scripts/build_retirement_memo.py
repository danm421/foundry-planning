#!/usr/bin/env python3
"""
build_retirement_memo.py — Retirement Plan Memo (4-page premium PDF)
====================================================================
Adapted from the Investment Memo design (ethos-transition-platform) — same
navy/gold treatment, same KPI cards, same hero band, but the story is about
retirement: lifetime cash flow, taxes, key events (retirement, Social
Security, Roth conversions, RMDs), Monte Carlo success, and longevity.

Page 1: Cover (navy background, gold accents, logo, client info)
Page 2: Executive Summary, KPIs, what-changes bullets, allocation snapshot,
        plan-mechanics charts
Page 3: Trajectory + key events + cash-flow story + tax & estate comparison
Page 4: Retirement Plan Analysis (Monte Carlo hero, inputs, longevity,
        estate transfer)

Reads a JSON payload produced by `generate-retirement-memo.local.ts`.

Usage:
  python3 scripts/build_retirement_memo.py \
    --data scripts/retirement-memo-data.json \
    --out scripts/retirement-memo.pdf
"""
from __future__ import annotations
import argparse
import io
import json
import math
import os
from datetime import datetime
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    KeepInFrame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.doctemplate import NextPageTemplate

# ═════════════════════════════════════════════════════════════════════════
# DESIGN TOKENS (same as investment memo)
# ═════════════════════════════════════════════════════════════════════════

PAGE_W, PAGE_H = letter
MARGIN = 0.6 * inch
CONTENT_W = PAGE_W - 2 * MARGIN
HALF = CONTENT_W / 2 - 4

NAVY = colors.HexColor("#1B2A4A")
GOLD = colors.HexColor("#B8860B")
GOLD_LIGHT = colors.HexColor("#E8D5A0")
SLATE = colors.HexColor("#4A5568")
WHITE = colors.HexColor("#FFFFFF")
LIGHT_BG = colors.HexColor("#F7F8FA")
CARD_BG = colors.HexColor("#F0F2F7")
GREEN = colors.HexColor("#2D6A4F")
RED = colors.HexColor("#C0392B")
AMBER = colors.HexColor("#D69E2E")
MUTED = colors.HexColor("#8899B4")
TEXT_DARK = colors.HexColor("#111111")
TEXT_MED = colors.HexColor("#111111")
TEXT_LIGHT = colors.HexColor("#374151")
BORDER_CLR = colors.HexColor("#E2E8F0")

HEX_NAVY = "#1B2A4A"
HEX_GOLD = "#B8860B"
HEX_GREEN = "#2D6A4F"
HEX_RED = "#C0392B"
HEX_AMBER = "#D69E2E"
HEX_SLATE = "#4A5568"
HEX_MUTED = "#8899B4"
PIE_COLORS = [
    "#1B2A4A", "#C9A84C", "#2D6A4F", "#60A5FA", "#F59E0B",
    "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#6366F1",
]

# Try local copy first, fall back to ethos-transition-platform.
_HERE = Path(__file__).resolve().parent
_CANDIDATE_LOGOS = [
    _HERE / "assets" / "ethos-logo_simple horizontal white.png",
    Path.home()
    / "Projects/ethos-transition-platform/api/python/investment_memo/_engine/static/logos"
    / "ethos-logo_simple horizontal white.png",
]
LOGO_WHITE = next((p for p in _CANDIDATE_LOGOS if p.exists()), None)


# ═════════════════════════════════════════════════════════════════════════
# FORMAT HELPERS
# ═════════════════════════════════════════════════════════════════════════

def _n(v: Any) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        c = v.replace("$", "").replace(",", "").replace("%", "").strip()
        try:
            return float(c)
        except ValueError:
            return 0.0
    return 0.0


def _dollar(v: float, compact: bool = True) -> str:
    v = _n(v)
    sign = "-" if v < 0 else ""
    av = abs(v)
    if compact:
        if av >= 1e6:
            return f"{sign}${av / 1e6:,.1f}M"
        if av >= 1e3:
            return f"{sign}${av / 1e3:,.0f}K"
    return f"{sign}${av:,.0f}"


def _pct(v: float, decimals: int = 0) -> str:
    return f"{v:.{decimals}f}%"


# ═════════════════════════════════════════════════════════════════════════
# STYLES
# ═════════════════════════════════════════════════════════════════════════

def _s(name: str, **kw) -> ParagraphStyle:
    base = dict(fontName="Helvetica", leading=12, textColor=TEXT_MED)
    base.update(kw)
    return ParagraphStyle(name, **base)


ST = {
    "section": _s(
        "section", fontSize=14, textColor=NAVY, fontName="Helvetica-Bold",
        leading=18, spaceBefore=4, spaceAfter=2,
    ),
    "subsection": _s(
        "subsection", fontSize=10, textColor=NAVY, fontName="Helvetica-Bold",
        leading=13, spaceBefore=2, spaceAfter=1,
    ),
    "body": _s("body", fontSize=9, leading=13, spaceAfter=2),
    "narrative": _s("narrative", fontSize=9, leading=13, spaceAfter=3),
    "bullet": _s("bullet", fontSize=8.5, leading=12, spaceAfter=2, leftIndent=10, bulletIndent=2),
    "small": _s("small", fontSize=7.5, leading=10, textColor=TEXT_LIGHT),
    "caption": _s(
        "caption", fontSize=7, leading=10, textColor=TEXT_LIGHT,
        alignment=TA_CENTER, fontName="Helvetica-Oblique",
    ),
    "disclaimer": _s("disclaimer", fontSize=6.5, leading=9, textColor=TEXT_LIGHT),
}


# ═════════════════════════════════════════════════════════════════════════
# CUSTOM FLOWABLES (lifted from investment memo)
# ═════════════════════════════════════════════════════════════════════════

class GoldRule(Flowable):
    def __init__(self, width: float, thickness: float = 1.5):
        Flowable.__init__(self)
        self.w = width
        self.t = thickness

    def wrap(self, *a):
        return (self.w, self.t + 4)

    def draw(self):
        self.canv.setStrokeColor(GOLD)
        self.canv.setLineWidth(self.t)
        self.canv.line(0, 2, self.w, 2)


class KPICard(Flowable):
    BASE_HEIGHT = 56
    SUB2_EXTRA = 10
    TAG_EXTRA = 8

    def __init__(self, label, value_text, sub_text="", width=110, accent=GOLD,
                 tag: str | None = None, sub2: str | None = None,
                 value_color=TEXT_DARK):
        Flowable.__init__(self)
        self.label = label
        self.value = value_text
        self.sub = sub_text
        self.sub2 = sub2
        self.tag = tag
        self.w = width
        self.h = self.BASE_HEIGHT
        if sub2:
            self.h += self.SUB2_EXTRA
        if tag:
            self.h += self.TAG_EXTRA
        self.accent = accent
        self.value_color = value_color

    def wrap(self, *a):
        return (self.w, self.h)

    def draw(self):
        c = self.canv
        w, h = self.w, self.h
        c.setFillColor(colors.HexColor("#F8FAFC"))
        c.setStrokeColor(BORDER_CLR)
        c.setLineWidth(0.5)
        c.roundRect(1, 1, w - 2, h - 2, 4, fill=1, stroke=1)
        c.setStrokeColor(self.accent)
        c.setLineWidth(2.5)
        c.line(4, h - 2, w - 4, h - 2)

        y = h - 4
        if self.tag:
            y -= 9
            c.setFont("Helvetica-Bold", 5.5)
            c.setFillColor(MUTED)
            c.drawString(8, y, self.tag.upper())
        y -= 11
        c.setFont("Helvetica-Bold", 6.5)
        c.setFillColor(TEXT_LIGHT)
        c.drawString(8, y, self.label.upper())
        y -= 17
        c.setFont("Helvetica-Bold", 12)
        c.setFillColor(self.value_color)
        c.drawString(8, y, self.value)
        if self.sub:
            max_chars = int((w - 16) / 3.2)
            sub = self.sub if len(self.sub) <= max_chars else self.sub[: max_chars - 1] + "…"
            c.setFont("Helvetica", 6)
            c.setFillColor(TEXT_LIGHT)
            c.drawString(8, 6 + (self.SUB2_EXTRA if self.sub2 else 0), sub)
        if self.sub2:
            sub2 = self.sub2
            max_chars = int((w - 16) / 3.2)
            if len(sub2) > max_chars:
                sub2 = sub2[: max_chars - 1] + "…"
            c.setFont("Helvetica", 6)
            c.setFillColor(TEXT_LIGHT)
            c.drawString(8, 6, sub2)


class NumberChip(Flowable):
    """Small filled circle with a centered number — mirrors the markers
    drawn at the top of the trajectory chart so the table reads as a
    legend."""
    DIAM = 14

    def __init__(self, number: int, fill_color):
        Flowable.__init__(self)
        self.number = number
        self.color = (
            colors.HexColor(fill_color)
            if isinstance(fill_color, str)
            else fill_color
        )
        self.w = self.DIAM + 2
        self.h = self.DIAM + 2

    def wrap(self, *a):
        return (self.w, self.h)

    def draw(self):
        c = self.canv
        cx = self.w / 2
        cy = self.h / 2
        c.setFillColor(self.color)
        c.setStrokeColor(colors.white)
        c.setLineWidth(0.8)
        c.circle(cx, cy, self.DIAM / 2, fill=1, stroke=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawCentredString(cx, cy - 2.5, str(self.number))


class HeroResultBand(Flowable):
    HEIGHT = 1.1 * inch
    BG_TINT = colors.HexColor("#F4F6FB")
    DELTA_PILL_PAD = 6

    def __init__(self, width: float, current_pct: float, proposed_pct: float, caption: str = ""):
        Flowable.__init__(self)
        self.w = width
        self.h = self.HEIGHT
        self.current_pct = current_pct
        self.proposed_pct = proposed_pct
        self.caption = caption

    def wrap(self, *a):
        return (self.w, self.h)

    def _proposed_color(self):
        p = self.proposed_pct
        if p >= 80:
            return GREEN
        if p >= 60:
            return AMBER
        return RED

    def _delta_colors(self):
        d = self.proposed_pct - self.current_pct
        return (GOLD, WHITE) if d > 0 else (RED, WHITE)

    def draw(self):
        c = self.canv
        w, h = self.w, self.h
        c.setFillColor(self.BG_TINT)
        c.setStrokeColor(BORDER_CLR)
        c.setLineWidth(0.5)
        c.roundRect(0, 0, w, h, 6, fill=1, stroke=1)
        c.setFillColor(GOLD)
        c.rect(0, h - 2, w, 2, fill=1, stroke=0)
        c.rect(0, 0, w, 1, fill=1, stroke=0)

        col_w = w / 3
        center_y_label = h - 14
        center_y_number = h - 52
        center_y_sub = h - 68

        # Left — CURRENT
        c.setFont("Helvetica-Bold", 7.5)
        c.setFillColor(MUTED)
        c.drawCentredString(col_w / 2, center_y_label, "CURRENT PLAN")
        c.setFont("Helvetica-Bold", 36)
        c.setFillColor(SLATE)
        c.drawCentredString(col_w / 2, center_y_number, f"{self.current_pct:.0f}%")
        c.setFont("Helvetica", 7)
        c.setFillColor(TEXT_LIGHT)
        c.drawCentredString(col_w / 2, center_y_sub, "Probability of success")

        # Delta
        delta = round(self.proposed_pct - self.current_pct)
        pill_bg, pill_fg = self._delta_colors()
        arrow_y = h / 2 + 6
        shaft_left = col_w + 14
        shaft_right = 2 * col_w - 14
        c.setStrokeColor(GOLD)
        c.setLineWidth(2)
        c.line(shaft_left, arrow_y, shaft_right - 6, arrow_y)
        c.setFillColor(GOLD)
        p = c.beginPath()
        p.moveTo(shaft_right, arrow_y)
        p.lineTo(shaft_right - 8, arrow_y + 5)
        p.lineTo(shaft_right - 8, arrow_y - 5)
        p.close()
        c.drawPath(p, fill=1, stroke=0)
        delta_text = f"{'+' if delta > 0 else ''}{delta} pts"
        c.setFont("Helvetica-Bold", 9)
        text_w = c.stringWidth(delta_text, "Helvetica-Bold", 9)
        pill_w = text_w + 2 * self.DELTA_PILL_PAD
        pill_h = 14
        pill_x = (1.5 * col_w) - pill_w / 2
        pill_y = arrow_y - 22
        c.setFillColor(pill_bg)
        c.setStrokeColor(pill_bg)
        c.roundRect(pill_x, pill_y, pill_w, pill_h, pill_h / 2, fill=1, stroke=0)
        c.setFillColor(pill_fg)
        c.drawCentredString(1.5 * col_w, pill_y + 4, delta_text)

        # Right — PROPOSED
        c.setFont("Helvetica-Bold", 7.5)
        c.setFillColor(MUTED)
        c.drawCentredString(2.5 * col_w, center_y_label, "PROPOSED PLAN")
        c.setFont("Helvetica-Bold", 36)
        c.setFillColor(self._proposed_color())
        c.drawCentredString(2.5 * col_w, center_y_number, f"{self.proposed_pct:.0f}%")
        c.setFont("Helvetica", 7)
        c.setFillColor(TEXT_LIGHT)
        c.drawCentredString(2.5 * col_w, center_y_sub, "Probability of success")

        if self.caption:
            c.setFont("Helvetica-Oblique", 7)
            c.setFillColor(TEXT_LIGHT)
            c.drawCentredString(w / 2, 6, self.caption)


# ═════════════════════════════════════════════════════════════════════════
# CHART HELPERS
# ═════════════════════════════════════════════════════════════════════════

def _make_chart(fig_func, wi: float = 3.0, hi: float = 1.8):
    buf = io.BytesIO()
    fig = fig_func()
    if fig is None:
        return None
    fig.savefig(
        buf, format="png", dpi=180, bbox_inches="tight",
        facecolor="white", edgecolor="none", pad_inches=0.05,
    )
    plt.close(fig)
    buf.seek(0)
    try:
        from PIL import Image as PI
        im = PI.open(buf)
        asp = im.size[1] / im.size[0]
        dw = wi * inch
        dh = dw * asp
        buf.seek(0)
        return Image(buf, width=dw, height=dh)
    except Exception:
        buf.seek(0)
        return Image(buf, width=wi * inch, height=hi * inch)


def _style_ax(ax, title=None):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color("#D1D5DB")
    ax.tick_params(labelsize=6.5, colors=HEX_SLATE)
    ax.grid(axis="y", alpha=0.2, color="#9CA3AF")
    ax.set_axisbelow(True)
    if title:
        ax.set_title(title, fontsize=8, fontweight="bold", color=HEX_NAVY, pad=6)


def _format_dollar_axis(ax):
    ax.yaxis.set_major_formatter(
        mticker.FuncFormatter(
            lambda v, _: (
                f"${v / 1e6:.1f}M" if abs(v) >= 1e6
                else f"${v / 1e3:.0f}K" if abs(v) >= 1e3
                else f"${v:.0f}"
            )
        )
    )


# ═════════════════════════════════════════════════════════════════════════
# CHARTS
# ═════════════════════════════════════════════════════════════════════════

def _pie_chart(alloc: dict, title: str):
    def make():
        labels_full = {
            "taxable": "Taxable",
            "retirement": "Retirement",
            "cash": "Cash",
            "realEstate": "Real Estate",
            "business": "Business",
            "lifeInsurance": "Life Insurance",
        }
        items = [(labels_full.get(k, k), v) for k, v in alloc.items() if v > 0]
        if not items:
            return None
        total = sum(v for _, v in items)
        labels = [l for l, _ in items]
        sizes = [v for _, v in items]
        pcts = [v / total * 100 for v in sizes]
        legend_labels = [f"{l} {p:.0f}%" for l, p in zip(labels, pcts)]
        fig, ax = plt.subplots(figsize=(3.4, 2.0))
        ax.set_position([0.0, 0.05, 0.40, 0.85])

        def _autopct(p):
            return f"{p:.0f}%" if p >= 8 else ""

        wedges, _, atext = ax.pie(
            sizes, labels=None, autopct=_autopct,
            colors=PIE_COLORS[: len(labels)],
            startangle=90, pctdistance=0.75,
            textprops={"fontsize": 6},
            wedgeprops=dict(width=0.38, edgecolor="white", linewidth=1.5),
        )
        for a in atext:
            a.set_color("white")
            a.set_fontsize(5.5)
            a.set_weight("bold")
        ax.legend(
            legend_labels, loc="center left", bbox_to_anchor=(0.95, 0.5),
            fontsize=5.5, frameon=False, labelspacing=0.4,
        )
        ax.set_title(title, fontsize=9, fontweight="bold", color=HEX_NAVY, pad=6)
        return fig

    return make


def _trajectory_chart(data: dict):
    """Bar chart with common-floor design, life-event markers."""
    base_rows = data["base"]["rows"]
    prop_rows = data["proposed"]["rows"]
    base_by_year = {r["year"]: r["totalPortfolio"] / 1e6 for r in base_rows}
    prop_by_year = {r["year"]: r["totalPortfolio"] / 1e6 for r in prop_rows}
    years = sorted(set(base_by_year) | set(prop_by_year))

    def make():
        if not years:
            return None
        cur = [base_by_year.get(y, 0.0) for y in years]
        prop = [prop_by_year.get(y, 0.0) for y in years]
        floor = [min(c, p) for c, p in zip(cur, prop)]
        scen_ahead = [max(p - c, 0.0) for c, p in zip(cur, prop)]
        base_ahead = [max(c - p, 0.0) for c, p in zip(cur, prop)]

        fig, ax = plt.subplots(figsize=(6.8, 2.5))
        w = 0.82
        ax.bar(years, floor, color=HEX_NAVY, edgecolor="white",
               linewidth=0.4, label="Common floor (both plans clear)", width=w)
        ax.bar(years, scen_ahead, bottom=floor, color=HEX_GREEN,
               edgecolor="white", linewidth=0.4,
               label="Proposed ahead of current", width=w)
        ax.bar(years, base_ahead, bottom=floor, color=HEX_SLATE,
               edgecolor="white", linewidth=0.4, alpha=0.55,
               label="Current ahead of proposed", width=w)

        ax.set_xlim(min(years) - 0.5, max(years) + 0.5)
        step = max(1, len(years) // 12)
        tick_years = [y for i, y in enumerate(years) if i % step == 0]
        if years[-1] not in tick_years:
            tick_years.append(years[-1])
        ax.set_xticks(tick_years)
        ax.set_xticklabels([str(y) for y in tick_years],
                           rotation=35, ha="right", fontsize=6)

        # Life events from the proposed scenario. We draw discrete numbered
        # markers for single-year events, and a translucent band for the
        # multi-year Roth conversion window.
        prop_evts = data["proposed"]["events"]
        base_evts = data["base"]["events"]
        markers: list[tuple[int, str, str]] = []
        prop_ret_yr = prop_evts.get("retirementYearClient")
        prop_ss_yr = prop_evts.get("ssClaimYearClient")
        if base_evts.get("retirementYearClient"):
            markers.append((base_evts["retirementYearClient"], "Current\nretires", HEX_SLATE))
        if prop_ret_yr and prop_ret_yr != base_evts.get("retirementYearClient"):
            # When Social Security begins the same year as proposed retirement,
            # fold them into a single marker for legibility.
            label = "Proposed retires"
            if prop_ss_yr == prop_ret_yr:
                label += "\n+ SS begins"
            else:
                label += "\nretires"
            markers.append((prop_ret_yr, label, HEX_GOLD))
            if prop_ss_yr and prop_ss_yr != prop_ret_yr:
                markers.append((prop_ss_yr, "Social\nSecurity", HEX_NAVY))
        elif prop_ss_yr:
            markers.append((prop_ss_yr, "Social\nSecurity", HEX_NAVY))
        if prop_evts.get("rmdStartYearClient"):
            markers.append((prop_evts["rmdStartYearClient"], "RMDs\nbegin", HEX_NAVY))

        tops = [c + s + b for c, s, b in zip(floor, scen_ahead, base_ahead)]
        ymax = max(tops) if tops else 0
        ax.set_ylim(0, ymax * 1.20)

        # Roth conversion window — drawn as a translucent green band so the
        # multi-year strategy reads at a glance instead of fighting for space
        # with the single-year event markers.
        roth_first = prop_evts.get("firstRothConversionYear")
        roth_last = prop_evts.get("lastRothConversionYear")
        if roth_first and roth_last and roth_last > roth_first:
            ax.axvspan(roth_first - 0.5, roth_last + 0.5,
                       color=HEX_GREEN, alpha=0.08, zorder=0)
            ax.text((roth_first + roth_last) / 2, ymax * 1.04,
                    f"Roth conversion ladder ({roth_first}–{roth_last})",
                    ha="center", va="bottom", fontsize=5.5,
                    color=HEX_GREEN, fontweight="bold")

        # Lightweight numeric markers at the top of the chart — full label
        # text lives in the Key Events table directly below the chart so we
        # don't have to fight horizontal overlap on a 45-year axis.
        markers.sort(key=lambda m: m[0])
        marker_y = ymax * 1.15
        # Apply small horizontal offsets when two events are within 2 years
        # of each other, so the chips don't overlap.
        offsets: list[float] = []
        last_year = -999
        for y_evt, _, _ in markers:
            if y_evt - last_year <= 2:
                offsets.append(1.2)  # nudge right
            else:
                offsets.append(0.0)
            last_year = y_evt
        for idx, ((y_evt, _, color), offs) in enumerate(zip(markers, offsets), start=1):
            if not (min(years) <= y_evt <= max(years)):
                continue
            ax.axvline(x=y_evt, color=color, linestyle="--",
                       linewidth=0.7, alpha=0.55)
            ax.scatter([y_evt + offs], [marker_y], s=42, color=color,
                       edgecolor="white", linewidth=0.7, zorder=5)
            ax.text(y_evt + offs, marker_y, str(idx),
                    ha="center", va="center",
                    fontsize=6, fontweight="bold", color="white", zorder=6)

        ax.legend(fontsize=6, framealpha=.85, ncol=3, loc="lower right",
                  bbox_to_anchor=(1.0, 1.0))
        _style_ax(ax, "Projected Portfolio Balance — Current vs. Proposed")
        ax.set_ylabel("Assets ($M)", fontsize=7)
        fig.tight_layout()
        return fig

    return make


def _cashflow_chart(data: dict):
    """Annual net cash flow (income - expenses) for both plans, area style."""
    base_rows = data["base"]["rows"]
    prop_rows = data["proposed"]["rows"]

    def make():
        years = [r["year"] for r in base_rows]
        base_net = [r["netCashFlow"] / 1e3 for r in base_rows]
        prop_net = [r["netCashFlow"] / 1e3 for r in prop_rows]
        fig, ax = plt.subplots(figsize=(3.2, 1.9))
        ax.plot(years, base_net, color=HEX_SLATE, lw=1.6, label="Current", linestyle="--")
        ax.plot(years, prop_net, color=HEX_GOLD, lw=2.0, label="Proposed")
        ax.fill_between(years, prop_net, base_net,
                        where=[p >= b for p, b in zip(prop_net, base_net)],
                        color=HEX_GREEN, alpha=0.18, interpolate=True)
        ax.fill_between(years, prop_net, base_net,
                        where=[p < b for p, b in zip(prop_net, base_net)],
                        color=HEX_RED, alpha=0.14, interpolate=True)
        ax.axhline(0, color="#999999", linewidth=0.4)
        ax.yaxis.set_major_formatter(
            mticker.FuncFormatter(
                lambda v, _: f"${v / 1e3:.0f}M" if abs(v) >= 1e3 else f"${v:.0f}K"
            )
        )
        ax.set_xlabel("Year", fontsize=6.5)
        ax.set_ylabel("Net cash flow ($K)", fontsize=6.5)
        ax.legend(fontsize=6, framealpha=.85, loc="upper right")
        _style_ax(ax, "Annual Net Cash Flow")
        fig.tight_layout()
        return fig

    return make


def _tax_chart(data: dict):
    """Annual tax payment for both plans."""
    base_rows = data["base"]["rows"]
    prop_rows = data["proposed"]["rows"]

    def make():
        years = [r["year"] for r in base_rows]
        base_tax = [r["taxes"] / 1e3 for r in base_rows]
        prop_tax = [r["taxes"] / 1e3 for r in prop_rows]
        fig, ax = plt.subplots(figsize=(3.2, 1.9))
        n = len(years)
        x = np.arange(n)
        w = 0.4
        ax.bar(x - w / 2, base_tax, w, color=HEX_NAVY, label="Current",
               edgecolor="white", linewidth=.3)
        ax.bar(x + w / 2, prop_tax, w, color=HEX_GOLD, label="Proposed",
               edgecolor="white", linewidth=.3)
        step = max(1, n // 6)
        tick_idx = list(range(0, n, step))
        if (n - 1) not in tick_idx:
            tick_idx.append(n - 1)
        ax.set_xticks([x[i] for i in tick_idx])
        ax.set_xticklabels([str(years[i]) for i in tick_idx],
                           rotation=0, fontsize=6)
        ax.set_ylabel("Annual taxes ($K)", fontsize=6.5)
        ax.legend(fontsize=6, framealpha=.85, loc="upper left")
        _style_ax(ax, "Annual Tax Cost")
        fig.tight_layout()
        return fig

    return make


def _withdrawals_chart(data: dict):
    """Withdrawal volume each year (current vs proposed)."""
    base_rows = data["base"]["rows"]
    prop_rows = data["proposed"]["rows"]

    def make():
        years = [r["year"] for r in base_rows]
        b = [r["withdrawals"] / 1e3 for r in base_rows]
        p = [r["withdrawals"] / 1e3 for r in prop_rows]
        if max(b + p) == 0:
            return None
        fig, ax = plt.subplots(figsize=(3.2, 1.9))
        ax.fill_between(years, b, color=HEX_SLATE, alpha=0.45, label="Current")
        ax.fill_between(years, p, color=HEX_GOLD, alpha=0.55, label="Proposed")
        ax.set_ylabel("Annual withdrawals ($K)", fontsize=6.5)
        ax.set_xlabel("Year", fontsize=6.5)
        ax.legend(fontsize=6, framealpha=.85, loc="upper left")
        _style_ax(ax, "Portfolio Withdrawals")
        fig.tight_layout()
        return fig

    return make


def _outcomes_chart(data: dict):
    """Range of liquid-asset outcomes from the actual Monte Carlo trials —
    per-year p10/p50/p90 (proposed) plus the current-plan median for
    comparison. Negative percentile values (failure trials) are clipped to
    zero so the chart reads as a range, not a balance-sheet."""
    base_mc = data["base"].get("mc")
    prop_mc = data["proposed"].get("mc")

    def make():
        if not prop_mc:
            return None
        fig, ax = plt.subplots(figsize=(6.4, 1.6))

        # Proposed quantiles (preferred) or synthetic fallback.
        prop_q = prop_mc.get("byYearQuantiles") or []
        if prop_q:
            years = [q["year"] for q in prop_q]
            p10 = [max(0, q["p10"]) / 1e6 for q in prop_q]
            p50 = [max(0, q["p50"]) / 1e6 for q in prop_q]
            p90 = [max(0, q["p90"]) / 1e6 for q in prop_q]
            ax.fill_between(years, p10, p90, color=HEX_NAVY, alpha=0.12,
                            label="Proposed 10th–90th percentile")
            ax.plot(years, p50, lw=2.0, color=HEX_NAVY, label="Proposed median")
            ax.plot(years, p90, lw=1.0, color=HEX_GREEN, alpha=0.85)
            ax.plot(years, p10, lw=1.0, color=HEX_RED, alpha=0.85)
        else:
            years = [r["year"] for r in data["base"]["rows"]]

        # Current-plan median overlay for comparison.
        base_q = (base_mc or {}).get("byYearQuantiles") or []
        if base_q:
            byrs = [q["year"] for q in base_q]
            bmed = [max(0, q["p50"]) / 1e6 for q in base_q]
            ax.plot(byrs, bmed, lw=1.6, color=HEX_SLATE, ls="--",
                    label="Current median")

        ax.legend(fontsize=6, framealpha=0.85, loc="upper left", ncol=2)
        _style_ax(ax, "Range of Liquid-Asset Outcomes — 1,000 Monte Carlo trials")
        ax.set_xlabel("Year", fontsize=7)
        ax.set_ylabel("Liquid assets ($M)", fontsize=7)
        ax.yaxis.set_major_formatter(
            mticker.FuncFormatter(
                lambda v, _: f"${v:.0f}M" if abs(v) >= 1 else f"${v * 1000:.0f}K"
            )
        )
        ax.set_ylim(bottom=0)
        fig.tight_layout()
        return fig

    return make


def _longevity_chart(data: dict):
    raw = data["proposed"].get("mc", {}).get("longevity", [])
    if not raw:
        raw = data["base"].get("mc", {}).get("longevity", [])

    def make():
        if not raw:
            return None
        yrs = [str(i["year"]) for i in raw]
        probs = [_n(i["successPct"]) for i in raw]
        clrs = [HEX_GREEN if p >= 82 else HEX_AMBER if p >= 70 else HEX_RED for p in probs]
        fig, ax = plt.subplots(figsize=(6.0, 1.2))
        x = np.arange(len(yrs))
        bars = ax.bar(x, probs, color=clrs, edgecolor="white", linewidth=.5, width=0.8)
        ax.set_ylim(0, 115)

        n = len(yrs)
        step = max(1, n // 6)
        tick_idx = list(range(0, n, step))
        # If the auto-spaced ticks land within 3 bars of the last bar, drop
        # the next-to-last tick to avoid the 2068/2070 collision.
        while tick_idx and (n - 1) - tick_idx[-1] < step // 2:
            tick_idx.pop()
        if (n - 1) not in tick_idx:
            tick_idx.append(n - 1)
        ax.set_xticks([x[i] for i in tick_idx])
        ax.set_xticklabels([yrs[i] for i in tick_idx], fontsize=6.5)
        _style_ax(ax, "Longevity: Probability of Plan Success by Year (Proposed)")

        min_spacing = max(5, n // 7)
        last = -999
        for idx, (b, p) in enumerate(zip(bars, probs)):
            show = idx == 0 or idx == len(bars) - 1
            if not show and idx % min_spacing == 0 and (idx - last) >= min_spacing:
                show = True
            elif not show and idx > 0 and abs(p - probs[idx - 1]) >= 5 and (idx - last) >= min_spacing:
                show = True
            if show:
                ax.text(b.get_x() + b.get_width() / 2, p + 1.5, f"{p:.0f}%",
                        ha="center", va="bottom", fontsize=5.5, fontweight="bold")
                last = idx
        fig.tight_layout()
        return fig

    return make


def _stacked_income_chart(data: dict, side: str = "proposed"):
    """Stacked area chart: where the money comes from each year."""
    rows = data[side]["rows"]

    def make():
        years = [r["year"] for r in rows]
        ss = [r["ssIncome"] / 1e3 for r in rows]
        # Approximate buckets:
        salaries = [(r["totalIncome"] - r["ssIncome"] - r["withdrawals"]) / 1e3 for r in rows]
        salaries = [max(0, s) for s in salaries]
        wd = [r["withdrawals"] / 1e3 for r in rows]
        fig, ax = plt.subplots(figsize=(6.4, 1.4))
        ax.stackplot(
            years, salaries, ss, wd,
            labels=["Salary & Other Income", "Social Security", "Portfolio Withdrawals"],
            colors=[HEX_NAVY, HEX_GOLD, HEX_GREEN], alpha=0.92, edgecolor="white", linewidth=0.3,
        )
        ax.set_ylabel("$K / year", fontsize=7)
        ax.legend(fontsize=6, loc="upper left", framealpha=0.9)
        _style_ax(ax, f"How Income Funds Each Year — {data[side]['name']}")
        ax.set_xlim(years[0], years[-1])
        fig.tight_layout()
        return fig

    return make


def _estate_chart(data: dict):
    """Side-by-side: gross legacy passing to heirs at second death,
    plus an estate-tax overlay when there is one. When no federal/state
    estate tax is projected, surface that fact explicitly in the title."""
    base = data["estate"]["base"]
    prop = data["estate"]["proposed"]

    def _gross(side):
        sd = side["secondDeath"] or side["firstDeath"]
        return _n((sd or {}).get("grossEstate", 0))

    def _tax(side):
        sd = side["secondDeath"] or side["firstDeath"]
        return _n((sd or {}).get("totalEstateTax", 0))

    base_gross = _gross(base) / 1e6
    prop_gross = _gross(prop) / 1e6
    base_tax = _tax(base) / 1e6
    prop_tax = _tax(prop) / 1e6

    def make():
        if base_gross == 0 and prop_gross == 0:
            return None
        fig, ax = plt.subplots(figsize=(3.2, 1.9))
        labels = ["Current Plan", "Proposed Plan"]
        x = np.arange(len(labels))
        w = 0.45

        # Net = gross - tax
        base_net = max(0, base_gross - base_tax)
        prop_net = max(0, prop_gross - prop_tax)

        ax.bar(x, [base_net, prop_net], w,
               color=[HEX_SLATE, HEX_GOLD], edgecolor="white", linewidth=.5,
               label="Net to heirs")
        if max(base_tax, prop_tax) > 0:
            ax.bar(x, [base_tax, prop_tax], w, bottom=[base_net, prop_net],
                   color=HEX_RED, alpha=0.7, edgecolor="white", linewidth=.5,
                   label="Estate tax")
            ax.legend(fontsize=6, framealpha=.85, loc="upper left")

        for i, (gross, _net) in enumerate(zip([base_gross, prop_gross],
                                              [base_net, prop_net])):
            ax.text(i, gross + max(base_gross, prop_gross) * 0.02,
                    f"${gross:.1f}M", ha="center", va="bottom",
                    fontsize=10, fontweight="bold",
                    color=HEX_SLATE if i == 0 else HEX_GOLD)

        ax.set_xticks(x)
        ax.set_xticklabels(labels, fontsize=7)
        ax.set_ylabel("$M passed at second death", fontsize=7)
        title = "Projected Legacy at Second Death"
        if max(base_tax, prop_tax) == 0:
            title += "  (no estate tax projected)"
        _style_ax(ax, title)
        ax.set_ylim(0, max(base_gross, prop_gross) * 1.25)
        fig.tight_layout()
        return fig

    return make


def _annual_income_tax_chart(data: dict):
    """Side-by-side annual income tax (current vs proposed) with a translucent
    band over the proposed Roth-conversion window so the conversion-driven
    tax spike reads as deliberate strategy, not surprise cost."""
    base_rows = data["base"]["rows"]
    prop_rows = data["proposed"]["rows"]
    prop_evts = data["proposed"]["events"]

    def make():
        years = [r["year"] for r in base_rows]
        base_tax = [r["taxes"] / 1e3 for r in base_rows]
        prop_tax = [r["taxes"] / 1e3 for r in prop_rows]

        fig, ax = plt.subplots(figsize=(6.4, 1.5))
        ax.plot(years, base_tax, color=HEX_SLATE, lw=1.4, linestyle="--", label="Current")
        ax.plot(years, prop_tax, color=HEX_GOLD, lw=2.0, label="Proposed")
        ax.fill_between(
            years, prop_tax, base_tax,
            where=[p >= b for p, b in zip(prop_tax, base_tax)],
            color=HEX_RED, alpha=0.10, interpolate=True,
        )
        ax.fill_between(
            years, prop_tax, base_tax,
            where=[p < b for p, b in zip(prop_tax, base_tax)],
            color=HEX_GREEN, alpha=0.12, interpolate=True,
        )

        # Shade the Roth-conversion window so the spike has context.
        first = prop_evts.get("firstRothConversionYear")
        last = prop_evts.get("lastRothConversionYear")
        if first and last and last > first:
            ax.axvspan(first - 0.5, last + 0.5,
                       color=HEX_GREEN, alpha=0.07, zorder=0)
            ymax = max(max(base_tax), max(prop_tax))
            ax.text(
                (first + last) / 2, ymax * 1.04,
                f"Roth conversion window ({first}–{last})",
                ha="center", va="bottom", fontsize=6,
                color=HEX_GREEN, fontweight="bold",
            )

        ax.set_ylabel("Annual income tax ($K)", fontsize=7)
        ax.set_xlabel("Year", fontsize=7)
        ax.legend(fontsize=6, framealpha=.85, loc="upper right")
        _style_ax(ax, "Annual Income Tax — Current vs. Proposed")
        fig.tight_layout()
        return fig

    return make


def _expense_chart(data: dict):
    """Annual living + insurance expense for the proposed plan, showing how
    real-dollar spending grows with inflation through the plan horizon."""
    rows = data["proposed"]["rows"]

    def make():
        years = [r["year"] for r in rows]
        living = [r["living"] / 1e3 for r in rows]
        insurance = [r["insurance"] / 1e3 for r in rows]
        fig, ax = plt.subplots(figsize=(6.4, 1.4))
        ax.stackplot(
            years, living, insurance,
            labels=["Living expense", "Insurance"],
            colors=[HEX_NAVY, HEX_AMBER], alpha=0.92,
            edgecolor="white", linewidth=0.3,
        )
        # Mark retirement transition.
        prop_ret_yr = data["proposed"]["events"].get("retirementYearClient")
        if prop_ret_yr and min(years) <= prop_ret_yr <= max(years):
            ax.axvline(prop_ret_yr, color=HEX_GOLD, lw=1.0, ls=":")
            ax.text(prop_ret_yr, max(living) * 1.02, "Retirement",
                    ha="center", fontsize=6, color=HEX_GOLD,
                    fontweight="bold")
        ax.set_ylabel("Annual expense ($K)", fontsize=7)
        ax.set_xlabel("Year", fontsize=7)
        ax.legend(fontsize=6, framealpha=.85, loc="upper left")
        _style_ax(ax, "Annual Living & Insurance Expense — Proposed")
        fig.tight_layout()
        return fig

    return make


def _lifetime_tax_chart(data: dict):
    """Single comparison bar chart for cumulative lifetime taxes."""
    base = data["base"]["totalTaxesLifetime"] / 1e6
    prop = data["proposed"]["totalTaxesLifetime"] / 1e6

    def make():
        fig, ax = plt.subplots(figsize=(3.2, 1.9))
        bars = ax.bar(["Current", "Proposed"], [base, prop],
                      color=[HEX_SLATE, HEX_GOLD], edgecolor="white",
                      linewidth=1, width=0.5)
        for b, v in zip(bars, [base, prop]):
            ax.text(b.get_x() + b.get_width() / 2, v + max(base, prop) * 0.02,
                    f"${v:.1f}M", ha="center", va="bottom",
                    fontsize=10, fontweight="bold")
        ax.set_ylabel("Lifetime income taxes paid", fontsize=7)
        _style_ax(ax, "Cumulative Lifetime Income Taxes (Plan Years)")
        ax.set_ylim(0, max(base, prop) * 1.25)
        fig.tight_layout()
        return fig

    return make


# ═════════════════════════════════════════════════════════════════════════
# PAGE CALLBACKS (canvas)
# ═════════════════════════════════════════════════════════════════════════

def _client_display(data: dict) -> str:
    names = data["document"]["clientNames"]
    if len(names) >= 2:
        a, b = names[0], names[1]
        last_a = a.split()[-1] if len(a.split()) > 1 else ""
        return f"{a.split()[0]} & {b.split()[0]} {last_a}".strip()
    if names:
        return names[0]
    return "Client"


def _advisor(data: dict) -> str:
    return data["document"].get("advisor", "Ethos Financial Group")


def _date_str(data: dict) -> str:
    return data["document"].get("preparedOn") or datetime.now().strftime("%B %d, %Y")


def _draw_cover(canvas, doc):
    c = canvas
    c.saveState()
    data = doc._memo_data

    c.setFillColor(NAVY)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.rect(0, PAGE_H - 6, PAGE_W, 6, fill=1, stroke=0)
    c.rect(0, 0, PAGE_W, 4, fill=1, stroke=0)

    if LOGO_WHITE is not None and LOGO_WHITE.exists():
        try:
            from PIL import Image as PI
            im = PI.open(str(LOGO_WHITE))
            asp = im.size[1] / im.size[0]
            lw = 2.6 * inch
            lh = lw * asp
            c.drawImage(str(LOGO_WHITE), (PAGE_W - lw) / 2, PAGE_H - 1.4 * inch, lw, lh, mask="auto")
        except Exception:
            pass

    c.setStrokeColor(GOLD)
    c.setLineWidth(1)
    c.line(MARGIN, PAGE_H * 0.58, PAGE_W - MARGIN, PAGE_H * 0.58)

    client = _client_display(data)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawCentredString(PAGE_W / 2, PAGE_H * 0.70, client)

    c.setFont("Helvetica", 16)
    c.setFillColor(GOLD)
    c.drawCentredString(PAGE_W / 2, PAGE_H * 0.64, "Retirement Plan Memo")

    c.setFont("Helvetica", 13)
    c.setFillColor(MUTED)
    c.drawCentredString(PAGE_W / 2, PAGE_H * 0.60, "Current vs. Proposed")

    c.setFont("Helvetica", 11)
    c.setFillColor(WHITE)
    c.drawCentredString(PAGE_W / 2, PAGE_H * 0.50, f"Prepared by {_advisor(data)}")

    c.setFont("Helvetica", 10)
    c.setFillColor(MUTED)
    c.drawCentredString(PAGE_W / 2, PAGE_H * 0.46, _date_str(data))

    c.setFont("Helvetica-Oblique", 8)
    c.setFillColor(colors.HexColor("#5A6B88"))
    c.drawCentredString(PAGE_W / 2, MARGIN + 20, "Personal & Confidential")

    c.setFont("Helvetica", 8)
    c.setFillColor(MUTED)
    c.drawCentredString(PAGE_W / 2, MARGIN + 6,
                        "2200 Renaissance Blvd Ste 340, King of Prussia, PA · (484) 213-4856")
    c.restoreState()


def _draw_content_page(canvas, doc):
    c = canvas
    c.saveState()
    data = doc._memo_data

    hdr_h = 32
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - hdr_h, PAGE_W, hdr_h, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.rect(0, PAGE_H - hdr_h - 2, PAGE_W, 2, fill=1, stroke=0)

    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(WHITE)
    c.drawString(MARGIN, PAGE_H - hdr_h + 10, "ETHOS FINANCIAL GROUP")
    c.setFont("Helvetica", 7.5)
    c.setFillColor(GOLD_LIGHT)
    c.drawRightString(
        PAGE_W - MARGIN, PAGE_H - hdr_h + 10,
        f"{_client_display(data)}  ·  Retirement Plan Memo  ·  {_date_str(data)}",
    )

    c.setStrokeColor(GOLD)
    c.setLineWidth(0.5)
    c.line(MARGIN, 0.42 * inch, PAGE_W - MARGIN, 0.42 * inch)
    c.setFont("Helvetica", 7)
    c.setFillColor(TEXT_LIGHT)
    c.drawString(MARGIN, 0.28 * inch, "Ethos Financial Group  ·  Confidential")
    c.drawRightString(PAGE_W - MARGIN, 0.28 * inch, f"Page {doc.page}")
    c.restoreState()


# ═════════════════════════════════════════════════════════════════════════
# NARRATIVE BUILDERS
# ═════════════════════════════════════════════════════════════════════════

def build_executive_summary(data: dict) -> str:
    """5-sentence executive summary, generated from real comparison data.
    Leads with the dollar-impact (which is more dramatic than the MC delta
    here) rather than burying it behind the success-rate number."""
    h = data["household"]
    base = data["base"]
    prop = data["proposed"]
    base_mc = base.get("mc", {})
    prop_mc = prop.get("mc", {})
    base_pct = base_mc.get("successPct", 0)
    prop_pct = prop_mc.get("successPct", 0)
    delta = prop_pct - base_pct

    end_base = base["endingPortfolio"]
    end_prop = prop["endingPortfolio"]
    end_delta = end_prop - end_base
    end_delta_pct = end_delta / end_base * 100 if end_base else 0

    base_ret_age = base["retirementAge"]
    prop_ret_age = prop["retirementAge"]

    client_name = h["clientFirstName"]
    spouse_name = h.get("spouseFirstName") or ""
    couple = f"{client_name} & {spouse_name}" if spouse_name else client_name

    # Net estate at second death
    sd_base = (data["estate"]["base"]["secondDeath"] or {}).get("grossEstate", 0)
    sd_prop = (data["estate"]["proposed"]["secondDeath"] or {}).get("grossEstate", 0)
    estate_delta = sd_prop - sd_base

    sentences = []

    sentences.append(
        f"{couple}, by retiring at {prop_ret_age} instead of {base_ret_age}, adjusting your "
        f"lifestyle assumption to a more realistic level, and reallocating retirement assets "
        f"toward a growth-oriented portfolio, the proposed plan projects a meaningfully stronger "
        f"financial picture across every horizon we measured."
    )

    sentences.append(
        f"At plan end the proposed path holds roughly {_dollar(end_prop)} of total assets versus "
        f"{_dollar(end_base)} on the current plan — about {_dollar(abs(end_delta))} more "
        f"({end_delta_pct:+.0f}%) — and the projected legacy at second death grows to "
        f"{_dollar(sd_prop)} versus {_dollar(sd_base)}, roughly {_dollar(abs(estate_delta))} more "
        f"available to heirs."
    )

    base_total_tax = base["totalTaxesLifetime"]
    prop_total_tax = prop["totalTaxesLifetime"]
    tax_delta = prop_total_tax - base_total_tax
    base_roth = base["events"]["totalRothConverted"]
    prop_roth = prop["events"]["totalRothConverted"]
    sentences.append(
        f"Lifetime taxes rise by {_dollar(abs(tax_delta))} (from {_dollar(base_total_tax)} to "
        f"{_dollar(prop_total_tax)}) because the proposed plan runs a longer Roth-conversion "
        f"ladder ({_dollar(prop_roth)} converted vs {_dollar(base_roth)}) — but that pulls "
        f"taxes forward at known low-bracket rates and replaces them with decades of tax-free "
        f"growth and lower RMDs in your 80s."
    )

    # Compare median ending liquid (more interpretable than negative
    # 10th-percentile numbers which reflect shortfall depth in failed trials).
    sentences.append(
        f"Across 1,000 Monte Carlo trials the probability your portfolio supports your "
        f"spending need through age {prop['planEndAge']} improves from {base_pct}% to "
        f"{prop_pct}%, and the median trajectory of liquid assets at plan end rises from "
        f"{_dollar(base_mc.get('medianEndingLiquid', 0))} on the current plan to "
        f"{_dollar(prop_mc.get('medianEndingLiquid', 0))} on the proposed plan — a stronger "
        f"central case in addition to a higher success rate."
    )

    sentences.append(
        f"In short — for you, {couple}, the proposed plan trades two extra working years and a "
        f"larger Roth strategy today for substantially more durability throughout retirement, "
        f"a healthier legacy, and a clearer line of sight to your long-term goals."
    )

    return " ".join(sentences)


def build_change_bullets(data: dict) -> list[str]:
    """Plain-English changes between current and proposed. Sourced from the
    scenarioChanges payload when present (so the wording matches the actual
    overlay rather than being inferred from the row deltas)."""
    base = data["base"]
    prop = data["proposed"]
    bullets: list[str] = []
    changes = data.get("scenarioChanges", []) or []

    # Retirement-age edit — prefer the structured edit if present.
    ret_edit = next(
        (c for c in changes if c.get("kind") == "client_edit" and c.get("field") == "retirementAge"),
        None,
    )
    if ret_edit:
        bullets.append(
            f"<b>Push retirement age</b> from {ret_edit['from']} to {ret_edit['to']} "
            f"(+{int(ret_edit['to']) - int(ret_edit['from'])} years of additional earnings, saving, "
            f"and deferred withdrawals)."
        )
    elif base["retirementAge"] != prop["retirementAge"]:
        delta = prop["retirementAge"] - base["retirementAge"]
        sign = "+" if delta > 0 else ""
        bullets.append(
            f"<b>Push retirement age</b> from {base['retirementAge']} to {prop['retirementAge']} "
            f"({sign}{delta} years of additional earnings and saving)."
        )

    # Expense edits — list each with name + dollar swing.
    exp_edits = [c for c in changes if c.get("kind") == "expense_edit"]
    for ed in exp_edits:
        name = ed.get("expenseName") or "an expense"
        sign = "raise" if (_n(ed["to"]) > _n(ed["from"])) else "lower"
        bullets.append(
            f"<b>{sign.capitalize()} the &ldquo;{name}&rdquo; assumption</b> from "
            f"{_dollar(_n(ed['from']))} to {_dollar(_n(ed['to']))} per year (today's dollars) so "
            f"the plan reflects realistic post-retirement spending, not an optimistic floor."
        )

    # Roth conversion change — derived from yearly results.
    base_roth = base["events"]["totalRothConverted"]
    prop_roth = prop["events"]["totalRothConverted"]
    if abs(prop_roth - base_roth) > 10_000:
        sign = "more" if prop_roth > base_roth else "less"
        bullets.append(
            f"<b>Run a longer Roth-conversion ladder</b> — "
            f"{_dollar(prop_roth)} total converted vs {_dollar(base_roth)} on the current path "
            f"(about {_dollar(abs(prop_roth - base_roth))} {sign}), trading income tax today for "
            f"tax-free growth and lower future RMDs (see the dedicated section on page 3)."
        )

    # Reinvestment — pull the portfolio name + account list when we have it.
    reinv = next((c for c in changes if c.get("kind") == "reinvestment"), None)
    if reinv:
        acct_names = reinv.get("accountNames") or []
        portfolio = reinv.get("portfolioName") or "a growth-oriented model"
        desc = reinv.get("portfolioDescription")
        n = len(acct_names)
        if n <= 3:
            list_phrase = ", ".join(acct_names) if acct_names else ""
        else:
            list_phrase = f"{', '.join(acct_names[:3])} and {n - 3} more"
        suffix = f" — {desc}" if desc else ""
        bullets.append(
            f"<b>Reallocate {n} account{'s' if n != 1 else ''} into the {portfolio} model "
            f"portfolio</b>{suffix} starting in {reinv.get('year', 2026)} "
            + (f"({list_phrase}). " if list_phrase else "")
            + "Reinvested cash compounds harder over the long horizon."
        )
    else:
        bullets.append(
            "<b>Reallocate retirement & taxable accounts</b> to a growth-oriented model portfolio "
            "starting this year, so reinvested cash compounds harder over the long horizon."
        )

    # Outcome line stays last.
    base_end = base["endingPortfolio"]
    prop_end = prop["endingPortfolio"]
    delta_end = prop_end - base_end
    if abs(delta_end) > 100_000:
        bullets.append(
            f"<b>Outcome:</b> ending portfolio of {_dollar(prop_end)} versus {_dollar(base_end)} "
            f"under the current plan — a {_dollar(abs(delta_end))} {'improvement' if delta_end > 0 else 'reduction'}."
        )

    return bullets


def build_key_events_for_proposed(data: dict) -> list[tuple[int, str, str, str]]:
    """Numbered list of (year_int, year_label, body, color_hex) — matches the
    numeric markers on the trajectory chart. Order MUST mirror the markers
    list construction in _trajectory_chart so the numbers align."""
    prop = data["proposed"]
    base_evts = data["base"]["events"]
    h = data["household"]
    client = h["clientFirstName"]
    spouse = h.get("spouseFirstName")
    out: list[tuple[int, str, str, str]] = []
    ev = prop["events"]

    def _age_for_client(year: int) -> int | None:
        return year - int(h["clientDob"][:4]) if h.get("clientDob") else None

    def _age_for_spouse(year: int) -> int | None:
        return year - int(h["spouseDob"][:4]) if h.get("spouseDob") else None

    # 1. Current retirement age
    if base_evts.get("retirementYearClient"):
        yr = base_evts["retirementYearClient"]
        age = _age_for_client(yr)
        out.append((yr, str(yr),
                    f"<i>Under the current plan</i> — {client} retires"
                    + (f" (age {age})" if age else ""),
                    HEX_SLATE))

    # 2. Proposed retirement age (and Social Security if same year)
    prop_ret_yr = ev.get("retirementYearClient")
    prop_ss_yr = ev.get("ssClaimYearClient")
    if prop_ret_yr and prop_ret_yr != base_evts.get("retirementYearClient"):
        age = _age_for_client(prop_ret_yr)
        if prop_ss_yr == prop_ret_yr:
            ss_age = _age_for_client(prop_ss_yr)
            body = (f"<b>{client} retires</b>" + (f" (age {age})" if age else "")
                    + f" and Social Security begins"
                    + (f" (age {ss_age})" if ss_age else ""))
        else:
            body = f"<b>{client} retires</b>" + (f" (age {age})" if age else "")
        out.append((prop_ret_yr, str(prop_ret_yr), body, HEX_GOLD))
        if prop_ss_yr and prop_ss_yr != prop_ret_yr:
            ss_age = _age_for_client(prop_ss_yr)
            out.append((prop_ss_yr, str(prop_ss_yr),
                        f"Social Security begins"
                        + (f" (age {ss_age})" if ss_age else ""),
                        HEX_NAVY))
    elif prop_ss_yr:
        ss_age = _age_for_client(prop_ss_yr)
        out.append((prop_ss_yr, str(prop_ss_yr),
                    f"Social Security begins"
                    + (f" (age {ss_age})" if ss_age else ""),
                    HEX_NAVY))

    # 3. RMD start
    if ev.get("rmdStartYearClient"):
        yr = ev["rmdStartYearClient"]
        age = _age_for_client(yr)
        out.append((yr, str(yr),
                    f"RMDs begin on tax-deferred accounts"
                    + (f" (age {age})" if age else ""),
                    HEX_NAVY))

    # 4. Roth conversion window
    if ev.get("firstRothConversionYear") and ev.get("lastRothConversionYear"):
        first = ev["firstRothConversionYear"]
        last = ev["lastRothConversionYear"]
        mid = (first + last) // 2
        out.append((mid, f"{first}–{last}",
                    f"Roth conversion window — "
                    f"<b>{_dollar(prop['events']['totalRothConverted'])}</b> "
                    f"moved from IRA to Roth, paid at known low brackets",
                    HEX_GREEN))

    # Susan retires (not always plotted on the trajectory chart)
    if ev.get("retirementYearSpouse") and spouse:
        yr = ev["retirementYearSpouse"]
        age = _age_for_spouse(yr)
        out.append((yr, str(yr),
                    f"{spouse} retires" + (f" (age {age})" if age else ""),
                    HEX_NAVY))

    # Estate / second death
    if data["estate"]["proposed"]["secondDeath"]:
        sd = data["estate"]["proposed"]["secondDeath"]
        out.append((sd["year"], str(sd["year"]),
                    f"Plan horizon — projected legacy of "
                    f"<b>{_dollar(_n(sd.get('grossEstate', 0)))}</b> "
                    f"transfers to heirs",
                    HEX_NAVY))

    return out


# ═════════════════════════════════════════════════════════════════════════
# PAGE BUILDERS
# ═════════════════════════════════════════════════════════════════════════

def _page2_summary(story: list, data: dict):
    """PAGE 2 — Executive summary, KPIs, what-changes bullets, allocation."""

    story.append(Paragraph("Executive Summary", ST["section"]))
    story.append(GoldRule(CONTENT_W * 0.35))
    story.append(Spacer(1, 0.08 * inch))

    summary = build_executive_summary(data)
    story.append(Paragraph(summary, ST["narrative"]))
    story.append(Spacer(1, 0.08 * inch))

    # KPI cards — Success rate, Ending portfolio, Lifetime taxes, Peak portfolio.
    base = data["base"]
    prop = data["proposed"]
    base_pct = base.get("mc", {}).get("successPct", 0)
    prop_pct = prop.get("mc", {}).get("successPct", 0)

    end_delta = prop["endingPortfolio"] - base["endingPortfolio"]
    end_delta_pct = (end_delta / base["endingPortfolio"]) * 100 if base["endingPortfolio"] else 0

    tax_delta = prop["totalTaxesLifetime"] - base["totalTaxesLifetime"]
    wd_delta = prop["totalWithdrawalsLifetime"] - base["totalWithdrawalsLifetime"]

    kw = CONTENT_W / 4 - 4
    cards = [
        KPICard(
            "Success Rate",
            f"{base_pct}% → {prop_pct}%",
            "Higher is better",
            width=kw,
            accent=GREEN if prop_pct >= 80 else AMBER if prop_pct >= 60 else RED,
        ),
        KPICard(
            "Ending Portfolio",
            f"{_dollar(base['endingPortfolio'])} → {_dollar(prop['endingPortfolio'])}",
            f"{'+' if end_delta >= 0 else ''}{_dollar(end_delta)}  ({'+' if end_delta_pct >= 0 else ''}{end_delta_pct:.0f}%)",
            width=kw,
        ),
        KPICard(
            "Lifetime Income Taxes",
            f"{_dollar(base['totalTaxesLifetime'])} → {_dollar(prop['totalTaxesLifetime'])}",
            f"{'+' if tax_delta >= 0 else ''}{_dollar(tax_delta)} (income tax, no estate tax projected)",
            width=kw,
        ),
        KPICard(
            "Lifetime Withdrawals",
            f"{_dollar(base['totalWithdrawalsLifetime'])} → {_dollar(prop['totalWithdrawalsLifetime'])}",
            "Total portfolio draws over horizon",
            width=kw,
        ),
    ]
    t = Table([cards], colWidths=[kw + 4] * 4)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 1),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.14 * inch))

    # What changes — bullet list.
    story.append(Paragraph("What's Different in the Proposed Plan", ST["subsection"]))
    story.append(GoldRule(CONTENT_W * 0.2))
    story.append(Spacer(1, 0.04 * inch))

    bullets = build_change_bullets(data)
    for b in bullets:
        story.append(Paragraph(
            f"<font color='{HEX_GOLD}'>•</font>&nbsp;&nbsp;{b}",
            ST["bullet"],
        ))
    story.append(Spacer(1, 0.10 * inch))

    # Allocation snapshot — TODAY balances. Split into two pies so the
    # real-estate share doesn't drown out the investable bucket.
    story.append(Paragraph("Asset Composition Today", ST["subsection"]))
    story.append(GoldRule(CONTENT_W * 0.2))
    story.append(Spacer(1, 0.04 * inch))

    alloc = base["allocation"]
    investable = {
        k: v for k, v in alloc.items()
        if k in ("taxable", "retirement", "cash") and v > 0
    }
    total_assets = {k: v for k, v in alloc.items() if v > 0}

    lp = _make_chart(_pie_chart(investable, "Investable Assets"), wi=3.2, hi=1.5)
    rp = _make_chart(_pie_chart(total_assets, "All Household Assets"), wi=3.2, hi=1.5)
    if lp and rp:
        pt = Table([[lp, rp]], colWidths=[HALF + 4, HALF + 4])
        pt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(pt)
    elif lp:
        story.append(lp)

    story.append(Spacer(1, 0.04 * inch))

    investable_total = sum(investable.values())
    real_estate_total = alloc.get("realEstate", 0)
    story.append(Paragraph(
        f"Today the household has {_dollar(investable_total)} in investable assets "
        f"(taxable, retirement, and cash) plus {_dollar(real_estate_total)} in real estate "
        f"and other illiquid holdings. The Monte Carlo simulation and the projections that "
        f"follow focus on the investable portfolio — that's the bucket that funds spending "
        f"once salaries stop. The proposed plan keeps every illiquid asset in place and "
        f"changes only how the investable side is funded and managed.",
        ST["narrative"],
    ))

    story.append(PageBreak())


def _total_growth_chart(data: dict):
    """Simple line chart: total portfolio over time, current vs proposed."""
    base_rows = data["base"]["rows"]
    prop_rows = data["proposed"]["rows"]

    def make():
        years = [r["year"] for r in base_rows]
        cur = [r["totalPortfolio"] / 1e6 for r in base_rows]
        prp = [r["totalPortfolio"] / 1e6 for r in prop_rows]
        fig, ax = plt.subplots(figsize=(3.4, 1.9))
        ax.plot(years, cur, color=HEX_SLATE, lw=1.6, label="Current", linestyle="--")
        ax.plot(years, prp, color=HEX_GOLD, lw=2.2, label="Proposed")
        ax.fill_between(years, prp, cur, where=[p >= c for p, c in zip(prp, cur)],
                        color=HEX_GREEN, alpha=0.10)
        ax.set_ylabel("Total assets ($M)", fontsize=6.5)
        ax.set_xlabel("Year", fontsize=6.5)
        ax.legend(fontsize=6, framealpha=.85, loc="upper left")
        _style_ax(ax, "Total Portfolio Trajectory")
        fig.tight_layout()
        return fig

    return make


def _page3_mechanics(story: list, data: dict):
    """PAGE 3 — When the plan changes: trajectory, key events, and a dedicated
    Roth-conversion-strategy section."""

    story.append(Paragraph("When the Plan Changes", ST["section"]))
    story.append(GoldRule(CONTENT_W * 0.35))
    story.append(Spacer(1, 0.06 * inch))

    # Trajectory chart with life-event markers
    traj = _make_chart(_trajectory_chart(data), wi=6.8, hi=2.5)
    if traj:
        traj.hAlign = "CENTER"
        story.append(traj)
        story.append(Paragraph(
            "Total portfolio balance, year by year. Blue is what both plans share; green "
            "stacks on top of blue when the proposed plan is ahead. Numbered markers tie "
            "directly to the Key Events table below.",
            ST["caption"],
        ))
    story.append(Spacer(1, 0.10 * inch))

    # Key events list
    story.append(Paragraph("Key Events on the Proposed Path", ST["subsection"]))
    story.append(GoldRule(CONTENT_W * 0.2))
    story.append(Spacer(1, 0.04 * inch))

    events = build_key_events_for_proposed(data)
    if events:
        rows = []
        for idx, (_, year_label, body, color) in enumerate(events, start=1):
            chip = NumberChip(idx, color)
            rows.append([
                chip,
                Paragraph(f"<font color='{HEX_NAVY}'><b>{year_label}</b></font>", ST["body"]),
                Paragraph(body, ST["body"]),
            ])
        evt_tbl = Table(rows, colWidths=[0.32 * inch, 1.05 * inch, CONTENT_W - 1.37 * inch])
        evt_tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LINEABOVE", (0, 0), (-1, 0), 0.3, BORDER_CLR),
            ("LINEBELOW", (0, 0), (-1, -1), 0.3, BORDER_CLR),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (0, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, -1), 4),
        ]))
        story.append(evt_tbl)
    story.append(Spacer(1, 0.12 * inch))

    # Roth conversion deep dive — the user wanted explicit detail here.
    _roth_conversion_section(story, data)

    story.append(PageBreak())


def _roth_conversion_section(story: list, data: dict):
    """Dedicated narrative + KPI strip for the Roth-conversion strategy."""
    base_ev = data["base"]["events"]
    prop_ev = data["proposed"]["events"]
    base_roth = base_ev.get("totalRothConverted", 0)
    prop_roth = prop_ev.get("totalRothConverted", 0)
    delta = prop_roth - base_roth
    first = prop_ev.get("firstRothConversionYear")
    last = prop_ev.get("lastRothConversionYear")
    window_yrs = (last - first + 1) if (first and last) else 0

    # Tax delta over the conversion window (proposed - base) — gives the
    # "what does this cost us up front?" answer in dollars.
    base_rows = {r["year"]: r for r in data["base"]["rows"]}
    prop_rows = {r["year"]: r for r in data["proposed"]["rows"]}
    window_tax_delta = 0.0
    if first and last:
        for y in range(first, last + 1):
            window_tax_delta += prop_rows.get(y, {}).get("taxes", 0) - base_rows.get(y, {}).get("taxes", 0)

    # Long-term outcome difference (ending portfolio).
    end_delta = data["proposed"]["endingPortfolio"] - data["base"]["endingPortfolio"]

    story.append(Paragraph("Roth Conversion Strategy", ST["subsection"]))
    story.append(GoldRule(CONTENT_W * 0.2))
    story.append(Spacer(1, 0.04 * inch))

    # Account name that's actually being converted (from inventory).
    ira = next(
        (a for a in data.get("inventory", {}).get("accounts", [])
         if a.get("name", "").lower() == "ira"),
        None,
    )
    roth = next(
        (a for a in data.get("inventory", {}).get("accounts", [])
         if "roth ira" in a.get("name", "").lower()),
        None,
    )
    source_phrase = (
        f"from {ira['name']} into {roth['name']}" if ira and roth else
        "from traditional IRA into Roth IRA"
    )

    body = (
        f"The proposed plan runs a <b>{window_yrs}-year Roth conversion ladder</b> from "
        f"<b>{first}–{last}</b>, moving <b>{_dollar(prop_roth)}</b> {source_phrase} — "
        f"about {_dollar(abs(delta))} {'more' if delta > 0 else 'less'} than the "
        f"current plan converts ({_dollar(base_roth)}). Each conversion is sized to "
        f"fill the household's lower marginal-rate brackets before RMDs begin in "
        f"<b>{prop_ev.get('rmdStartYearClient', 'the early 70s')}</b>, so the income "
        f"is recognized at today's known rates rather than at the higher RMD-driven "
        f"rates that would otherwise apply once both Social Security and required "
        f"distributions stack on top of one another."
    )
    story.append(Paragraph(body, ST["narrative"]))
    story.append(Spacer(1, 0.04 * inch))

    # KPI strip — window, total converted, tax cost during window, outcome.
    kw = CONTENT_W / 4 - 4
    cards = [
        KPICard(
            "Conversion Window",
            f"{first}–{last}" if (first and last) else "—",
            f"{window_yrs} years before RMDs",
            width=kw,
            accent=GREEN,
        ),
        KPICard(
            "Total Converted",
            _dollar(prop_roth),
            f"vs {_dollar(base_roth)} on current plan",
            width=kw,
        ),
        KPICard(
            "Tax Cost During Window",
            f"{'+' if window_tax_delta >= 0 else ''}{_dollar(window_tax_delta)}",
            "Extra income tax vs current plan",
            width=kw,
            accent=AMBER,
        ),
        KPICard(
            "Long-term Reward",
            f"{'+' if end_delta >= 0 else ''}{_dollar(end_delta)}",
            "Ending portfolio vs current plan",
            width=kw,
            accent=GREEN if end_delta > 0 else RED,
        ),
    ]
    t = Table([cards], colWidths=[kw + 4] * 4)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 1),
        ("RIGHTPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.06 * inch))

    story.append(Paragraph(
        "<b>Why this works:</b> Roth dollars grow tax-free for life, are never subject "
        "to RMDs, and pass to heirs without an embedded income-tax liability. The cost "
        "is paying income tax sooner — but at brackets we can see and control today "
        "rather than at rates set by future tax law and a much larger required "
        "distribution.",
        ST["body"],
    ))


def _page4_cash_flow(story: list, data: dict):
    """PAGE 4 — How spending, income, and income tax interact year by year."""
    story.append(Paragraph("Spending, Income & Taxes", ST["section"]))
    story.append(GoldRule(CONTENT_W * 0.35))
    story.append(Spacer(1, 0.04 * inch))

    _expenses_section(story, data)
    story.append(Spacer(1, 0.06 * inch))

    _income_section(story, data)
    story.append(Spacer(1, 0.06 * inch))

    _income_tax_section(story, data)
    story.append(PageBreak())


def _expenses_section(story: list, data: dict):
    """How spending works — explain the lifestyle assumption, inflation, and
    the pre-vs-post-retirement step."""
    h = data["household"]
    prop = data["proposed"]
    prop_rows = prop["rows"]
    yr1 = prop_rows[0]
    living_yr1 = yr1["living"]
    insurance_yr1 = yr1["insurance"]

    # Find the first retirement-year row for a real "what spending looks like
    # in year-one of retirement" reading point.
    ret_yr = prop["events"].get("retirementYearClient")
    ret_row = next((r for r in prop_rows if r["year"] == ret_yr), None) if ret_yr else None
    end_row = prop_rows[-1]

    # Inflation rate from household block.
    infl = h.get("inflationRate", 0.03) * 100

    # Pull the underlying expense intent (today's-dollar amounts) from the
    # scenario_change payload + base expense inventory so the narrative is
    # anchored to the advisor's actual inputs.
    exp_inv = data.get("inventory", {}).get("expenses", []) or []
    pre_ret = next((e for e in exp_inv if e["name"] == "Current Living Expenses"), None)
    post_ret_base = next(
        (e for e in exp_inv if e["name"] == "Retirement Living Expenses"), None,
    )
    post_ret_edit = next(
        (c for c in data.get("scenarioChanges", []) or []
         if c.get("kind") == "expense_edit" and c.get("expenseName") == "Retirement Living Expenses"),
        None,
    )
    post_ret_proposed_today = _n((post_ret_edit or {}).get("to", post_ret_base["annualAmount"] if post_ret_base else 0))

    story.append(Paragraph("How Spending Works", ST["subsection"]))
    story.append(GoldRule(CONTENT_W * 0.2))
    story.append(Spacer(1, 0.04 * inch))

    pre_today = pre_ret["annualAmount"] if pre_ret else living_yr1
    paragraphs = [
        (
            f"Spending is modeled in two phases. <b>Pre-retirement</b> the plan carries a "
            f"<b>{_dollar(pre_today)}/yr lifestyle assumption</b> (today's dollars), inflating "
            f"at <b>{infl:.1f}%/yr</b> until {h['clientFirstName']} retires. "
            f"<b>Post-retirement</b> the assumption resets to "
            f"<b>{_dollar(post_ret_proposed_today)}/yr</b> in today's dollars — the line item "
            f"the proposed plan raised from {_dollar((post_ret_edit or {}).get('from', post_ret_base['annualAmount'] if post_ret_base else 0))} "
            f"so the projection reflects what life actually costs rather than an optimistic floor."
        ),
        (
            f"Inflated forward, that translates to roughly {_dollar(living_yr1)} of living "
            f"expense in Year&nbsp;1 ({h['planStartYear']}), "
            + (
                f"about {_dollar(ret_row['living'])} in the first full year of retirement "
                f"({ret_yr}), and {_dollar(end_row['living'])} at plan end ({end_row['year']}). "
                if ret_row else ""
            )
            + f"Insurance premiums are layered on top — starting at {_dollar(insurance_yr1)} in "
            f"Year&nbsp;1 and growing with healthcare inflation as Medicare picks up coverage."
        ),
    ]
    for p in paragraphs:
        story.append(Paragraph(p, ST["narrative"]))
        story.append(Spacer(1, 0.02 * inch))

    chart = _make_chart(_expense_chart(data), wi=5.6, hi=1.4)
    if chart:
        chart.hAlign = "CENTER"
        story.append(chart)


def _income_section(story: list, data: dict):
    story.append(Paragraph("How Income Funds Each Year", ST["subsection"]))
    story.append(GoldRule(CONTENT_W * 0.2))
    story.append(Spacer(1, 0.04 * inch))

    h = data["household"]
    prop = data["proposed"]
    ret_yr = prop["events"].get("retirementYearClient")
    ss_yr = prop["events"].get("ssClaimYearClient")
    spouse_ret_yr = prop["events"].get("retirementYearSpouse")
    sentence = (
        f"Through {ret_yr - 1 if ret_yr else 'retirement'}, salary funds the household. "
        f"Starting in {ret_yr}, {h['clientFirstName']}'s salary ends; "
        + (f"Social Security begins in {ss_yr}" if ss_yr else "Social Security begins later")
        + (f", and {h['spouseFirstName']} retires in {spouse_ret_yr}" if (h.get("spouseFirstName") and spouse_ret_yr) else "")
        + ". From that point on, Social Security covers a steady baseline and portfolio "
        "withdrawals fill the gap between expenses and other income."
    )
    story.append(Paragraph(sentence, ST["narrative"]))
    story.append(Spacer(1, 0.04 * inch))

    inc = _make_chart(_stacked_income_chart(data, "proposed"), wi=5.6, hi=1.5)
    if inc:
        inc.hAlign = "CENTER"
        story.append(inc)


def _income_tax_section(story: list, data: dict):
    """Annual income tax detail — current vs proposed, with Roth window shaded
    so the deliberate tax pull-forward is obvious."""
    base = data["base"]
    prop = data["proposed"]
    base_lifetime = base["totalTaxesLifetime"]
    prop_lifetime = prop["totalTaxesLifetime"]
    tax_delta = prop_lifetime - base_lifetime
    ev = prop["events"]
    first = ev.get("firstRothConversionYear")
    last = ev.get("lastRothConversionYear")

    story.append(Paragraph("Income Tax Over Time", ST["subsection"]))
    story.append(GoldRule(CONTENT_W * 0.2))
    story.append(Spacer(1, 0.04 * inch))

    narrative = (
        f"Across the entire plan, the proposed strategy pays <b>{_dollar(prop_lifetime)}</b> in "
        f"federal income tax (ordinary, capital-gains, and the taxable portion of Social "
        f"Security) versus <b>{_dollar(base_lifetime)}</b> on the current plan — "
        f"<b>{'+' if tax_delta >= 0 else ''}{_dollar(tax_delta)}</b> more "
        f"({tax_delta / base_lifetime * 100:+.0f}%). Almost all of that swing concentrates "
        f"inside the Roth-conversion window ({first}–{last}), shown shaded below. The "
        f"after-window years often run <i>lower</i> than the current plan because RMDs "
        f"are smaller on a shrunken IRA. "
        f"<b>Estate tax is projected at $0</b> in both plans — the federal exemption fully "
        f"covers the projected estate at second death — so this is an income-tax-only comparison."
    )
    story.append(Paragraph(narrative, ST["narrative"]))
    story.append(Spacer(1, 0.04 * inch))

    chart = _make_chart(_annual_income_tax_chart(data), wi=5.6, hi=1.5)
    if chart:
        chart.hAlign = "CENTER"
        story.append(chart)


def _page5_analysis(story: list, data: dict):
    """PAGE 5 — Retirement Plan Analysis (Monte Carlo hero + inputs + longevity + estate)."""

    story.append(Paragraph("Retirement Plan Analysis", ST["section"]))
    story.append(GoldRule(CONTENT_W * 0.35))
    story.append(Spacer(1, 0.04 * inch))
    story.append(Paragraph(
        "Stress-testing both plans across 1,000 Monte Carlo trials of market returns.",
        _s("framing", fontSize=9, leading=12, textColor=TEXT_LIGHT,
           fontName="Helvetica-Oblique"),
    ))
    story.append(Spacer(1, 0.10 * inch))

    base_pct = data["base"].get("mc", {}).get("successPct", 0)
    prop_pct = data["proposed"].get("mc", {}).get("successPct", 0)

    hero = HeroResultBand(
        CONTENT_W, base_pct, prop_pct,
        caption=("Likelihood your portfolio supports your spending need through age "
                 f"{data['proposed']['planEndAge']}."),
    )
    story.append(hero)
    story.append(Spacer(1, 0.04 * inch))

    # Secondary headline — the dollar story sits below the Monte Carlo
    # percentage so the report doesn't read like a +4-point story when the
    # ending-portfolio swing is the more material number.
    end_base = data["base"]["endingPortfolio"]
    end_prop = data["proposed"]["endingPortfolio"]
    end_delta = end_prop - end_base
    end_pct = end_delta / end_base * 100 if end_base else 0
    base_median = data["base"].get("mc", {}).get("medianEndingLiquid", 0)
    prop_median = data["proposed"].get("mc", {}).get("medianEndingLiquid", 0)
    headline_text = (
        f"<b>And the dollar impact:</b> projected total portfolio at plan end of "
        f"<b>{_dollar(end_prop)}</b> versus <b>{_dollar(end_base)}</b> "
        f"({end_pct:+.0f}%, or about {_dollar(abs(end_delta))} more) — and a median Monte "
        f"Carlo ending liquid balance of <b>{_dollar(prop_median)}</b> versus "
        f"<b>{_dollar(base_median)}</b>."
    )
    story.append(Paragraph(
        headline_text,
        _s("hero_sub", fontSize=9, leading=12, textColor=TEXT_DARK,
           alignment=TA_CENTER),
    ))
    story.append(Spacer(1, 0.10 * inch))

    # Input cards
    h = data["household"]
    base = data["base"]
    prop = data["proposed"]
    starting = sum(base["allocation"].values())
    living_yr1 = prop["rows"][0]["living"]

    cards = [
        KPICard(
            "Starting Assets",
            _dollar(starting),
            "Total household balance sheet today",
            tag="INPUT",
        ),
        KPICard(
            "Annual Living Expense",
            _dollar(living_yr1),
            f"Year 1, indexed at {h['inflationRate'] * 100:.1f}% / yr",
            tag="INPUT",
            sub2=f"Proposed retirement age {prop['retirementAge']}",
        ),
        KPICard(
            "Plan Through",
            f"Age {prop['planEndAge']}",
            f"Through year {h['planEndYear']}",
            tag="INPUT",
        ),
    ]
    n = len(cards)
    card_w = int((CONTENT_W - 12) / n)
    for c in cards:
        c.w = card_w
    kpi_table = Table([cards], colWidths=[card_w + 4] * n)
    kpi_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(kpi_table)
    story.append(Spacer(1, 0.06 * inch))

    # Range of outcomes (real per-year MC quantiles)
    story.append(Paragraph("Range of Outcomes", ST["subsection"]))
    story.append(GoldRule(CONTENT_W * 0.2))
    story.append(Spacer(1, 0.03 * inch))
    out = _make_chart(_outcomes_chart(data), wi=5.6, hi=1.5)
    if out:
        out.hAlign = "CENTER"
        story.append(out)
        story.append(Paragraph(
            "10th–90th percentile band of liquid-asset balances across the 1,000 trials. "
            "The proposed median sits above the current median once the Roth window closes.",
            ST["caption"],
        ))
        story.append(Spacer(1, 0.06 * inch))

    # Longevity curve
    story.append(Paragraph("Longevity Risk", ST["subsection"]))
    story.append(GoldRule(CONTENT_W * 0.2))
    story.append(Spacer(1, 0.03 * inch))
    lon = _make_chart(_longevity_chart(data), wi=5.6, hi=1.1)
    if lon:
        lon.hAlign = "CENTER"
        story.append(lon)
    story.append(Spacer(1, 0.06 * inch))

    # Side-by-side: lifetime income taxes and estate
    story.append(Paragraph("Lifetime Income Tax & Legacy", ST["subsection"]))
    story.append(GoldRule(CONTENT_W * 0.2))
    story.append(Spacer(1, 0.04 * inch))

    left = _make_chart(_lifetime_tax_chart(data), wi=3.1, hi=1.6)
    right = _make_chart(_estate_chart(data), wi=3.1, hi=1.6)
    if left and right:
        t2 = Table([[left, right]], colWidths=[HALF + 4, HALF + 4])
        t2.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(t2)

    # Disclosure
    story.append(Spacer(1, 0.12 * inch))
    story.append(GoldRule(CONTENT_W))
    story.append(Spacer(1, 0.04 * inch))
    story.append(Paragraph(
        "<b>Disclosure:</b> This report is provided to you by Ethos Financial Group, LLC for "
        "informational purposes only. Monte Carlo projections randomize annual market returns "
        "around long-term asset-class assumptions and are not predictions; actual results will "
        "differ. Tax modeling uses currently published federal brackets and IRS tables. This "
        "report is not investment, tax, or legal advice. Please contact Ethos Financial Group, "
        "LLC with any questions.",
        ST["disclaimer"],
    ))


# ═════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════════

def build_retirement_memo_pdf(data: dict) -> bytes:
    buf = io.BytesIO()
    doc = BaseDocTemplate(
        buf, pagesize=letter,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=0.55 * inch, bottomMargin=0.55 * inch,
        title=f"Retirement Plan Memo – {_client_display(data)}",
        author="Ethos Financial Group",
    )
    doc._memo_data = data

    cover_frame = Frame(0, 0, PAGE_W, PAGE_H, id="cover",
                        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    cover_tmpl = PageTemplate(id="cover", frames=[cover_frame], onPage=_draw_cover)

    content_frame = Frame(MARGIN, 0.55 * inch, CONTENT_W,
                          PAGE_H - 0.55 * inch - 0.55 * inch - 34,
                          id="content", leftPadding=0, rightPadding=0,
                          topPadding=0, bottomPadding=0)
    content_tmpl = PageTemplate(id="content", frames=[content_frame], onPage=_draw_content_page)

    doc.addPageTemplates([cover_tmpl, content_tmpl])

    story: list = []
    story.append(Spacer(1, PAGE_H - 1))
    story.append(PageBreak())
    story.insert(len(story) - 1, NextPageTemplate("content"))

    _page2_summary(story, data)
    _page3_mechanics(story, data)
    _page4_cash_flow(story, data)
    _page5_analysis(story, data)

    doc.build(story)
    buf.seek(0)
    return buf.getvalue()


# ═════════════════════════════════════════════════════════════════════════
# CLI
# ═════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="scripts/retirement-memo-data.json")
    parser.add_argument("--out", default="scripts/retirement-memo.pdf")
    args = parser.parse_args()

    with open(args.data) as f:
        data = json.load(f)

    pdf = build_retirement_memo_pdf(data)
    out_path = Path(args.out)
    out_path.write_bytes(pdf)
    print(f"[memo] wrote {out_path}  ({len(pdf):,} bytes)")


if __name__ == "__main__":
    main()
