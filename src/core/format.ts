import type { FinchTweet } from "./transport";

export function formatPosts(posts: FinchTweet[]): string {
  if (posts.length === 0) return "(no posts)";
  return posts.map((p) => `${p.id}  ${p.text}`).join("\n");
}
