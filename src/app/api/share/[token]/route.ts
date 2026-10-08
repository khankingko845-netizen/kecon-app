import { SHARE_HEADERS } from "@/lib/story-links";
/** Legacy unlimited links remain closed. Never restore broad share-table SELECT. */
export async function GET() {
  return Response.json(
    {
      error: "Link cũ đã ngừng dùng. Bố mẹ tạo link mới cho truyện công khai.",
    },
    { status: 410, headers: SHARE_HEADERS },
  );
}
