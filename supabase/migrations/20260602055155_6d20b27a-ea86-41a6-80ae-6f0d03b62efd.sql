-- Public bucket for per-channel overlay logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('channel-logos', 'channel-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Read: anyone (public bucket, used in embeds + player overlay)
CREATE POLICY "channel-logos public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'channel-logos');

-- Write/update/delete: any authenticated user (owners manage their own channels;
-- we don't bind to user_id sub-paths because the user can choose any filename).
CREATE POLICY "channel-logos authenticated insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'channel-logos');

CREATE POLICY "channel-logos authenticated update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'channel-logos');

CREATE POLICY "channel-logos authenticated delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'channel-logos');