import { prisma } from "@/lib/db";
import { MISTAKE_CATEGORY_LABEL, MistakeCategory } from "@/lib/mistake-categories";

export interface WeaknessExample {
  original: string;
  correction: string;
}

export interface WeaknessSummaryItem {
  category: MistakeCategory;
  label: string;
  count: number;
  examples: WeaknessExample[];
}

// Tổng hợp lỗi hay mắc (từ MistakeRecord — ghi ở Viết/Nói/Chat) theo loại, sắp
// theo số lần mắc giảm dần — nguồn dữ liệu cho section "Điểm yếu" ở Dashboard.
export async function getWeaknessSummary(userId: string, limit = 5): Promise<WeaknessSummaryItem[]> {
  const grouped = await prisma.mistakeRecord.groupBy({
    by: ["category"],
    where: { userId },
    _count: { category: true },
    orderBy: { _count: { category: "desc" } },
    take: limit,
  });

  const items: WeaknessSummaryItem[] = [];
  for (const g of grouped) {
    const recent = await prisma.mistakeRecord.findMany({
      where: { userId, category: g.category },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { original: true, correction: true },
    });
    const category = g.category as MistakeCategory;
    items.push({
      category,
      label: MISTAKE_CATEGORY_LABEL[category] ?? category,
      count: g._count.category,
      examples: recent,
    });
  }
  return items;
}
