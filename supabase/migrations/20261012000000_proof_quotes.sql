-- Tee-sign proofs now carry the TD's own speech-bubble text per hole (q1..q20, up to 140 characters each,
-- cleaned by cleanQuote in src/lib/proofs/proofs.ts) inside design_assets.proof_opts.
-- The size cap on proof_opts goes from 500 to 6000 characters; it must still be a JSON object.
alter table public.design_assets drop constraint if exists design_assets_proof_opts_check;
alter table public.design_assets add constraint design_assets_proof_opts_check
  check (jsonb_typeof(proof_opts) = 'object' and length(proof_opts::text) <= 6000);
