-- Temporary trip chat only. Runtime gets EXECUTE, never unrestricted DELETE privileges.
-- No records are removed by this migration itself.
CREATE INDEX idx_inbox_chat_booking ON public.inbox_notifications ((data->>'bookingId'))
  WHERE type = 'NEW_CHAT_MESSAGE';

CREATE FUNCTION public.purge_closed_chat_conversations(p_batch_size integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  closed_ids uuid[];
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'Invalid chat cleanup batch size' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(candidate.id) INTO closed_ids
  FROM (
    SELECT b.id
    FROM public.bookings b LEFT JOIN public.trips t ON t.booking_id = b.id
    WHERE (b.status IN ('COMPLETED', 'CANCELLED') OR t.status IN ('COMPLETED', 'CANCELLED'))
      AND (
        EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.booking_id = b.id)
        OR EXISTS (SELECT 1 FROM public.inbox_notifications n
          WHERE n.type = 'NEW_CHAT_MESSAGE' AND n.data->>'bookingId' = b.id::text)
      )
    ORDER BY b.id
    LIMIT p_batch_size
    FOR UPDATE OF b SKIP LOCKED
  ) candidate;

  IF closed_ids IS NULL THEN RETURN 0; END IF;

  DELETE FROM public.chat_messages WHERE booking_id = ANY(closed_ids);
  DELETE FROM public.inbox_notifications
    WHERE type = 'NEW_CHAT_MESSAGE'
      AND data->>'bookingId' = ANY(ARRAY(SELECT value::text FROM unnest(closed_ids) AS value));

  RETURN cardinality(closed_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_closed_chat_conversations(integer) FROM PUBLIC;
