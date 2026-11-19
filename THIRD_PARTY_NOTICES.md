# Third-party notices

## DFreds Module Template TS

This project adapts selected ideas and implementation patterns from [DFreds Module Template TS](https://github.com/DFreds/dfreds-module-template-ts), by Derek Fredrickson.

The upstream project is distributed under the MIT License, copyright (c) 2025 Derek Fredrickson. Its complete notice is retained in [LICENSE](LICENSE), which is included in every release package.

The local adaptation uses JavaScript, a unified source directory, an independent packaging implementation, and a documented manual process for comparing upstream source files. See [wiki/upstream.md](wiki/upstream.md).

## libWrapper compatibility shim

The compatibility shim in src/scripts/lib/libwrapper-shim.js is adapted from the upstream template's static/lib/shim.ts.

SPDX-License-Identifier: MIT

Copyright © 2021 fvtt-lib-wrapper Rui Pinheiro

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Pin Cushion formatting conventions

The Prettier configuration carries over the author's settings from [Pin Cushion's .prettierrc.json](https://github.com/p4535992/foundryvtt-pin-cushion/blob/master/.prettierrc.json), with additional JavaScript and YAML filename patterns. EditorConfig and ignore paths are adapted to this project's layout.

## Packaging requirements

The release layout follows the requested Pin Cushion behavior: a ZIP containing the module id directory, plus a separately attached manifest with a version-specific download URL. The packaging code here is an original implementation of those requirements. Pin Cushion runtime code and dependencies are not included.

Development dependencies retain their respective licenses. Review their notices when adding dependencies that are bundled into a distributed module.
