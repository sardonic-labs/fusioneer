# REVIEW.md — per-type review guidance (injected via instructions)

- Check `PLAN.md` exists and matches diff.
- Verify `verify` command passes (`bun run check` or `python fiducial/scripts/fiducial.py lint/erc/check-intent`).
- For hardware repos: lint/erc clean, intent.csv coverage, no hallucinated ports.
- Single concern, branch `fusioneer/<type>-<slug>-#<issue>`, PR body `Closes #`.
