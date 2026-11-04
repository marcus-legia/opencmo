"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/client-errors";

/**
 * Lỗi của một màn không được kéo theo cả khung.
 *
 * Từ lúc rail và top bar chuyển lên `layout.tsx`, một throw trong page sẽ hạ cả
 * tài liệu nếu không có ranh giới nào chặn. Đặt ranh giới ở khe `children` giữ
 * rail sống, và người dùng còn đường đi tiếp thay vì một trang trắng.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError("boundary", error, { source: "app/app/error", digest: error.digest });
  }, [error]);

  return (
    <section className="empty-state">
      <p>Something went wrong on this screen.</p>
      <button type="button" className="primary-button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
