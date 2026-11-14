-- Per-user theme preference. NULL = never chosen (behaves like 'system'); a signed-out
-- visitor's localStorage choice is adopted on first sign-in while this is NULL.
alter table users add column theme_preference text check (theme_preference in ('light', 'dark', 'system'));
