# G.726 WebAssembly decoder

This crate wraps the upstream `oxideav-adpcm` G.726 decoder for browser use. The upstream crate is MIT-licensed and supports mono streams at 16, 24, 32, and 40 kbit/s, with `msb` and `lsb` bit packing. Its decoder is stateful across calls and returns signed 16-bit PCM samples.

## Build

From the project root, run:

```powershell
./scripts/build-g726.ps1
```

The script builds the Rust toolchain inside Docker and writes the browser module to `public/wasm/`. It requires Docker Desktop with the Linux engine running and network access for the first build. The Rust and `wasm-pack` versions and Rust dependencies are pinned for repeatable builds. No host Rust installation is needed.

The generated `public/wasm/digifort_g726_wasm.js` and `digifort_g726_wasm_bg.wasm` are reusable runtime artifacts; running the build again is only needed after changing the wrapper or its dependencies.

## Browser API

```js
import init, { G726Decoder } from '/wasm/digifort_g726_wasm.js';

await init();
const decoder = new G726Decoder(32, 'msb');
const pcm16 = decoder.decode(encodedBytes);
// Continue passing stream chunks to the same decoder to preserve codec state.
decoder.free();
```

`kilobits_per_second` must be `16`, `24`, `32`, or `40`; `bit_order` must be `msb` or `lsb`. The caller must identify the stream rate and bit order from the Digifort media metadata before decoding. This wrapper does not parse RTP, container framing, or timestamps.

## Upstream

- Crate: [`oxideav-adpcm`](https://github.com/OxideAV/oxideav-adpcm)
- License: MIT (see the upstream repository's `LICENSE` file)
