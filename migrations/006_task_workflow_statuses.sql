ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN (
    'draft',
    'open',
    'bidding_closed',
    'assigned',
    'in_progress',
    'review',
    'done',
    'completed',
    'cancelled'
  ));

CREATE OR REPLACE FUNCTION prevent_invalid_task_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'draft' AND NEW.status = 'open') OR
    (OLD.status = 'open' AND NEW.status = 'bidding_closed') OR
    (OLD.status = 'bidding_closed' AND NEW.status = 'assigned') OR
    (OLD.status = 'assigned' AND NEW.status = 'in_progress') OR
    (OLD.status = 'in_progress' AND NEW.status = 'review') OR
    (OLD.status = 'review' AND NEW.status = 'done')
  ) THEN
    RAISE EXCEPTION 'invalid task status transition from % to %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_invalid_bid_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  capacity NUMERIC(6, 2);
  used_hours NUMERIC(6, 2);
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' OR NEW.status NOT IN ('accepted', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'invalid bid status transition from % to %', OLD.status, NEW.status;
  END IF;

  IF NEW.status = 'accepted' THEN
    SELECT max_capacity_hours INTO capacity
    FROM users
    WHERE id = NEW.user_id;

    SELECT COALESCE(SUM(b.hours_offered), 0) INTO used_hours
    FROM bids b
    JOIN tasks t ON t.id = b.task_id
    WHERE b.user_id = NEW.user_id
      AND b.id <> NEW.id
      AND b.status = 'accepted'
      AND t.status IN ('assigned', 'in_progress', 'review');

    IF used_hours + NEW.hours_offered > capacity THEN
      RAISE EXCEPTION 'accepting this bid would exceed the user max capacity';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW user_workloads AS
SELECT
  u.id AS user_id,
  u.name,
  u.email,
  u.hourly_rate,
  u.max_capacity_hours,
  COALESCE(SUM(b.hours_offered) FILTER (
    WHERE b.status = 'accepted' AND t.status IN ('assigned', 'in_progress', 'review')
  ), 0) AS current_workload
FROM users u
LEFT JOIN bids b ON b.user_id = u.id
LEFT JOIN tasks t ON t.id = b.task_id
GROUP BY u.id;
