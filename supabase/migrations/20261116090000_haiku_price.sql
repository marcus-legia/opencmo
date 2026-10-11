-- The check agents (checker, captions) and moment selection run on Claude Haiku, but the price
-- table had no Haiku row, so their usage fell to `default` and was charged at Opus prices (about
-- 50x Haiku 5.5). Anthropic list prices, micro-USD per token (= USD per million tokens):
--   Haiku 5.5  $0.10 in / $0.50 out, cache read 0.1x, cache write 1.25x (prompts up to 100K tokens)
--   Haiku 4.5  $1 in / $5 out
-- Credits per micro-USD (`agent_credits`) are unchanged.

begin;

insert into public.agent_model_prices (pattern, priority, input, output, cache_read, cache_write, allowed, note) values
  ('claude-haiku-5%', 11, 0.1, 0.5, 0.01, 0.125, true, 'Claude Haiku 5.5 list price.'),
  ('claude-haiku-4%', 12, 1, 5, 0.1, 1.25, true, 'Claude Haiku 4.5 list price.');

commit;
