# Algorithms and Big-O

Practice the small set of patterns that make algorithmic problems predictable: estimate growth, maintain pointer and search invariants, choose hash-map or stack/queue state, and traverse or sort data deliberately.

## Target performance

Within 20 focused hours, solve at least 18 of the 22 challenges in 30-minute timed rounds with at least 80% first-try success. For each code task, state time and extra-space complexity and name the empty, boundary, duplicate, or disconnected cases you tested.

## Subskill map

- `complexity-analysis` — Read complexity from loops; priority 1; prerequisites: none.
- `two-pointers` — Shrink and advance two pointers; priority 1; prerequisites: `complexity-analysis`.
- `binary-search` — Maintain a binary-search window; priority 1; prerequisites: `complexity-analysis`.
- `hash-maps` — Use hash maps for constant-time lookups; priority 1; prerequisites: `complexity-analysis`.
- `stacks-queues` — Choose LIFO or FIFO state; priority 2; prerequisites: `complexity-analysis`.
- `sorting` — Order data with a deliberate cost; priority 2; prerequisites: `complexity-analysis`, `hash-maps`.
- `graph-traversal` — Traverse graphs with BFS and DFS; priority 3; prerequisites: `hash-maps`, `stacks-queues`.

## How to start

1. `psi import-skill examples/skills/algorithms-big-o`
2. `/skill`
3. `/practice`

Attempt before opening hints. After a miss, write one invariant or edge-case lesson and retry the same pattern with a changed input. The build quest combines linear and binary search; the boss combines merge sort, deterministic tie-breaking, and complexity explanation. Failures still earn progress.

Choice answers are normalized against the listed choices. Number answers are stored as strings and graded numerically; the open graph explanation is tutor-graded against its rubric. Code tasks use Python and include a docstring stub, assertions, and edge cases.

## Challenge IDs

### Complexity analysis

- `ch-complexity-analysis-1`
- `ch-complexity-analysis-2` (build quest)
- `ch-complexity-analysis-3`
- `ch-complexity-analysis-4`

### Two pointers

- `ch-two-pointers-1`
- `ch-two-pointers-2`
- `ch-two-pointers-3`

### Binary search

- `ch-binary-search-1`
- `ch-binary-search-2`
- `ch-binary-search-3`

### Hash maps

- `ch-hash-maps-1`
- `ch-hash-maps-2`
- `ch-hash-maps-3`

### Stacks and queues

- `ch-stacks-queues-1`
- `ch-stacks-queues-2`

### Graph traversal

- `ch-graph-traversal-1`
- `ch-graph-traversal-2`
- `ch-graph-traversal-3`

### Sorting

- `ch-sorting-1` (boss)
- `ch-sorting-2`
- `ch-sorting-3`
- `ch-sorting-4`

