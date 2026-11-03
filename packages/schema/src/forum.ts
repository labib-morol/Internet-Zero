import { z } from "zod";
import { Id, IsoTime } from "./primitives.js";

/** GHOSTBOARD source (§10.7): boards, threads, posts with edits/tombstones. */
export const ForumPostEdit = z.strictObject({ at: IsoTime, body: z.string() });
export type ForumPostEdit = z.infer<typeof ForumPostEdit>;

export const ForumPost = z.strictObject({
  id: Id,
  author: Id,
  at: IsoTime,
  body: z.string(),
  edits: z.array(ForumPostEdit).default([]),
  deleted: z.boolean().default(false),
});
export type ForumPost = z.infer<typeof ForumPost>;

export const ForumThread = z.strictObject({
  id: Id,
  title: z.string().min(1),
  pinned: z.boolean().default(false),
  posts: z.array(ForumPost).min(1),
});
export type ForumThread = z.infer<typeof ForumThread>;

export const ForumBoard = z.strictObject({
  id: Id,
  name: z.string().min(1),
  threads: z.array(ForumThread).default([]),
});
export type ForumBoard = z.infer<typeof ForumBoard>;

export const ForumSource = z.strictObject({ boards: z.array(ForumBoard).min(1) });
export type ForumSource = z.infer<typeof ForumSource>;
