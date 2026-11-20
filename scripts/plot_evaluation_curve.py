"""Render q(cp) for the README. Run: python scripts/plot_evaluation_curve.py.

Drawing dependencies: numpy, scipy, matplotlib. The browser extension evaluates
the same PCHIP mapping in JavaScript in extension/content.js.
"""

from pathlib import Path
import argparse
import csv
import json

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.interpolate import PchipInterpolator


ROOT = Path(__file__).resolve().parents[1]
KNOTS = np.array([0, .635148952387, .978026114739, .999753210848, .999999969540, 1])
TARGETS = np.array([0, .5, .7, .9, .99, 1])
INTERPOLATOR = PchipInterpolator(KNOTS, TARGETS, extrapolate=False)


def evaluation_q(cp):
    """Magnitude of the six-place panel score, after the final display clamp."""
    cp = np.asarray(cp, dtype=float)
    raw = INTERPOLATOR(np.abs(np.tanh(.015 * cp)))
    return np.round(np.clip(raw, 0, .999999), 6)


def apply_figure_style():
    """Set readable type, outward ticks and a light frame for this saved figure."""
    plt.style.use("default")
    plt.rcParams.update({
        "font.family": "sans-serif", "font.sans-serif": ["DejaVu Sans"],
        "font.size": 12, "axes.labelsize": 13, "axes.titlesize": 14,
        "xtick.labelsize": 11, "ytick.labelsize": 11, "legend.fontsize": 11,
        "axes.spines.top": True, "axes.spines.right": True,
        "axes.edgecolor": "black", "axes.linewidth": .8,
        "xtick.direction": "out", "ytick.direction": "out",
        "axes.unicode_minus": False, "savefig.dpi": 300,
        "pdf.fonttype": 42, "ps.fonttype": 42, "svg.fonttype": "path",
        "mathtext.fontset": "dejavusans",
    })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "docs" / "assets")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    apply_figure_style()

    # Positive half-axis only; integer cp values are also exported.
    cp = np.linspace(0, 1000, 10001)
    q = evaluation_q(cp)
    assert np.all(q >= 0) and np.all(q < 1)
    assert np.allclose(q, evaluation_q(-cp), atol=1e-12)
    assert np.all(np.diff(q) >= 0)
    anchors_cp = np.array([50, 150, 300, 600])
    assert np.array_equal(evaluation_q(anchors_cp), TARGETS[1:5])

    fig, ax = plt.subplots(figsize=(9, 5.7), layout="constrained")
    ax.plot(cp, q, color="tab:blue", linewidth=2, label="Displayed evaluation magnitude")
    ax.scatter(anchors_cp, TARGETS[1:5], color="tab:orange", edgecolors="white", linewidths=.7, s=40, zorder=4)
    for threshold in TARGETS[1:5]:
        ax.axhline(threshold, color="0.55", linestyle="--", linewidth=.8, zorder=0)
    ax.set_title("Evaluation magnitude q versus engine score cp", pad=13)
    ax.set_xlabel("Engine score cp")
    ax.set_ylabel(r"Evaluation magnitude $q = |s|$")
    ax.set_xlim(0, 1000)
    ax.set_ylim(0, 1.04)
    ax.set_xticks([0, 100, 200, 300, 400, 600, 800, 1000])
    ax.set_yticks([0, .2, .4, .5, .7, .9, .99])
    ax.set_yticklabels(["0", "0.2", "0.4", "0.5", "0.7", "0.9", "0.99"])
    ax.grid(axis="x", color="0.9", linewidth=.6)
    ax.legend(loc="lower right", frameon=True)
    for x_value, y_value, offset in [(50, .5, (12, -25)), (150, .7, (14, -25)),
                                    (300, .9, (12, -25)), (600, .99, (12, -25))]:
        ax.annotate(f"({x_value}, {y_value:.2f})", (x_value, y_value), textcoords="offset points",
                    xytext=offset, fontsize=10, color="0.2")
    fig.canvas.draw()
    for suffix in ["png", "svg", "pdf"]:
        fig.savefig(args.output_dir / f"evaluation-q-vs-cp.{suffix}", facecolor="white", dpi=300)
    plt.close(fig)

    with (args.output_dir / "evaluation-q-vs-cp.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["cp", "q"])
        for value in range(0, 1001):
            writer.writerow([value, f"{float(evaluation_q(value)):.6f}"])
    record = {"mapping": "q = abs(s), s = six-place clip(sign(u)*PCHIP(abs(u)), -.999999, .999999), u=tanh(.015*cp)",
              "knots": KNOTS.tolist(), "targets": TARGETS.tolist(),
              "key_values": [{"cp": int(value), "q": float(evaluation_q(value))} for value in [0, 22, 50, 100, 150, 300, 600, 900]],
              "cp_range": [0, 1000], "axes": 1, "language": "English"}
    (args.output_dir / "evaluation-q-vs-cp.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(args.output_dir / "evaluation-q-vs-cp.png")


if __name__ == "__main__":
    main()
