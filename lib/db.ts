import { PrismaClient } from "@prisma/client";

// Prisma client dùng chung. Trong dev, Next.js hot-reload nhiều lần nên ta cache
// vào globalThis để không tạo hàng loạt kết nối (mẫu chuẩn của Prisma + Next.js).

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
