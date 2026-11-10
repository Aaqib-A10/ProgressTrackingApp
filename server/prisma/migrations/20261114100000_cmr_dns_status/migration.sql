-- CMR: a "DNS" (do not solicit) closing status. Businesses that saved their own list of
-- statuses get it added after "Not a Fit" (or at the end); the default list has it in code.
UPDATE "LeadBusiness" b
SET "pipeline" = (
  SELECT jsonb_agg(x.elem ORDER BY x.ord)
  FROM (
    SELECT e.elem, e.ord::numeric AS ord FROM jsonb_array_elements(b."pipeline") WITH ORDINALITY AS e(elem, ord)
    UNION ALL
    SELECT '{"key":"DNS","label":"DNS","color":"#475569","open":false}'::jsonb,
           COALESCE((SELECT e2.ord::numeric + 0.5 FROM jsonb_array_elements(b."pipeline") WITH ORDINALITY AS e2(elem, ord) WHERE e2.elem->>'key' = 'NOT_A_FIT' LIMIT 1), 1000)
  ) x
)
WHERE b."kind" = 'CMR'
  AND jsonb_typeof(b."pipeline") = 'array'
  AND jsonb_array_length(b."pipeline") > 0
  AND jsonb_array_length(b."pipeline") < 20
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b."pipeline") AS e3(elem) WHERE e3.elem->>'key' = 'DNS');
