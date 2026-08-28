## What

<!-- What does this change? One or two sentences. -->

## Why

<!-- The problem it solves, or the issue it closes (e.g. "Closes #12"). -->

## How it was verified

<!--
Be concrete. For example:
- `npm run build`, `npm run lint`, `npm run typecheck` all clean
- Clicked through: created a board, dragged a card between lists, reloaded
- For authorization changes: what you tried as a non-member/viewer that was
  correctly refused
-->

- [ ] `npm run build` passes
- [ ] `npm run lint` and `npm run typecheck` are clean
- [ ] Any new server action / MCP tool goes through an `authorize()` helper
- [ ] Any schema change is an **additive** migration, generated and committed
