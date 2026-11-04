import * as Sentry from "@sentry/nextjs";

import { errorFields, logEvent } from "./lib/log";

/**
 * Sentry phía server. Không có DSN thì không khởi tạo gì cả — nhờ vậy chạy local
 * và chạy CI không phải cấu hình thêm, và không có sự kiện rác nào được gửi đi.
 */
export function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    // Không lấy mẫu trace: ở giai đoạn này ta cần LỖI, không cần biểu đồ hiệu
    // năng — và mỗi trace là một phần hạn mức miễn phí bị tiêu.
    tracesSampleRate: 0,
  });
}

/** Server render errors: `digest` is the only link to what the error boundary reports from the browser. */
export const onRequestError: typeof Sentry.captureRequestError = (error, request, context) => {
  logEvent("error", "request_error", {
    ...errorFields(error),
    digest: (error as { digest?: string } | null)?.digest,
    path: request.path?.split("?")[0],
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
  });
  return Sentry.captureRequestError(error, request, context);
};
