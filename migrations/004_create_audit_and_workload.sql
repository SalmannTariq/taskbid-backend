CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  changed_by BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_log_entity_type_check CHECK (entity_type IN ('task', 'bid'))
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_changed_by_idx ON audit_log (changed_by);

CREATE VIEW user_workloads AS
SELECT
  u.id AS user_id,
  u.name,
  u.email,
  u.hourly_rate,
  u.max_capacity_hours,
  COALESCE(SUM(b.hours_offered) FILTER (
    WHERE t.assigned_to = u.id
      AND t.status IN ('assigned', 'in_progress', 'review')
  ), 0) AS current_workload
FROM users u
LEFT JOIN bids b ON b.user_id = u.id
LEFT JOIN tasks t ON t.id = b.task_id
GROUP BY u.id;

CREATE FUNCTION prevent_invalid_task_status_change()
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

CREATE TRIGGER tasks_status_transition
  BEFORE UPDATE OF status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION prevent_invalid_task_status_change();

CREATE FUNCTION log_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  actor_text TEXT;
  actor_id BIGINT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  actor_text := current_setting('app.user_id', true);

  IF actor_text IS NULL OR actor_text = '' THEN
    RAISE EXCEPTION 'set app.user_id before changing a task or bid status';
  END IF;

  actor_id := actor_text::BIGINT;

  INSERT INTO audit_log (
    entity_type,
    entity_id,
    changed_by,
    field_name,
    previous_value,
    new_value
  )
  VALUES (
    TG_ARGV[0],
    NEW.id,
    actor_id,
    'status',
    OLD.status,
    NEW.status
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_status_audit
  AFTER UPDATE OF status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_status_change('task');

CREATE FUNCTION prevent_invalid_bid_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  creator BIGINT;
  task_status TEXT;
  task_deadline TIMESTAMPTZ;
  capacity NUMERIC(6, 2);
  used_hours NUMERIC(6, 2);
  remaining NUMERIC(6, 2);
BEGIN
  SELECT created_by, status, deadline
  INTO creator, task_status, task_deadline
  FROM tasks
  WHERE id = NEW.task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  IF creator = NEW.user_id THEN
    RAISE EXCEPTION 'you cannot bid on your own task';
  END IF;

  IF task_status <> 'open' OR task_deadline <= NOW() THEN
    RAISE EXCEPTION 'bids can only be placed on an open task before the bid deadline';
  END IF;

  SELECT max_capacity_hours
  INTO capacity
  FROM users
  WHERE id = NEW.user_id
  FOR UPDATE;

  IF capacity IS NULL THEN
    RAISE EXCEPTION 'userId must be a user id';
  END IF;

  SELECT COALESCE(SUM(b.hours_offered), 0)
  INTO used_hours
  FROM bids b
  JOIN tasks t ON t.id = b.task_id
  WHERE b.user_id = NEW.user_id
    AND t.assigned_to = b.user_id
    AND t.status IN ('assigned', 'in_progress', 'review');

  remaining := capacity - used_hours;
  IF NEW.hours_offered > remaining THEN
    RAISE EXCEPTION 'hours offered exceed your remaining capacity of %', remaining;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bids_insert_rules
  BEFORE INSERT ON bids
  FOR EACH ROW
  EXECUTE FUNCTION prevent_invalid_bid_insert();
