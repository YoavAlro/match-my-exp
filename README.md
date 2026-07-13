# Match My Exp

Match My Exp is a local-first Chrome extension for adapting website interfaces
to personal visual, cognitive, and assistive needs.

The product is currently in its foundation phase. See
[`docs/product/vision.md`](docs/product/vision.md) for the product boundary and
[`docs/planning/roadmap.md`](docs/planning/roadmap.md) for delivery status.

## Development

Requirements:

- Node.js 22
- npm 11

```bash
npm install
npm run dev
```

Run all local checks:

```bash
npm run check
```

The check suite validates formatting, Markdown and source linting, strict types,
unit-test coverage, the production extension build, and production dependency
advisories.
