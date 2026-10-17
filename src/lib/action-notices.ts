/** User-triggered outcomes only: no background fetch/prefetch notification interception. */
export type NoticeType = "success" | "error" | "info" | "loading";
export interface Notice {id:string; type:NoticeType; message:string; duration?:number}
export const MAX_NOTICES = 3;
export function noticeDuration(type:NoticeType, duration?:number):number {
 return duration ?? (type === "loading" ? 0 : type === "error" ? 7000 : 4500);
}
/** Bound and deduplicate active messages; React text rendering (never raw HTML). */
export function enqueueNotice<T extends Notice>(queue:T[], incoming:T):T[] {
 return [...queue.filter(n => n.id!==incoming.id && !(n.type===incoming.type && n.message===incoming.message)),incoming].slice(-MAX_NOTICES);
}
