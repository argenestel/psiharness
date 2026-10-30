# Linear transformations

A linear transformation moves the whole plane at once. The origin stays put, and grid lines stay straight, parallel and evenly spaced. Because of that rule, you only need to know where two arrows, î and ĵ, land. Every other arrow is a fixed combination of them, so it follows automatically. A matrix is a record of those two landing spots. Matrix multiplication chains two motions. The determinant is the factor by which areas scale, and eigenvectors are the directions that do not turn.

## The aha path

- Watch a rubber grid deform. The origin stays fixed and lines stay straight and evenly spaced, while translations and bends break the rules.
- Treat vectors as moves, and a basis as a pair of measuring sticks.
- Use linearity: transform a combination by combining the transformed ingredients.
- Read the matrix columns as the landing spots of î and ĵ. Multiplying a matrix by a vector means combining its columns.
- Chain two maps (the right-hand map acts first). Then measure signed area (the determinant), undo the map (the inverse), and find directions that do not turn (eigenvectors).
- Change the measuring sticks: the coordinates change, the arrow does not.

## Concepts

- `linear-map-grid-squish`: A grid can move as one coherent object (hook)
- `vectors`: Vectors are reusable moves
- `basis`: A basis is a pair of coordinate directions
- `linear-maps`: Linearity preserves combinations
- `matrix-columns`: Matrix columns are transformed basis vectors
- `composition`: Composition chains transformations
- `determinant`: The determinant measures signed area scaling
- `inverse`: An inverse map rewinds the motion
- `eigenvectors`: Eigenvectors keep their direction
- `change-of-basis`: Changing basis changes the coordinates, not the vector

There are 40 retrieval cards, four per concept, split evenly between recall, predict, explain and multiple choice. Every lesson's `checks` lists that concept's four card ids.

## Watch

`storyboards/linear-map-grid-squish.json` is "The plane as a rubber grid": seven 3b1b-style scenes, about 71 seconds in total. Every scene uses the same matrix, A = [[2, −1], [1, 1]].

1. The plane as a grid, with î and ĵ.
2. The whole grid moves under A, with the origin pinned.
3. Only î → (2, 1) and ĵ → (−1, 1) are tracked.
4. v = (1, 2) lands on 1·(2, 1) + 2·(−1, 1) = (0, 3).
5. The two landing spots, written as columns, make the matrix.
6. Non-examples: a translation moves the origin, and bending curves the lines.
7. The unit square becomes a parallelogram of area 3 = det A, a preview of the determinant lesson.

Render it with `psi render examples/topics/linear-transformations/storyboards/linear-map-grid-squish.json -o rubber-grid.html`.

Only the hook lesson has a finished storyboard. Later lessons list their storyboards with no `path`, which means they are planned but not yet made.

## Explore

`explorables/linear-map-lab.json` uses the `linear-transform` template. It has exactly the four sliders `a, b, c, d`, for the matrix [[a, b], [c, d]], and starts at the storyboard's matrix. `showDeterminant` and `showEigen` are on, and `vectors: [[1, 2]]` draws the image of (1, 2) in yellow.

- The green î arrow is column (a, c), and the red ĵ arrow is column (b, d).
- The shaded parallelogram is the image of the unit square.
- The status panel shows det(A). When real eigenvalues exist it lists them and draws their eigen-lines dashed; otherwise it says there are none.

The prompts walk through:

- collapse: d = −0.5 gives det = 0
- a flip: d = −1 gives det = −1
- a shear, which has one eigen-line with λ = 1
- a quarter-turn, which has no real eigenvectors

The lab cannot compose two maps or change basis, so the composition and change-of-basis lessons have no explorable `path`.

## Import

```sh
psi import examples/topics/linear-transformations
```
