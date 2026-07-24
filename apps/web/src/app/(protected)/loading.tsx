export default function ProtectedLoading() {
  return (
    <div aria-busy="true" aria-label="Đang tải nội dung" className="animate-pulse">
      <div className="h-3 w-32 rounded bg-slate-200" />
      <div className="mt-3 h-9 w-72 max-w-full rounded-lg bg-slate-200" />
      <div className="mt-3 h-4 w-[32rem] max-w-full rounded bg-slate-100" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="h-32 rounded-2xl border border-slate-200 bg-white" key={index} />
        ))}
      </div>
      <span className="sr-only">Đang tải dữ liệu trong phạm vi của bạn…</span>
    </div>
  );
}
