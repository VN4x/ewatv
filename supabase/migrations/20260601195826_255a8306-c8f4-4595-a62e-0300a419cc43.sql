
-- 1. Add fallback YouTube URL on channels
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS fallback_youtube_url text
  DEFAULT 'https://www.youtube.com/@estonianwitchesassociation/videos';

-- 2. Public read on channels (slug-based lookup for embeddable viewer)
GRANT SELECT ON public.channels TO anon;
DROP POLICY IF EXISTS "public read channels" ON public.channels;
CREATE POLICY "public read channels"
  ON public.channels FOR SELECT
  TO anon, authenticated
  USING (true);

-- 3. Public read on schedules + schedule_items + videos (only what viewer needs)
GRANT SELECT ON public.schedules TO anon;
DROP POLICY IF EXISTS "public read schedules" ON public.schedules;
CREATE POLICY "public read schedules"
  ON public.schedules FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.schedule_items TO anon;
DROP POLICY IF EXISTS "public read schedule_items" ON public.schedule_items;
CREATE POLICY "public read schedule_items"
  ON public.schedule_items FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.videos TO anon;
DROP POLICY IF EXISTS "public read videos" ON public.videos;
CREATE POLICY "public read videos"
  ON public.videos FOR SELECT
  TO anon, authenticated
  USING (true);
