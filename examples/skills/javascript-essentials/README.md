# JavaScript essentials

Build a reliable core of modern JavaScript: bindings and types, array pipelines, object composition,
closures, deterministic Promise composition, and small classes.

## Target performance

After 20 focused hours, solve at least 18 of 22 tasks in 35 minutes. The target set includes map/filter/reduce,
immutable object updates, a closure, sequential and concurrent Promise flows, a multi-function task-board quest,
and a final class-based boss. Code tasks run locally in a sandbox: they use no DOM, network, timers, Node imports,
or external packages.

## Subskill map

- `let-const-types` — Bindings and value types; priority 1; prerequisites: none.
- `arrays-map-filter-reduce` — Transform arrays; priority 1; prerequisites: `let-const-types`.
- `objects-destructuring` — Compose objects and destructure safely; priority 1; prerequisites: `let-const-types`, `arrays-map-filter-reduce`.
- `closures` — Use closures for private state; priority 2; prerequisites: `let-const-types`, `arrays-map-filter-reduce`.
- `async-promises` — Compose asynchronous results; priority 2; prerequisites: `arrays-map-filter-reduce`, `objects-destructuring`, `closures`.
- `classes` — Model behavior with classes; priority 2; prerequisites: `objects-destructuring`, `closures`.

## How to start

1. `psi import-skill examples/skills/javascript-essentials`
2. `/skill`
3. `/practice`

Attempt before opening hints. After a miss, write one specific lesson and retry with a changed assumption. The
build quest combines closures, arrays, objects, and class-like state; the boss is the final stretch task.

## Challenge IDs

- `ch-let-const-types-1` — label null and JavaScript types (code)
- `ch-let-const-types-2` — predict const object mutation (choice)
- `ch-let-const-types-3` — copy and update settings (code)
- `ch-let-const-types-4` — predict block scope (number)
- `ch-arrays-map-filter-reduce-1` — double numbers with map (code)
- `ch-arrays-map-filter-reduce-2` — filter words by length (code)
- `ch-arrays-map-filter-reduce-3` — sum positive values with reduce (code)
- `ch-arrays-map-filter-reduce-4` — predict a filter/map pipeline (choice)
- `ch-objects-destructuring-1` — format a name with a default (code)
- `ch-objects-destructuring-2` — merge an immutable profile patch (code)
- `ch-objects-destructuring-3` — predict nested destructuring (choice)
- `ch-closures-1` — make an independent multiplier (code)
- `ch-closures-2` — cache a once-only function result (code)
- `ch-closures-3` — predict let-loop closures (choice)
- `ch-async-promises-1` — resolve an uppercase value (code)
- `ch-async-promises-2` — run Promise tasks in order (code)
- `ch-async-promises-3` — summarize fulfilled and rejected tasks (code)
- `ch-classes-1` — create an independent counter class (code)
- `ch-classes-2` — create an inventory class (code)
- `ch-classes-3` — predict class constructor state (choice)
- `ch-classes-build-task-board` — build a closure-backed task board (build/code)
- `ch-boss-javascript-essentials` — sort and encapsulate a scoreboard (boss/code)

The non-code set includes choice, number, and text formats. Numeric expected answers are strings to match the
`Challenge.expected` contract. Code references and the validation
log are kept outside the package's shipped files.
