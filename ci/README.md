# CI workflows

These GitHub Actions workflows live here because the token used to push this repo lacks the `workflow` scope.
Enable them by moving them into place:

```bash
mkdir -p .github && git mv ci/workflows .github/workflows && git commit -m "Enable CI" && git push
```

- `ci.yml` — typecheck + tests on Node 22.
- `docker.yml` — builds and pushes `psi`, `psi-manim`, `psi-full` to `ghcr.io/<owner>/…`.
