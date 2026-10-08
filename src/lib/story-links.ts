import { z } from "zod";
export const shareToken = z.string().regex(/^[a-f0-9]{64}$/);
export const IssuedStoryLink = z
  .object({
    id: z.uuid(),
    story_id: z.uuid(),
    share_token: shareToken,
    expires_at: z.iso.datetime({ offset: true }),
    is_active: z.boolean(),
    view_count: z.number().int().nonnegative(),
  })
  .strict();
export const StoryLinkMetadata = IssuedStoryLink.omit({
  story_id: true,
  share_token: true,
});
export const SharedStoryText = z
  .object({
    story: z
      .object({
        id: z.uuid(),
        title: z.string().max(500),
        description: z.string().max(10000).nullable(),
      })
      .strict(),
    pages: z
      .array(
        z
          .object({
            page_number: z.number().int(),
            content: z.string().max(10000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const SHARE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  Vary: "Cookie",
};
export function storyLinkUrl(origin: string, token: string) {
  return `${origin}/share#${shareToken.parse(token)}`;
}
