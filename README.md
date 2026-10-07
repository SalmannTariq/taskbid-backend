# TaskBid API

## Why these rules live in the database

Five bidding and status rules are enforced in Postgres, not in the request handlers:

- A user cannot bid on their own task.
- A bid that would push the user over `max_capacity_hours` is rejected.
- A bid cannot be inserted after bidding is closed, or after the bid deadline.
- A task status can only move one step forward.
- One user can place only one bid on a task.

The database is the last place every write goes through. The API, a script, or a future client all hit the same trigger and the same unique index. Putting the rule only in `placeBid` would leave a direct `INSERT` able to break it. The capacity check also locks the user row inside the trigger, so two bids submitted at the same moment cannot both pass when only one of them fits.

`placeBid` still checks that the ids and hours are well formed, then inserts. Postgres raises the business-rule errors. The API turns those exception strings into 400 or 409 responses. Choosing who to assign when the deadline passes is still a query: it picks the lowest bid that currently fits. That is a decision, not a reject-on-insert rule.

## Trade-offs

The controller no longer shows the full rule. You have to read `migrations/004_create_audit_and_workload.sql` next to the TypeScript. Changing a rule means a new migration, which is slower than editing a function, and the API message has to stay in step with the `RAISE EXCEPTION` text. Triggers are also harder to see in a stack trace than a normal `if` in the controller. What you get back is one definition of the rule that still holds when the application code is bypassed.
