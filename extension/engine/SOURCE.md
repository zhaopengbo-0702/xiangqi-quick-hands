# Compatibility WASM Engine

Fairy-Stockfish WebAssembly, npm package `fairy-stockfish-nnue.wasm@1.1.12`.

- Copyright: the authors listed in AUTHORS.
- License: GNU General Public License version 3; see Copying.txt.
- Upstream: https://github.com/fairy-stockfish/fairy-stockfish.wasm
- Exact source revision: b2e693ef1e111233ce3fb40685921708b3276ed6
- Corresponding source: https://github.com/fairy-stockfish/fairy-stockfish.wasm/tree/b2e693ef1e111233ce3fb40685921708b3276ed6
- Source archive supplied as `engine/corresponding-source.tar.gz` in the extension ZIP and in `third_party/fairy-stockfish-b2e693ef.tar.gz` at the project root.
- Build instructions: `src/emscripten/README.md` and `src/emscripten/Makefile` in the source archive.
- Original package: https://registry.npmjs.org/fairy-stockfish-nnue.wasm/-/fairy-stockfish-nnue.wasm-1.1.12.tgz
- Package SHA-1: 6215e1649336b0109f3a42dfc75b41ed8ab417fc

The three engine runtime files are unmodified. They support the legacy WASM
tests and standalone browser harness, selecting the built-in `xiangqi` variant
with classical evaluation. The production extension selects the official native
Pikafish companion and its matching NNUE network; see the runtime sources and
licenses in `third_party/pikafish` at the project root. A failed native connection
does not silently switch to this compatibility engine.
Move ranks in this engine are 1 through 10, with a1 at Red's bottom-left corner.

The wrapper's adaptive time allocation is documented in [POLICY.md](POLICY.md).

When redistributing this extension, retain the license, notices and corresponding
source archive. The source archive also contains the engine's compilation scripts.
