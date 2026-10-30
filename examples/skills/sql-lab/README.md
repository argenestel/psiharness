# SQL Lab

Practice SQLite SELECTs, joins, grouped reports, subqueries, ranking, and running totals against one seeded shop.
After 20 hours, aim for nine correct queries out of ten and complete the report quest and ledger boss.

## Use

1. Run `psi import-skill examples/skills/sql-lab` from the repository.
2. Open `psi web`, select SQL Lab in practice, or use `/skill` and `/practice` with the tutor.
3. Replace the SQL placeholder with one query. Inspect `setup` for the complete schema and seed rows.
   Prices are integers; all statuses count unless the prompt says paid. Each code challenge starts with a fresh database.
4. Try before opening hints. After a miss, name one correction and retry. Complete the build quest before the boss.

`expected` stores JSON row arrays as a string. Column order always matters; row order matters only when
`tests` contains `-- ordered`. The build quest combines multiple CTE stages in one final query.
SQL uses query placeholders rather than function stubs; the choice, number, and text drills use chat grading.
The revenue fixtures include price ties, an unsold product, cancelled/pending orders, and a customer with no orders.

## Challenge ids

- `ch-sql-names`
- `ch-sql-price-boundary`
- `ch-sql-paid-dates`
- `ch-sql-top-prices`
- `ch-sql-distinct-cities`
- `ch-sql-customer-orders`
- `ch-sql-never-ordered`
- `ch-sql-line-totals`
- `ch-sql-order-counts`
- `ch-sql-repeat-paid`
- `ch-sql-paid-revenue`
- `ch-sql-above-average`
- `ch-sql-no-paid`
- `ch-sql-bought-mug`
- `ch-sql-row-number`
- `ch-sql-price-rank`
- `ch-sql-running-quantity`
- `ch-sql-category-totals`
- `ch-sql-build-revenue-report`
- `ch-sql-boss-paid-ledger`
- `ch-sql-predict-count`
- `ch-sql-predict-rank`
- `ch-sql-paid-count`
- `ch-sql-group-filter`
