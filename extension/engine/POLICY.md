# Search Policy

## Engine Contract

The production extension prefers the official Pikafish native companion. If
native messaging is unavailable, it uses the bundled genuine Pikafish WASM build
with the same NNUE weights. The panel identifies the selected backend. Both
backends require an actual depth-one probe reporting NNUE evaluation and a valid
best move. The browser backend verifies the network's size and SHA256 before
initializing it. Integrity or NNUE verification errors remain hard failures.
Native mode defaults to four threads and Hash128; browser mode uses at most four
threads and Hash64. The legacy classical engine is only for compatibility tests.

`analyze({fen, movetime, mode, balance, requestId, initialFen, moves})` runs one engine evaluation
search. `mode` defaults to `adaptive`; `fixed` uses the requested time directly.
`movetime` defaults to 3500 ms and is clamped to 100..3500 ms. `balance` defaults
to 0.65 and is clamped to 0..1. Higher balance spends more time at the same
estimated importance. Adaptive mode uses MultiPV=2; fixed mode uses MultiPV=1.

The wrapper sets the position, requests the engine's lightweight `d` diagnostic
and `go perft 1` legal-move enumeration in adaptive mode, then sends one
`go infinite`. Diagnostic work is included in the turn budget. It sends `stop`
at the chosen allocation or at the hard requested limit. A separate 4300 ms
watchdog restarts an unresponsive engine and may return the last valid completed
principal variation. Cancellation restarts the engine to discard late results.

The wrapper generates no legal moves and implements no attack/check rules.
The selected proven engine supplies moves, evaluation, mate detection, checkers
and legal move count. Internal extension coordinates use files a..i and ranks
1..10; the native adapter converts every Pikafish rank 0..9 at the boundary,
including move histories, principal variations, ponder moves and perft output.

## Game History

Optional `initialFen` and `moves` must be supplied together. Moves are bounded to
1024 validated coordinate strings. When complete history is available, the
wrapper sends `position fen <initialFen> moves <moves...>` so the engine retains
its repetition and chase context. History availability is not required for a
position-only search, but a supplied history must pass validation.

The wrapper validates side-to-move parity, then asks the engine to reconstruct
the position. Before starting search, the engine's `d` output must match the
current board and side, and its fullmove number must equal the initial fullmove
number plus the number of Black plies in the supplied sequence. This extra
counter check catches an illegal move that silently truncated UCI history even
when the board has cycled back to the same arrangement. Site halfmove/fullmove
counters need not match the engine's independently reconstructed counters.

Reconstruction is included in the same bounded computation budget. A mismatch
rejects the request and restarts the engine. Cancellation while verification is
pending prevents a late diagnostic from starting search. Callers should omit
both history fields when the site's history is partial, rather than treating a
partial move list as complete.

Pikafish initial FEN counters must be in its accepted range (rule60 below 120,
fullmove at most 100000). Complete replayed history may advance beyond those
starting-counter bounds. In that case the wrapper skips the optional perft
diagnostic, which would otherwise reparse the derived FEN and fail; the engine
still searches the original position with its full repetition/rule context.

## Importance

Only exact-score completed PV iterations count toward completed depth. Current
move progress and lower/upper bound reports do not update completed depth,
score or PV. Adaptive stop checks begin after a 450 ms probe; normal early stops
require depth at least 6, while a positive exact mate may stop earlier.

- `gapCp`: first minus second candidate score at the deepest common completed
  depth, clamped to at least zero. Candidates with mate scores are not converted
  to arbitrary centipawn numbers.
- `uncertainty = exp(-gapCp / 120)`; 0.85 when there is no comparable score pair.
- `churn`: fraction of adjacent principal moves that changed across the last six
  completed main-PV iterations.
- `volatility`: largest adjacent centipawn score swing in those iterations,
  divided by 120 and capped at 1.
- `tactics`: maximum captured-piece weight within the first four engine-PV
  plies: rook 1, cannon 0.8, horse 0.7, other pieces 0. The wrapper replays
  occupancy using engine coordinates without implementing movement rules.

```text
I = clamp(0.05 + 0.45*uncertainty + 0.20*churn
          + 0.20*volatility + 0.20*tactics, 0, 1)
allocatedMs = min(requestedLimit, round(650 + 2850 * I^(1.4 - 0.8*balance)))
```

The engine's `Checkers:` output identifies check and raises I to at least 0.85.
An exact positive mate score overrides that floor and sets I=0; a negative mate
sets I=1. Exactly one legal move overrides all these cases and sets I=0, since
the choice is forced. Zero legal moves uses the engine's normal terminal result.
The normal minimum allocation is 650 ms, unless the caller explicitly requests
a lower hard limit. Allocation is recomputed as completed iterations arrive,
and a 50 ms timer also checks whether it is time to stop.

## Result

The result includes `bestmove`, `depth`, `score`, `pv`, `nodes`, `elapsedMs`,
`requestId`, `mode`, `balance`, `inCheck`, `legalMoves`, `importance`,
`allocatedMs`, `reason`, `stopReason` and, in adaptive mode, `importanceInputs`.
`historyUsed` reports verified history reconstruction; `historyPlies` reports its
move count (zero for a position-only request).
`importanceInputs` contains `gapCp`, `uncertainty`, `churn`, `volatility`, `tactics`,
`pairedDepth`, `inCheck` and `legalMoves`. `importance` is null in fixed mode.
`engineName`, `nnue` and `nnueVerified` identify the actual engine and whether its
network was verified by the startup probe. `backend` is `native` or `wasm`;
`nativeError` retains the initialization error when browser fallback was needed.
Terminal positions return `bestmove: null` and `terminal: true`.

`reason` is an array of codes: `only-legal-move`, `winning-mate`,
`defensive-mate`, `king-in-check`, `close-candidates`, `clear-leader`,
`unstable-principal`, `volatile-score`, `material-tactics`, `limited-probe`,
`balanced-search`, or `fixed-budget`.

## Limits

This is a bounded time-allocation heuristic. Importance estimates uncertainty
and tactical activity; it does not establish the globally optimal move or prove
that a position with a lower estimate is strategically unimportant. MultiPV=2
also reaches less depth than a single-PV search given the same CPU time. The
controller must reject insufficient-depth results when the hard time limit is
reached before its quality threshold. Browser scheduling and device load can
delay timer delivery; the extension reserves time for recognition and execution
but cannot provide a real-time operating-system guarantee.
