# Release notes

One file per version, named after its tag (`v1.0.0.md`). The release workflow
refuses to build a tag without its notes.

- The first paragraph (not a heading) is the short summary shown in the app's
  update prompt (`latest.json`).
- The rest is the body of the GitHub release. The workflow appends the
  download list and the SHA-256 checksums itself.
