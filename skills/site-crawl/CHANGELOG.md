# Changelog — site-crawl

## 1.0.0 — 2026-07-14
- Initial release. Thin Path-1 wrapper over the crawl4ai venv for bounded, polite,
  domain-locked best-first deep crawls.
- Authored from a real tracer-bullet run (not a desk spec): the eval's four `[verify]`
  items were proven by hand end-to-end before authoring — install/Playwright on
  Windows, best-first link-scoring, `fit_markdown` noise-filter, robots+politeness.
  See `examples/deep-crawl-docs-site.md` (the trace, which is also the regression
  fixture) and *eval crawl4ai* (the decision).
- `hitl_gate: confirm` — confirms target + page cap before crawling a domain the user
  does not own (deep crawl hits a third-party server harder than a single fetch).
- Defaults chosen for politeness: domain-lock, max-pages 15, max-depth 2, delay 1.0s,
  concurrency 2, robots respected. `--ignore-robots` gated to owned domains only.
