CREATE TABLE bids (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  hours_offered NUMERIC(6, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bids_hours_positive CHECK (hours_offered > 0),
  CONSTRAINT bids_one_per_user_per_task UNIQUE (task_id, user_id)
);

CREATE INDEX bids_task_id_idx ON bids (task_id);
CREATE INDEX bids_user_id_idx ON bids (user_id);

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
