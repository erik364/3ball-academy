-- Phase 2 of multi-parent support — invite consumption.
--
-- A consuming parent has just signed up and isn't the inviter, so RLS would
-- block them from updating parent_invites or inserting into parent_players.
-- SECURITY DEFINER lets the function bypass RLS while the validation logic
-- inside enforces correctness (existence, single-use, expiry, no self-claim).
--
-- The function is granted to both authenticated (post-signup, just-logged-in
-- parents calling consume) and anon (defensive: invalid token → not_found).
-- A fake token call simply returns success=false; no information leak.

create or replace function public.consume_parent_invite(
  p_token text,
  p_consuming_parent_id uuid
)
returns table (
  success boolean,
  error_code text,
  player_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.parent_invites%rowtype;
begin
  select * into v_invite
    from public.parent_invites
    where token = p_token
    for update;

  if not found then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;

  if v_invite.used_at is not null then
    return query select false, 'already_used'::text, null::uuid;
    return;
  end if;

  if v_invite.expires_at < now() then
    return query select false, 'expired'::text, null::uuid;
    return;
  end if;

  if v_invite.inviting_parent_id = p_consuming_parent_id then
    return query select false, 'self_claim'::text, null::uuid;
    return;
  end if;

  -- The inviter is the primary parent (Phase 1 backfill); new linkages are
  -- non-primary. The Phase 1 partial unique index enforces at most one
  -- primary per player.
  insert into public.parent_players (parent_id, player_id, is_primary)
  values (p_consuming_parent_id, v_invite.player_id, false)
  on conflict (parent_id, player_id) do nothing;

  update public.parent_invites
    set used_at = now(),
        consumed_by_parent_id = p_consuming_parent_id
    where id = v_invite.id;

  return query select true, null::text, v_invite.player_id;
end;
$$;

grant execute on function public.consume_parent_invite(text, uuid)
  to authenticated, anon;
