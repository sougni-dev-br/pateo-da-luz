import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 3334),
  databaseUrl: process.env.DATABASE_URL
};
