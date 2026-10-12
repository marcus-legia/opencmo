-- The editor Assistant and the CMO drafting agents move from Opus to Claude Sonnet 5.5 to cut cost.
-- Without a Sonnet row its usage would fall to `default`, which is not `allowed` (no session could
-- start) and is charged at Opus prices. Anthropic list price, micro-USD per token (= USD per
-- million tokens): $2 in / $10 out, cache read $0.20, cache write 1.25x.
-- Credits per micro-USD (`agent_credits`) are unchanged.

begin;

insert into public.agent_model_prices (pattern, priority, input, output, cache_read, cache_write, allowed, note) values
  ('claude-sonnet-5%', 9, 2, 10, 0.2, 2.5, true, 'Claude Sonnet 5.5 list price.');

commit;
