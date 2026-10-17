-- Claude Sonnet 5.5 cache reads cost $0.10 per million tokens since 2026-10-07 (Claude Platform
-- release notes; was $0.20 when 20261119090000_sonnet_price.sql was written), so cache reads were
-- charged at twice their cost. Input, output and cache write are unchanged.

update public.agent_model_prices
set cache_read = 0.1, note = 'Claude Sonnet 5.5 list price (cache read $0.10 since 2026-10-07).'
where pattern = 'claude-sonnet-5%';
