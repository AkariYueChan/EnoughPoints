# Third-party notices

EnoughPoints' own source code is released under the MIT License in the repository root. The following Python libraries are redistributed in `vendor/` for offline local use. Their original metadata and license files are kept beside the vendored code under `vendor/*.dist-info/`.

| Package | Version | License | Required notice in this release |
| --- | ---: | --- | --- |
| openpyxl | 3.1.5 | MIT | `vendor/openpyxl-3.1.5.dist-info/LICENCE.rst` |
| et-xmlfile | 2.0.0 | MIT, with Python standard-library material under the PSF License | `vendor/et_xmlfile-2.0.0.dist-info/LICENCE.rst`, `LICENCE.python`, and `AUTHORS.txt` |
| xlrd | 2.0.2 | BSD-style; the upstream distribution contains two BSD notices | `vendor/xlrd-2.0.2.dist-info/LICENSE` |
| defusedxml | 0.7.1 | Python Software Foundation License 2.0 | `vendor/defusedxml-0.7.1.dist-info/LICENSE` |
| xlwt | 1.3.0 | BSD-style notices; some included historical material is LGPL-2.1 | `vendor/xlwt-1.3.0.dist-info/LICENSE.txt` |

`xlwt` is used only by the test suite to create temporary `.xls` fixtures. Its license file must travel with source distributions even when tests are not run. The xlwt license also identifies the LGPL-2.1 material and its upstream notice; that notice is retained verbatim.

The browser UI has no npm packages, JavaScript plugins, CDN assets, web fonts, analytics, or remote runtime dependencies. It uses browser APIs and the Python standard library. The GitHub Pages example under `docs/` is therefore a static copy of the sample planner and does not run the Python importer.

The package versions and wheel SHA-256 values are recorded in `DEPENDENCIES.md`. Before changing a vendored dependency, repeat the license and checksum review and update this file and `LICENSE_AUDIT.md`.
