"use client";

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
 return <div className={`skeleton ${className}`} style={style} />;
}

/** Home screen loading skeleton */
export function HomeSkeleton() {
 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-24">
 {/* Header */}
 <div className="px-5 pt-14 pb-4">
 <div className="flex justify-between items-center">
 <div>
 <Skeleton className="w-24 h-4 mb-2" />
 <Skeleton className="w-40 h-7" />
 </div>
 <div className="flex gap-2">
 <Skeleton className="w-10 h-10 !rounded-[14px]" />
 <Skeleton className="w-11 h-11 !rounded-[14px]" />
 </div>
 </div>
 </div>

 {/* Search */}
 <div className="px-5">
 <Skeleton className="w-full h-12 !rounded-[14px]" />
 </div>

 {/* Voice Profiles */}
 <div className="px-5 pt-5">
 <Skeleton className="w-20 h-5 mb-3" />
 <div className="flex gap-3.5">
 {[...Array(4)].map((_, i) => (
 <div key={i} className="shrink-0 flex flex-col items-center gap-1.5">
 <Skeleton className="w-14 h-14 !rounded-[18px]" />
 <Skeleton className="w-10 h-3" />
 </div>
 ))}
 </div>
 </div>

 {/* Quick actions */}
 <div className="px-5 pt-5 grid grid-cols-2 gap-2.5">
 {[...Array(4)].map((_, i) => (
 <Skeleton key={i} className="h-14 !rounded-2xl" />
 ))}
 </div>

 {/* Stories */}
 <div className="px-5 pt-5">
 <Skeleton className="w-28 h-5 mb-3" />
 <div className="flex gap-3">
 {[...Array(3)].map((_, i) => (
 <div key={i} className="shrink-0 w-36">
 <Skeleton className="w-36 h-24 !rounded-2xl mb-1.5" />
 <Skeleton className="w-28 h-4 mb-1" />
 <Skeleton className="w-20 h-3" />
 </div>
 ))}
 </div>
 </div>
 </div>
 );
}

/** Library grid skeleton */
export function LibrarySkeleton() {
 return (
 <div className="grid grid-cols-2 gap-2.5 px-5 pt-2">
 {[...Array(6)].map((_, i) => (
 <div key={i} className="bg-white dark:bg-white/5 rounded-2xl overflow-hidden">
 <Skeleton className="h-[90px] !rounded-none !rounded-t-2xl" />
 <div className="p-3 pb-3.5">
 <Skeleton className="w-3/4 h-4 mb-1.5" />
 <Skeleton className="w-1/2 h-3 mb-1.5" />
 <Skeleton className="w-12 h-4 !rounded-md" />
 </div>
 </div>
 ))}
 </div>
 );
}
