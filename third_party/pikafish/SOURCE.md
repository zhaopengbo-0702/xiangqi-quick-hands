# Official Pikafish Runtime

Release: Pikafish-2026-09-06 from https://github.com/official-pikafish/Pikafish/releases/tag/Pikafish-2026-09-06

- Official archive: https://github.com/official-pikafish/Pikafish/releases/download/Pikafish-2026-09-06/Pikafish.2026-09-06.7z
- Archive SHA256: 41952bbfe2520faceb5902c69e6ab4845cc999841d2b49a95cc1be7867a25e5b (matches GitHub release digest).
- Exact release source: Pikafish-2026-09-06-source.tar.gz, downloaded from https://codeload.github.com/official-pikafish/Pikafish/tar.gz/refs/tags/Pikafish-2026-09-06
- Source archive SHA256: 4d905f5bb9d96632900aa88505d816e2d5997919e1375077a591cfeb0e6c7a10.
- Windows executable: runtime/Pikafish-Windows-x86-64-universal.exe, 6,944,256 bytes.
- Matching network from the same official archive: 50,706,378 bytes, distributed at `extension/engine/pikafish/pikafish.nnue` and shared by native and browser backends. `runtime.json` resolves this path relative to its own directory.
- Individual file hashes and paths are recorded in runtime.json.

Runtime files are unmodified. The universal Windows executable selects a
supported CPU implementation at runtime. On the target Intel Core i5-10210U,
AVX2 and BMI2 are available; AVX512 is not. The companion defaults to four threads
and a 128 MiB hash table. Pikafish combines alpha-beta search with its own NNUE
evaluation; no JavaScript reimplementation of those algorithms is used.

The executable is GPLv3; retain runtime/Copying.txt, runtime/AUTHORS and the
corresponding source archive. The separately distributed neural-network weights
have their own license in runtime/NNUE-License.md, including a restriction on
commercial use without permission. Do not describe those weights as GPL or
unrestricted. Preserve both license files when redistributing this runtime.

The companion verifies binary/network SHA256 and performs a depth-one startup
search. Readiness requires the engine to report NNUE evaluation using the
configured network and return a valid move. Native UCI ranks 0..9 are translated
to the extension's ranks 1..10; FEN board placement remains unchanged.
