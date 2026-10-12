# LedgerDesk

Build an accessible, responsive expense dashboard in vanilla JavaScript and CSS. No dependencies. The eval runner serves `/` from public/index.html and also serves /public/* and /src/*. Use absolute module URLs. The runner owns the preview server; do not start servers, install packages, commit or push. Change only public/, src/, test/ and README.md.

Domain API in src/ledger.mjs; functions must not mutate their inputs:
- `migrate(data)`: null gives `{version:2,expenses:[]}`. v1 `{version:1,items:[{id,title,amount,category}]}` stores amount in dollars: convert to integer cents and preserve records. v2 uses `{version:2,expenses:[{id,title,amountCents,category}]}`. Reject corrupt/unsupported data, duplicate IDs, blank titles/categories and non-positive or non-safe integer cents. Trim titles/categories.
- `addExpense(state,{id,title,amountCents,category})`: validates and appends a record, rejecting duplicate IDs.
- `visibleExpenses(state,category)`: `all` returns all; other values match category exactly, preserving order.
- `totals(state)`: `{totalCents,byCategory}` with integer-cent totals; reject overflow.

UI contract:
- Heading LedgerDesk. Inputs labelled "Expense title", "Amount", "Category"; button "Add expense". Amount is dollars with at most two decimals, strictly positive. Reject blank, negative, NaN and over-precision values with role=alert.
- Select labelled "Filter category" with "All" plus current categories; each expense row has data-expense-id and displays title, category, formatted amount.
- Overall total element has data-testid="total". Include useful empty states and a clear visual hierarchy.
- localStorage key `ledgerdesk.state`. Migrate v1 data on load; malformed data shows an alert without destroying the stored value until the user explicitly saves valid data.

Add meaningful tests and run `npm test`. A later follow-up will add import/export; keep the model clean enough to support it.
