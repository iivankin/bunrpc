# Changelog

## 0.1.15

- Keep the wrapped `mutate` and `mutateAsync` references stable across React
  rerenders.
- Cache route proxies so procedure helpers and inputless query keys retain
  stable references.
- Verify that consumer rerenders do not cause duplicate query requests.
- Publish releases through npm trusted publishing with provenance.
