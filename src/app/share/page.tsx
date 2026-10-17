import type { Metadata } from "next";
import SharedStoryReader from "./reader";
export const metadata: Metadata = {
  title: "Đọc truyện chia sẻ — KểCon",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function SharedStoryPage() {
  return <SharedStoryReader />;
}
