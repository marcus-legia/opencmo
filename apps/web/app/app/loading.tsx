import { PageSkeleton } from "@/components/clipping/Skeleton";
import { TodayLoading } from "@/components/today/TodayLoading";
import { UI_V2 } from "@/lib/screens/flag";

/**
 * Ranh giới này không phải để trang trí.
 *
 * Thiếu nó, `<Link>` không prefetch được route động (prefetch mặc định chỉ tải
 * tới ranh giới `loading.tsx` gần nhất), nên cú bấm phải chờ hết một vòng
 * server trước khi URL kịp đổi — tức là mục đang sáng trên rail đổi muộn hơn
 * ngón tay. Có nó thì điều hướng commit ngay, rail và top bar đứng yên, chỉ
 * vùng nội dung đổi.
 */
export default function AppLoading() {
  // In the Today frame the screen's own column waits; the classic shell keeps its library grid.
  return UI_V2 ? <TodayLoading /> : <PageSkeleton variant="library" />;
}
