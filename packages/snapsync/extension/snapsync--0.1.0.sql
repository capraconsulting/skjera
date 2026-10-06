-- snapsync 0.1.0: pull what changed in tables since a snapshot.
--
-- Every tracked row records the transaction that last wrote it, and deleted
-- rows leave a tombstone. A client keeps a token per table: the database it
-- pulled from, the table's generation, and the snapshot it pulled in, i.e.
-- which transactions it had seen. The next pull returns what was written or
-- deleted by transactions that snapshot hadn't seen, so transactions
-- committing out of order, or running long, are never missed (timestamps
-- and sequences can't promise that).
--
-- A token that can't be pulled from is answered with everything, to start
-- over: when tombstones it needed were pruned, when the table was truncated,
-- or when it comes from another database or cluster (after a restore,
-- transaction ids start over).

\echo Use "CREATE EXTENSION snapsync" to load this file. \quit

-- ---------------------------------------------------------------------------
-- State

-- The tables kept in sync.
CREATE TABLE snapsync.tables (
  relation regclass PRIMARY KEY,
  key_column name NOT NULL,
  xid_column name NOT NULL,
  -- Goes up when everyone has to start over: on a truncate, or a restore.
  -- Tokens carry it.
  generation integer NOT NULL DEFAULT 1,
  -- Tombstones written by transactions up to here are forgotten: tokens
  -- whose snapshot's xmin is at or before it start over.
  horizon xid8 NOT NULL DEFAULT '0'
);

-- Rows deleted from tracked tables (or whose key changed), by their key.
CREATE TABLE snapsync.tombstones (
  relation regclass NOT NULL,
  key text NOT NULL,
  xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tombstones_relation_xid_idx ON snapsync.tombstones (relation, xid);
CREATE INDEX tombstones_relation_key_idx ON snapsync.tombstones (relation, key);
CREATE INDEX tombstones_deleted_at_idx ON snapsync.tombstones (deleted_at);

-- One row: where the transaction ids in tracked tables were written. A
-- restore into another cluster or database brings them along; see
-- snapsync.ensure_current().
CREATE TABLE snapsync.state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  system_identifier bigint NOT NULL,
  database oid NOT NULL
);
INSERT INTO snapsync.state (system_identifier, database)
SELECT system_identifier, (SELECT oid FROM pg_database WHERE datname = current_database())
FROM pg_control_system();

-- Dumped with the database: a restore keeps what's tracked, and tells by
-- the state that it was restored.
SELECT pg_catalog.pg_extension_config_dump('snapsync.tables', '');
SELECT pg_catalog.pg_extension_config_dump('snapsync.tombstones', '');
SELECT pg_catalog.pg_extension_config_dump('snapsync.state', '');

-- ---------------------------------------------------------------------------
-- Tokens

-- Why a token can't be pulled from, or 'current' when it can.
CREATE TYPE snapsync.token_status AS ENUM (
  -- Pull what changed since.
  'current',
  -- No token: a first pull.
  'missing',
  -- Not a token.
  'malformed',
  -- From another cluster or database, e.g. before a restore.
  'elsewhere',
  -- From transactions this database hasn't had, e.g. before a restore.
  'ahead',
  -- From before the table was truncated, or the database restored.
  'restarted',
  -- Older than the tombstones kept.
  'pruned'
);

-- This database: the cluster's identifier and the database's oid.
CREATE FUNCTION snapsync.origin() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
RETURN (SELECT system_identifier FROM pg_control_system())::text || '/'
  || (SELECT oid FROM pg_database WHERE datname = current_database())::text;

-- The token for what this transaction sees of `relation`: pull with
-- REPEATABLE READ, and take it in the same transaction as the rows.
CREATE FUNCTION snapsync.token(relation regclass) RETURNS text
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  generation integer;
BEGIN
  SELECT t.generation INTO generation FROM snapsync.tables t
  WHERE t.relation = token.relation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'snapsync: % is not tracked', relation;
  END IF;
  RETURN '1/' || snapsync.origin() || '/' || generation || '/'
    || pg_current_snapshot()::text;
END
$$;

CREATE FUNCTION snapsync.status(token text, relation regclass)
RETURNS snapsync.token_status
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  parts text[];
  snapshot pg_snapshot;
  tracked record;
BEGIN
  SELECT t.generation, t.horizon INTO tracked FROM snapsync.tables t
  WHERE t.relation = status.relation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'snapsync: % is not tracked', relation;
  END IF;
  IF token IS NULL THEN
    RETURN 'missing';
  END IF;
  parts := regexp_match(token,
    '^1/(-?\d+/\d+)/(\d{1,9})/(\d+:\d+:(?:\d+(?:,\d+)*)?)$');
  IF parts IS NULL THEN
    RETURN 'malformed';
  END IF;
  IF parts[1] <> snapsync.origin() THEN
    RETURN 'elsewhere';
  END IF;
  BEGIN
    snapshot := parts[3]::pg_snapshot;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN 'malformed';
  END;
  IF pg_snapshot_xmax(snapshot) > pg_snapshot_xmax(pg_current_snapshot()) THEN
    RETURN 'ahead';
  END IF;
  IF parts[2]::integer <> tracked.generation THEN
    RETURN 'restarted';
  END IF;
  IF pg_snapshot_xmin(snapshot) <= tracked.horizon THEN
    RETURN 'pruned';
  END IF;
  RETURN 'current';
END
$$;

-- The snapshot to pull changes of `relation` since, or null to pull
-- everything.
CREATE FUNCTION snapsync.since(token text, relation regclass) RETURNS pg_snapshot
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog
RETURN CASE WHEN snapsync.status(token, relation) = 'current'
  THEN split_part(token, '/', 5)::pg_snapshot END;

-- Whether a row last written by transaction `xid` is new to a client that
-- had seen `since` (null: had seen nothing). Inlined into queries, so the
-- index on the xid column narrows the rows to those from `since`'s xmin on;
-- for that, pass `since` as a value (a parameter), not as a call to
-- snapsync.since().
CREATE FUNCTION snapsync.unseen(xid xid8, since pg_snapshot) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN since IS NULL
  OR (xid >= pg_snapshot_xmin(since) AND NOT pg_visible_in_snapshot(xid, since));

-- Keys of rows of `relation` deleted since `since`; none for a first pull.
-- Each reader sees only tombstones of tables they may read (a policy below).
CREATE FUNCTION snapsync.deleted(relation regclass, since pg_snapshot)
RETURNS SETOF text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT t.key FROM snapsync.tombstones t
  WHERE t.relation = $1
    AND $2 IS NOT NULL
    AND t.xid >= pg_snapshot_xmin($2)
    AND NOT pg_visible_in_snapshot(t.xid, $2)
$$;

-- ---------------------------------------------------------------------------
-- Tracking

-- Stamps rows with the transaction writing them. A row inserted with the key
-- of a deleted one is no longer deleted; a row whose key changed leaves a
-- tombstone for the old key. Arguments: the xid column, the key column.
CREATE FUNCTION snapsync.stamp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  new_key text;
  old_key text;
BEGIN
  EXECUTE format('SELECT ($1).%I::text', TG_ARGV[1]) USING NEW INTO new_key;
  IF TG_OP = 'INSERT' THEN
    DELETE FROM snapsync.tombstones WHERE relation = TG_RELID AND key = new_key;
  ELSE
    EXECUTE format('SELECT ($1).%I::text', TG_ARGV[1]) USING OLD INTO old_key;
    IF old_key IS DISTINCT FROM new_key THEN
      INSERT INTO snapsync.tombstones (relation, key) VALUES (TG_RELID, old_key);
      DELETE FROM snapsync.tombstones WHERE relation = TG_RELID AND key = new_key;
    END IF;
  END IF;
  NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], pg_current_xact_id()));
  RETURN NEW;
END
$$;

-- Leaves a tombstone for a deleted row. Argument: the key column.
CREATE FUNCTION snapsync.bury() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  old_key text;
BEGIN
  EXECUTE format('SELECT ($1).%I::text', TG_ARGV[0]) USING OLD INTO old_key;
  INSERT INTO snapsync.tombstones (relation, key) VALUES (TG_RELID, old_key);
  RETURN OLD;
END
$$;

-- A truncate leaves no tombstones: the table's clients start over.
CREATE FUNCTION snapsync.truncated() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE snapsync.tables SET generation = generation + 1 WHERE relation = TG_RELID;
  DELETE FROM snapsync.tombstones WHERE relation = TG_RELID;
  RETURN NULL;
END
$$;

-- Keeps `relation` in sync: adds `xid_column` (an xid8, indexed) unless it
-- exists, and the triggers that keep it and the tombstones. Its rows are new
-- to every client from then on.
CREATE FUNCTION snapsync.track(
  relation regclass,
  key_column name DEFAULT 'id',
  xid_column name DEFAULT 'xid'
) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  table_name name := (SELECT relname FROM pg_class WHERE oid = relation);
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_attribute
    WHERE attrelid = relation AND attname = key_column AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'snapsync: % has no column %', relation, key_column;
  END IF;
  IF NOT EXISTS (
    SELECT FROM pg_attribute
    WHERE attrelid = relation AND attname = xid_column AND NOT attisdropped
  ) THEN
    EXECUTE format(
      'ALTER TABLE %s ADD COLUMN %I xid8 NOT NULL DEFAULT pg_current_xact_id()',
      relation, xid_column);
  END IF;
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%I)',
    left(table_name || '_' || xid_column || '_snapsync_idx', 63), relation, xid_column);
  EXECUTE format(
    'CREATE TRIGGER snapsync_stamp BEFORE INSERT OR UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION snapsync.stamp(%L, %L)',
    relation, xid_column, key_column);
  EXECUTE format(
    'CREATE TRIGGER snapsync_bury AFTER DELETE ON %s
       FOR EACH ROW EXECUTE FUNCTION snapsync.bury(%L)',
    relation, key_column);
  EXECUTE format(
    'CREATE TRIGGER snapsync_truncated AFTER TRUNCATE ON %s
       FOR EACH STATEMENT EXECUTE FUNCTION snapsync.truncated()',
    relation);
  EXECUTE format('UPDATE %s SET %I = pg_current_xact_id()', relation, xid_column);
  INSERT INTO snapsync.tables (relation, key_column, xid_column)
  VALUES (relation, key_column, xid_column);
END
$$;

-- Stops keeping `relation` in sync. Its xid column stays.
CREATE FUNCTION snapsync.untrack(relation regclass) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS snapsync_stamp ON %s', relation);
  EXECUTE format('DROP TRIGGER IF EXISTS snapsync_bury ON %s', relation);
  EXECUTE format('DROP TRIGGER IF EXISTS snapsync_truncated ON %s', relation);
  DELETE FROM snapsync.tombstones t WHERE t.relation = untrack.relation;
  DELETE FROM snapsync.tables t WHERE t.relation = untrack.relation;
END
$$;

-- ---------------------------------------------------------------------------
-- Maintenance

-- Forgets tombstones older than `older_than`. A table's clients that last
-- pulled before the newest of its forgotten ones start over. (A snapshot's
-- xmin is the oldest transaction running anywhere in the cluster, so keep
-- tombstones longer than transactions run.) Returns how many were forgotten.
CREATE FUNCTION snapsync.prune(older_than interval) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  forgotten bigint;
BEGIN
  WITH gone AS (
    DELETE FROM snapsync.tombstones WHERE deleted_at < now() - older_than
    RETURNING relation, xid
  ),
  newest AS (
    SELECT relation, max(xid) AS xid FROM gone GROUP BY relation
  ),
  moved AS (
    UPDATE snapsync.tables t SET horizon = greatest(t.horizon, newest.xid)
    FROM newest WHERE t.relation = newest.relation
  )
  SELECT count(*) INTO forgotten FROM gone;
  RETURN forgotten;
END
$$;

-- After a restore into another cluster or database, transaction ids start
-- over, and those in tracked tables mean nothing here. Stamps every tracked
-- row anew, forgets the tombstones, and starts every table's clients over.
-- Call it when connecting, before pulls are served. Returns whether it had
-- to.
CREATE FUNCTION snapsync.ensure_current() RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  tracked record;
  here text := snapsync.origin();
BEGIN
  IF (SELECT system_identifier::text || '/' || database::text FROM snapsync.state) = here THEN
    RETURN false;
  END IF;
  -- One at a time, if several connect at once.
  LOCK TABLE snapsync.state IN EXCLUSIVE MODE;
  IF (SELECT system_identifier::text || '/' || database::text FROM snapsync.state) = here THEN
    RETURN false;
  END IF;
  FOR tracked IN SELECT * FROM snapsync.tables LOOP
    EXECUTE format('UPDATE %s SET %I = pg_current_xact_id()',
      tracked.relation, tracked.xid_column);
  END LOOP;
  DELETE FROM snapsync.tombstones;
  UPDATE snapsync.tables SET generation = generation + 1;
  UPDATE snapsync.state SET
    system_identifier = (SELECT system_identifier FROM pg_control_system()),
    database = (SELECT oid FROM pg_database WHERE datname = current_database());
  RETURN true;
END
$$;

-- ---------------------------------------------------------------------------
-- Privileges

-- Anyone may pull, seeing the deletes of the tables they may read; only the
-- owner tracks tables and maintains them.
GRANT USAGE ON SCHEMA snapsync TO PUBLIC;
GRANT SELECT ON snapsync.state, snapsync.tables TO PUBLIC;
GRANT SELECT ON snapsync.tombstones TO PUBLIC;
ALTER TABLE snapsync.tombstones ENABLE ROW LEVEL SECURITY;
CREATE POLICY readable ON snapsync.tombstones FOR SELECT
  USING (has_table_privilege(relation, 'SELECT'));
REVOKE EXECUTE ON FUNCTION
  snapsync.track(regclass, name, name),
  snapsync.untrack(regclass),
  snapsync.prune(interval),
  snapsync.ensure_current()
FROM PUBLIC;
