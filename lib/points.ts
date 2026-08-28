import { prisma } from "@/lib/db";

export { POINTS_PER_ACTIVITY } from "@/lib/points-constants";

export async function awardPoints(userId: string, amount: number): Promise<void> {
  await prisma.profile.upsert({
    where: { userId },
    update: { points: { increment: amount } },
    create: { userId, overallLevel: "A2", points: Math.max(amount, 0) },
  });
}
