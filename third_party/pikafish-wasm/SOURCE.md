# Pikafish WebAssembly Runtime Provenance

The runtime contains the unmodified binary assets from the third-party
`brianhliou/pikafish-wasm` release `v0.1.0`. It is a browser compilation of
mainline Pikafish with its NNUE evaluator, rather than Fairy-Stockfish.

## Pinned Sources

- Browser build release: <https://github.com/brianhliou/pikafish-wasm/releases/tag/v0.1.0>
- Browser build source commit: `4262e0f022a966e2401d01afd4b2a599b7fbdc2a`
- Pikafish source commit: `6a59ee2f7b105bff64d9efc2692591107787e2b1`
- Pikafish source: <https://github.com/official-pikafish/Pikafish/tree/6a59ee2f7b105bff64d9efc2692591107787e2b1>
- Toolchain declared by the publisher: `emscripten/emsdk:3.1.74`

`Pikafish-6a59ee2f-source.tar.gz` preserves the upstream source before patching.
`pikafish-wasm-v0.1.0-source.tar.gz` preserves the browser build source,
including its original `worker.js`, build script and licenses. The companion
`source.patch` exposes initialization and a one-line UCI command entry point;
it does not replace the engine search or evaluator. The archives, patch and
build script are sufficient to reconstruct the build without distributing a
second expanded source tree.

In the development checkout these materials live at `third_party/pikafish-wasm`
relative to the project root. Both distribution archives carry the same
materials at `extension/engine/pikafish/source` relative to the project root
(or `engine/pikafish/source` within the extension-only archive). This document
is copied with them and applies at either location.

## Verified Files

The binary files were downloaded from the release above on 2026-11-01.
Their SHA-256 values match the publisher's included `SHA256SUMS`:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `pikafish.js` | 80,121 | `17bc398028450c4c56df27812324cca8e5af9e2c86662f4a0d7f5b328270df3a` |
| `pikafish.wasm` | 662,419 | `b437f89ca16a1ff9181878813d1991f60b22067dca6b3feb79a26033224a83b1` |
| Matching `pikafish.nnue` | 50,706,378 | `7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e` |

The shared network is stored at `extension/engine/pikafish/pikafish.nnue`
relative to the project root, or beside the runtime files in the extension-only
archive. Native `runtime.json` points to that same file. The browser build
publisher pins this network
to the 2026-09-06 upstream `master-net` asset, architecture
`(62083, 1024, 32, 32, 1)`. The upstream network URL is rolling, so do not
replace the network without verifying its hash and engine compatibility.

Source archive checksums:

- `Pikafish-6a59ee2f-source.tar.gz`:
  `0d19e64cef153a06614c7eadfebefb6d880fb551e9f9b53d5e13a37a6e86ed2f`
- `pikafish-wasm-v0.1.0-source.tar.gz`:
  `1ba676e7646f06fd3bbdf9d2dc153db2f0abb5a4705a22cd43c11578dd594b0a`

The runtime files `extension/engine/pikafish/pikafish.js` and
`extension/engine/pikafish/pikafish.wasm`, relative to the project root, are
byte-for-byte copies of the verified release files. The extension-only archive
contains them at `engine/pikafish`. This provenance step did not compile the
engine.

## Rebuild

From the directory containing this document and the two source archives,
reconstruct a build tree using a POSIX shell, `tar` and `patch`, then use the
publisher's pinned toolchain:

```sh
mkdir pikafish-rebuild
tar -xzf Pikafish-6a59ee2f-source.tar.gz --strip-components=1 -C pikafish-rebuild
mkdir -p pikafish-rebuild/wasm
cp build.sh source.patch pikafish-rebuild/wasm/
cd pikafish-rebuild
patch -p1 < wasm/source.patch
docker run --rm -v "$PWD:/src" -w /src emscripten/emsdk:3.1.74 bash wasm/build.sh
```

The output is `dist/wasm/pikafish.js` and `dist/wasm/pikafish.wasm`.
The complete upstream and browser build sources, patch and build script are
included alongside `UPSTREAM-README.md`. The original browser worker and
licenses can be read by extracting `pikafish-wasm-v0.1.0-source.tar.gz`.

The module exports the `Pikafish` factory, `FS` and `cwrap`. Write the matching
network to `/pikafish.nnue` before calling `pikafish_initialize()`. The command
entry point is `pikafish_command(const char*)`. The build uses SIMD128 and
eight pooled pthread workers, so the host document must provide cross-origin
isolation and `SharedArrayBuffer`; configure at most eight engine threads.

## Licenses

The engine code and browser glue are GPL-3.0-or-later. The browser source
archive includes `LICENSE`; the upstream source archive includes `Copying.txt`.
A copy of the engine license is also distributed beside the runtime binaries.
Keep the corresponding source and build materials available with distributed
engine binaries.

The network has separate Pikafish terms in the `NNUE-License.md` distributed
beside the runtime binaries: legal use only,
and no commercial use without permission. Those terms also apply to derived
network weights. The NNUE file is not covered by the engine's GPL license.
