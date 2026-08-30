# Changelog

## [0.4.1](https://github.com/odata2ts/test-server-cap/compare/v0.4.0...v0.4.1) (2026-08-30)


### Bug Fixes

* stop emitting Core.AlternateKeys, since routing can't back it ([a3eff7a](https://github.com/odata2ts/test-server-cap/commit/a3eff7a454c7317bee823223b3b944bcd61a9836))

## [0.4.0](https://github.com/odata2ts/test-server-cap/compare/v0.3.0...v0.4.0) (2026-08-20)


### Features

* mark Audiobook.Chapters as contained ([9438e09](https://github.com/odata2ts/test-server-cap/commit/9438e0994c62de304a1875fafbd422afa76c0e2a))

## [0.3.0](https://github.com/odata2ts/test-server-cap/compare/v0.2.0...v0.3.0) (2026-08-20)


### Features

* replay the request collection in CI, and cover V2 and deep insert ([#38](https://github.com/odata2ts/test-server-cap/issues/38)) ([4293263](https://github.com/odata2ts/test-server-cap/commit/42932631788a722cff0f3f3a20f5310629cd29dc))

## [0.2.0](https://github.com/odata2ts/test-server-cap/compare/v0.1.0...v0.2.0) (2026-08-20)


### Features

* let the client assign the Branch key ([63ef46e](https://github.com/odata2ts/test-server-cap/commit/63ef46ed825e35fa570a3ed6173ce3857d0d16b6))

## 0.1.0 (2026-08-19)


### Features

* annotate Loan.LoanedAt as Core.Immutable ([3c78f48](https://github.com/odata2ts/test-server-cap/commit/3c78f48849c5ff8d2d478ef7b167d6d794f2be3b))
* annotate Member.ActiveSince and Member.Balance ([0d4a24c](https://github.com/odata2ts/test-server-cap/commit/0d4a24cf167ffa681792c5a6459f2dad273d8798))
* annotate the server-generated Integer keys as Core.ComputedDefaultValue ([f8ddbb6](https://github.com/odata2ts/test-server-cap/commit/f8ddbb6aaab5112f69d8e40b1a4334e068f65c7c))
* CAP implementation of the Library OData V4 test model ([23b5477](https://github.com/odata2ts/test-server-cap/commit/23b5477224b7bbc1be2aa1a92581504ae08dc09b))
* enable V2 support by adding the adapter ([#7](https://github.com/odata2ts/test-server-cap/issues/7)) ([c7b6d60](https://github.com/odata2ts/test-server-cap/commit/c7b6d60eea65bc67849d995322477a254348a476))
* model the id document as a composition ([#5](https://github.com/odata2ts/test-server-cap/issues/5)) ([1ff3275](https://github.com/odata2ts/test-server-cap/commit/1ff3275a7e472a1e7be97b838ed9af79fa23a77d))
* publish the test server as a container image ([#2](https://github.com/odata2ts/test-server-cap/issues/2)) ([37841b8](https://github.com/odata2ts/test-server-cap/commit/37841b8d96e902db65ec6c176a6e4f5a79daa18f))


### Bug Fixes

* generate the integer keys this model declares plain ([#6](https://github.com/odata2ts/test-server-cap/issues/6)) ([bd6bcab](https://github.com/odata2ts/test-server-cap/commit/bd6bcabb7039b1ef9fa400dc336e8c9cb81a3adc))
